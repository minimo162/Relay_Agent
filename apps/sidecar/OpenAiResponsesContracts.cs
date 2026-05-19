using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

public static partial class OpenAiApi
{
    private static readonly HashSet<string> AllowedResponsesTopLevelKeys = new(StringComparer.Ordinal)
    {
        "model",
        "instructions",
        "input",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
        "reasoning",
        "store",
        "stream",
        "include",
        "prompt_cache_key",
        "client_metadata",
        "metadata",
        "previous_response_id",
        "max_output_tokens",
        "temperature",
        "top_p",
        "truncation",
        "service_tier",
        "user",
        "text",
    };

    public static async Task<(OpenAiResponsesRequest? Request, IResult? Error)> ReadResponsesRequestAsync(
        HttpRequest httpRequest,
        CancellationToken cancellationToken)
    {
        if (httpRequest.ContentLength is > MaxRequestBytes)
        {
            return (null, Error(413, $"Request body is too large. Limit is {MaxRequestBytes} bytes.", code: "request_too_large"));
        }

        JsonNode? root;
        try
        {
            root = await JsonNode.ParseAsync(httpRequest.Body, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch (JsonException ex)
        {
            return (null, Error(400, $"Invalid JSON request body: {ex.Message}", code: "invalid_json"));
        }

        if (root is not JsonObject obj)
        {
            return (null, Error(400, "Request body must be a JSON object.", code: "invalid_request_body"));
        }

        foreach (var key in obj.Select(pair => pair.Key))
        {
            if (!AllowedResponsesTopLevelKeys.Contains(key))
            {
                return (null, Error(400, $"Unknown parameter '{key}'.", param: key, code: "unknown_parameter"));
            }
        }

        var model = obj["model"]?.GetValue<string>();
        if (!string.Equals(model, ModelId, StringComparison.Ordinal))
        {
            return (null, Error(404, $"Model '{model ?? ""}' was not found. Use '{ModelId}'.", param: "model", code: "model_not_found"));
        }

        if (!obj.TryGetPropertyValue("input", out var inputNode) || inputNode is null)
        {
            return (null, Error(400, "'input' is required.", param: "input", code: "missing_required_parameter"));
        }

        var inputText = ExtractResponsesInputText(inputNode);
        var instructions = obj["instructions"]?.GetValue<string>();
        var totalTextChars = inputText.Length + (instructions?.Length ?? 0);
        if (totalTextChars > MaxTextChars)
        {
            return (null, Error(413, $"Total input text is too large. Limit is {MaxTextChars} characters.", param: "input", code: "request_too_large"));
        }

        var tools = obj["tools"] as JsonArray;
        if (tools is { Count: > 64 })
        {
            return (null, Error(400, "Relay supports at most 64 response tools per request.", param: "tools", code: "too_many_tools"));
        }

        return (new OpenAiResponsesRequest(
            ModelId,
            instructions,
            inputNode.DeepClone(),
            inputText,
            tools?.DeepClone().AsArray(),
            obj["tool_choice"]?.DeepClone(),
            obj["parallel_tool_calls"]?.GetValue<bool?>(),
            obj["stream"]?.GetValue<bool>() ?? false), null);
    }

    public static string BuildCopilotPrompt(OpenAiResponsesRequest request)
    {
        if (request.FunctionTools.Count == 0)
        {
            var sb = new StringBuilder();
            sb.AppendLine("RELAY OPENAI RESPONSES PROVIDER");
            sb.AppendLine("Answer the user's request directly. Do not claim local tool execution unless tool results are included in the input.");
            sb.AppendLine();
            AppendResponsesContext(sb, request, includeTools: false);
            return TrimResponsesPrompt(sb.ToString());
        }

        var sbWithTools = new StringBuilder();
        sbWithTools.AppendLine("RELAY CODEX APP-SERVER RESPONSES PROVIDER");
        sbWithTools.AppendLine("Mode: app_server_tool_planning.");
        sbWithTools.AppendLine("You are producing one OpenAI Responses API assistant output for the bundled Codex app server.");
        sbWithTools.AppendLine("Relay will convert your JSON into Responses API output items. Relay will not execute tools; the app server owns tool execution.");
        sbWithTools.AppendLine("Return exactly one valid JSON object and nothing else.");
        sbWithTools.AppendLine("Use one of these shapes only:");
        sbWithTools.AppendLine("{\"tool_calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}");
        sbWithTools.AppendLine("{\"content\":\"assistant message when no tool is needed\"}");
        sbWithTools.AppendLine("Choose tools only from TOOLS. Do not invent tool names, markdown, code fences, citations, or prose outside JSON.");
        sbWithTools.AppendLine($"tool_choice: {DescribeResponsesToolChoice(request)}");
        sbWithTools.AppendLine($"parallel_tool_calls: {(request.ParallelToolCalls == false ? "false" : "true")}");
        sbWithTools.AppendLine();
        AppendResponsesContext(sbWithTools, request, includeTools: true);
        return TrimResponsesPrompt(sbWithTools.ToString());
    }

    public static OpenAiResponsesParseResult ParseResponsesCopilotOutput(OpenAiResponsesRequest request, string copilotText)
    {
        if (request.FunctionTools.Count == 0)
        {
            return OpenAiResponsesParseResult.Text(copilotText);
        }

        var candidate = StripJsonFenceForResponses(copilotText);
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(candidate);
        }
        catch (JsonException ex)
        {
            return OpenAiResponsesParseResult.Invalid(ex.Message);
        }

        if (root is not JsonObject obj)
        {
            return OpenAiResponsesParseResult.Invalid("root was not a JSON object");
        }

        if (obj.TryGetPropertyValue("content", out var contentNode) && contentNode is not null)
        {
            return contentNode.GetValueKind() == JsonValueKind.String
                ? OpenAiResponsesParseResult.Text(contentNode.GetValue<string>())
                : OpenAiResponsesParseResult.Invalid("content must be a string");
        }

        if (!obj.TryGetPropertyValue("tool_calls", out var toolCallsNode) || toolCallsNode is not JsonArray toolCallsArray)
        {
            return OpenAiResponsesParseResult.Invalid("tool_calls array was missing");
        }

        if (toolCallsArray.Count == 0)
        {
            return OpenAiResponsesParseResult.Invalid("tool_calls must not be empty");
        }

        if (request.ParallelToolCalls == false && toolCallsArray.Count > 1)
        {
            return OpenAiResponsesParseResult.Invalid("parallel_tool_calls=false but multiple tool calls were returned");
        }

        var calls = new List<OpenAiResponsesFunctionCall>();
        foreach (var node in toolCallsArray)
        {
            if (node is not JsonObject callObj)
            {
                return OpenAiResponsesParseResult.Invalid("tool call entries must be objects");
            }
            var name = callObj["name"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(name))
            {
                return OpenAiResponsesParseResult.Invalid("tool call name is required");
            }
            var tool = request.FunctionTools.FirstOrDefault(item => string.Equals(item.Name, name, StringComparison.Ordinal));
            if (tool is null)
            {
                return OpenAiResponsesParseResult.Invalid($"unknown tool '{name}'");
            }
            var argumentsNode = callObj["arguments"] ?? new JsonObject();
            if (argumentsNode is not JsonObject argumentsObject)
            {
                return OpenAiResponsesParseResult.Invalid($"arguments for '{name}' must be an object");
            }
            var schemaError = ValidateResponsesArgumentsAgainstSchema(name, argumentsObject, tool.Parameters);
            if (schemaError is not null)
            {
                return OpenAiResponsesParseResult.Invalid(schemaError);
            }
            calls.Add(new OpenAiResponsesFunctionCall(name, argumentsObject.DeepClone().AsObject()));
        }

        return OpenAiResponsesParseResult.Tools(calls);
    }

    public static async Task WriteResponsesResponseAsync(
        HttpResponse response,
        OpenAiResponsesRequest request,
        OpenAiResponsesParseResult parsed,
        CancellationToken cancellationToken)
    {
        var envelope = BuildResponsesEnvelope(request, parsed);
        if (!request.Stream)
        {
            response.ContentType = "application/json; charset=utf-8";
            await response.WriteAsJsonAsync(envelope, JsonOptions.Default, cancellationToken);
            return;
        }

        response.ContentType = "text/event-stream; charset=utf-8";
        response.Headers.CacheControl = "no-cache";
        foreach (var (eventName, payload) in BuildResponsesStreamEvents(envelope))
        {
            await response.WriteAsync($"event: {eventName}\n", cancellationToken);
            await response.WriteAsync($"data: {payload.ToJsonString(JsonOptions.Compact)}\n\n", cancellationToken);
            await response.Body.FlushAsync(cancellationToken);
        }
        await response.WriteAsync("data: [DONE]\n\n", cancellationToken);
    }

    private static JsonObject BuildResponsesEnvelope(OpenAiResponsesRequest request, OpenAiResponsesParseResult parsed)
    {
        var responseId = "resp_relay_" + Guid.NewGuid().ToString("N");
        var output = new JsonArray();
        if (parsed.ToolCalls.Count > 0)
        {
            foreach (var call in parsed.ToolCalls)
            {
                output.Add(new JsonObject
                {
                    ["id"] = "fc_" + Guid.NewGuid().ToString("N"),
                    ["type"] = "function_call",
                    ["status"] = "completed",
                    ["call_id"] = "call_" + Guid.NewGuid().ToString("N"),
                    ["name"] = call.Name,
                    ["arguments"] = call.Arguments.ToJsonString(JsonOptions.Compact),
                });
            }
        }
        else
        {
            output.Add(new JsonObject
            {
                ["id"] = "msg_" + Guid.NewGuid().ToString("N"),
                ["type"] = "message",
                ["status"] = "completed",
                ["role"] = "assistant",
                ["content"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["type"] = "output_text",
                        ["text"] = parsed.Content ?? "",
                        ["annotations"] = new JsonArray(),
                    },
                },
            });
        }

        return new JsonObject
        {
            ["id"] = responseId,
            ["object"] = "response",
            ["created_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["status"] = "completed",
            ["model"] = request.Model,
            ["output"] = output,
            ["parallel_tool_calls"] = request.ParallelToolCalls ?? true,
            ["usage"] = new JsonObject
            {
                ["input_tokens"] = 0,
                ["output_tokens"] = 0,
                ["total_tokens"] = 0,
            },
        };
    }

    private static IEnumerable<(string EventName, JsonObject Payload)> BuildResponsesStreamEvents(JsonObject completedResponse)
    {
        var responseId = completedResponse["id"]?.GetValue<string>() ?? "resp_relay";
        var inProgressResponse = completedResponse.DeepClone().AsObject();
        inProgressResponse["status"] = "in_progress";
        inProgressResponse["output"] = new JsonArray();
        yield return ("response.created", new JsonObject
        {
            ["type"] = "response.created",
            ["response"] = inProgressResponse,
        });

        if (completedResponse["output"] is JsonArray output)
        {
            for (var index = 0; index < output.Count; index++)
            {
                if (output[index] is not JsonObject item)
                {
                    continue;
                }
                yield return ("response.output_item.added", new JsonObject
                {
                    ["type"] = "response.output_item.added",
                    ["response_id"] = responseId,
                    ["output_index"] = index,
                    ["item"] = item.DeepClone(),
                });
                if (item["type"]?.GetValue<string>() == "message" &&
                    item["content"] is JsonArray content &&
                    content.FirstOrDefault() is JsonObject part)
                {
                    var text = part["text"]?.GetValue<string>() ?? "";
                    var itemId = item["id"]?.GetValue<string>() ?? $"msg_{index}";
                    yield return ("response.content_part.added", new JsonObject
                    {
                        ["type"] = "response.content_part.added",
                        ["response_id"] = responseId,
                        ["item_id"] = itemId,
                        ["output_index"] = index,
                        ["content_index"] = 0,
                        ["part"] = new JsonObject
                        {
                            ["type"] = "output_text",
                            ["text"] = "",
                            ["annotations"] = new JsonArray(),
                        },
                    });
                    if (!string.IsNullOrEmpty(text))
                    {
                        yield return ("response.output_text.delta", new JsonObject
                        {
                            ["type"] = "response.output_text.delta",
                            ["response_id"] = responseId,
                            ["item_id"] = itemId,
                            ["output_index"] = index,
                            ["content_index"] = 0,
                            ["delta"] = text,
                        });
                    }
                    yield return ("response.output_text.done", new JsonObject
                    {
                        ["type"] = "response.output_text.done",
                        ["response_id"] = responseId,
                        ["item_id"] = itemId,
                        ["output_index"] = index,
                        ["content_index"] = 0,
                        ["text"] = text,
                    });
                    yield return ("response.content_part.done", new JsonObject
                    {
                        ["type"] = "response.content_part.done",
                        ["response_id"] = responseId,
                        ["item_id"] = itemId,
                        ["output_index"] = index,
                        ["content_index"] = 0,
                        ["part"] = part.DeepClone(),
                    });
                }
                yield return ("response.output_item.done", new JsonObject
                {
                    ["type"] = "response.output_item.done",
                    ["response_id"] = responseId,
                    ["output_index"] = index,
                    ["item"] = item.DeepClone(),
                });
            }
        }

        yield return ("response.completed", new JsonObject
        {
            ["type"] = "response.completed",
            ["response"] = completedResponse,
        });
    }

    private static void AppendResponsesContext(StringBuilder sb, OpenAiResponsesRequest request, bool includeTools)
    {
        if (!string.IsNullOrWhiteSpace(request.Instructions))
        {
            sb.AppendLine("INSTRUCTIONS:");
            sb.AppendLine(request.Instructions);
            sb.AppendLine();
        }
        if (includeTools)
        {
            sb.AppendLine("TOOLS:");
            sb.AppendLine(JsonSerializer.Serialize(request.FunctionTools, JsonOptions.Default));
            sb.AppendLine();
        }
        sb.AppendLine("INPUT:");
        sb.AppendLine(request.InputText);
    }

    private static string ExtractResponsesInputText(JsonNode node)
    {
        var sb = new StringBuilder();
        ExtractResponsesText(node, sb, role: null);
        return sb.ToString().Trim();
    }

    private static void ExtractResponsesText(JsonNode? node, StringBuilder sb, string? role)
    {
        if (node is null)
        {
            return;
        }
        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out var text))
            {
                AppendResponsesLine(sb, role, text);
            }
            return;
        }
        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                ExtractResponsesText(item, sb, role);
            }
            return;
        }
        if (node is not JsonObject obj)
        {
            return;
        }

        var nextRole = obj["role"]?.GetValue<string>() ?? role;
        var type = obj["type"]?.GetValue<string>();
        if (type is "input_text" or "output_text")
        {
            AppendResponsesLine(sb, nextRole, obj["text"]?.GetValue<string>() ?? "");
            return;
        }
        if (type is "message" && obj.TryGetPropertyValue("content", out var content))
        {
            ExtractResponsesText(content, sb, nextRole);
            return;
        }
        if (type is "function_call_output")
        {
            AppendResponsesLine(sb, "tool", obj["output"]?.GetValue<string>() ?? obj.ToJsonString(JsonOptions.Compact));
            return;
        }
        if (obj.TryGetPropertyValue("content", out var genericContent))
        {
            ExtractResponsesText(genericContent, sb, nextRole);
            return;
        }
        if (obj.TryGetPropertyValue("text", out var textNode))
        {
            ExtractResponsesText(textNode, sb, nextRole);
        }
    }

    private static void AppendResponsesLine(StringBuilder sb, string? role, string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }
        sb.Append('[');
        sb.Append(string.IsNullOrWhiteSpace(role) ? "input" : role);
        sb.Append("] ");
        sb.AppendLine(text);
    }

    private static string DescribeResponsesToolChoice(OpenAiResponsesRequest request)
    {
        if (request.ToolChoice is null)
        {
            return request.FunctionTools.Count == 0 ? "none" : "auto";
        }
        return request.ToolChoice.ToJsonString(JsonOptions.Compact);
    }

    private static string TrimResponsesPrompt(string text)
    {
        if (text.Length <= MaxTextChars)
        {
            return text;
        }
        return text[..MaxTextChars] + "\n...[trimmed by Relay gateway]";
    }

    private static string StripJsonFenceForResponses(string text)
    {
        var trimmed = text.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }
        var firstNewline = trimmed.IndexOf('\n');
        var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstNewline >= 0 && lastFence > firstNewline
            ? trimmed[(firstNewline + 1)..lastFence].Trim()
            : trimmed;
    }

    private static string? ValidateResponsesArgumentsAgainstSchema(string toolName, JsonObject arguments, JsonObject? schema)
    {
        if (schema is null)
        {
            return null;
        }
        if (schema["type"]?.GetValue<string>() is { } rootType && rootType != "object")
        {
            return $"schema for '{toolName}' must be an object schema";
        }
        if (schema["required"] is JsonArray required)
        {
            foreach (var item in required)
            {
                if (item?.GetValueKind() == JsonValueKind.String && !arguments.ContainsKey(item.GetValue<string>()))
                {
                    return $"arguments for '{toolName}' missing required property '{item.GetValue<string>()}'";
                }
            }
        }
        return null;
    }
}

public sealed record OpenAiResponsesRequest(
    string Model,
    string? Instructions,
    JsonNode Input,
    string InputText,
    JsonArray? Tools,
    JsonNode? ToolChoice,
    bool? ParallelToolCalls,
    bool Stream)
{
    [JsonIgnore]
    public IReadOnlyList<OpenAiResponsesToolDefinition> FunctionTools =>
        Tools?
            .OfType<JsonObject>()
            .Where(item => item["type"]?.GetValue<string>() == "function")
            .Select(item => new OpenAiResponsesToolDefinition(
                item["name"]?.GetValue<string>() ?? "",
                item["description"]?.GetValue<string>(),
                item["parameters"] as JsonObject))
            .Where(item => !string.IsNullOrWhiteSpace(item.Name))
            .ToList() ?? [];
}

public sealed record OpenAiResponsesToolDefinition(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("parameters")] JsonObject? Parameters);

public sealed record OpenAiResponsesFunctionCall(string Name, JsonObject Arguments);

public sealed record OpenAiResponsesParseResult(
    string? Content,
    IReadOnlyList<OpenAiResponsesFunctionCall> ToolCalls,
    string? Error)
{
    public static OpenAiResponsesParseResult Text(string content) => new(content, [], null);
    public static OpenAiResponsesParseResult Tools(IReadOnlyList<OpenAiResponsesFunctionCall> toolCalls) => new(null, toolCalls, null);
    public static OpenAiResponsesParseResult Invalid(string error) => new(null, [], error);
}
