using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

public static partial class OpenAiApi
{
    public const string ModelId = "m365-copilot";
    public const int MaxRequestBytes = 1_000_000;
    public const int MaxMessages = 64;
    public const int MaxTextChars = 120_000;

    private static readonly HashSet<string> AllowedTopLevelKeys = new(StringComparer.Ordinal)
    {
        "model",
        "messages",
        "stream",
        "stream_options",
        "temperature",
        "top_p",
        "max_tokens",
        "max_completion_tokens",
        "presence_penalty",
        "frequency_penalty",
        "stop",
        "seed",
        "user",
        "service_tier",
        "metadata",
        "response_format",
        "tools",
        "tool_choice",
        "parallel_tool_calls",
        "n"
    };

    private static readonly HashSet<string> UnsupportedTopLevelKeys = new(StringComparer.Ordinal)
    {
        "functions",
        "function_call",
        "logprobs",
        "top_logprobs",
        "logit_bias",
        "modalities",
        "audio",
        "store",
        "prediction"
    };

    private static readonly HashSet<string> AllowedRoles = new(StringComparer.Ordinal)
    {
        "system",
        "developer",
        "user",
        "assistant",
        "tool"
    };

    public static object ModelsList() => new
    {
        @object = "list",
        data = new[]
        {
            ModelObject()
        }
    };

    public static object ModelObject() => new
    {
        id = ModelId,
        @object = "model",
        created = 0,
        owned_by = "relay"
    };

    public static IResult Error(
        int statusCode,
        string message,
        string type = "invalid_request_error",
        string? param = null,
        string? code = null)
    {
        return Results.Json(
            new OpenAiErrorEnvelope(new OpenAiError(message, type, param, code)),
            JsonOptions.Default,
            contentType: "application/json; charset=utf-8",
            statusCode: statusCode);
    }

    public static async Task<(OpenAiChatCompletionRequest? Request, IResult? Error)> ReadChatRequestAsync(
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
            if (UnsupportedTopLevelKeys.Contains(key))
            {
                return (null, Error(400, $"Parameter '{key}' is not supported by Relay's OpenAI-compatible gateway.", param: key, code: "unsupported_parameter"));
            }

            if (!AllowedTopLevelKeys.Contains(key))
            {
                return (null, Error(400, $"Unknown parameter '{key}'.", param: key, code: "unknown_parameter"));
            }
        }

        OpenAiChatCompletionRequest? request;
        try
        {
            request = obj.Deserialize<OpenAiChatCompletionRequest>(JsonOptions.Default);
        }
        catch (JsonException ex)
        {
            return (null, Error(400, $"Invalid chat completion request: {ex.Message}", code: "invalid_request"));
        }

        if (request is null)
        {
            return (null, Error(400, "Request body could not be parsed.", code: "invalid_request"));
        }

        if (!string.Equals(request.Model, ModelId, StringComparison.Ordinal))
        {
            return (null, Error(404, $"Model '{request.Model ?? ""}' was not found. Use '{ModelId}'.", param: "model", code: "model_not_found"));
        }

        if (request.Stream == true)
        {
            return (null, Error(400, "Streaming is not supported yet. Send requests with stream=false or omit stream.", param: "stream", code: "unsupported_parameter"));
        }

        if (request.N is not null && request.N != 1)
        {
            return (null, Error(400, "Relay supports only n=1.", param: "n", code: "unsupported_parameter"));
        }

        if (request.Messages is null || request.Messages.Count == 0)
        {
            return (null, Error(400, "'messages' must contain at least one message.", param: "messages", code: "missing_required_parameter"));
        }

        if (request.Messages.Count > MaxMessages)
        {
            return (null, Error(400, $"'messages' may contain at most {MaxMessages} messages.", param: "messages", code: "too_many_messages"));
        }

        for (var i = 0; i < request.Messages.Count; i++)
        {
            var message = request.Messages[i];
            var role = message.Role ?? "";
            if (!AllowedRoles.Contains(role))
            {
                return (null, Error(400, $"messages[{i}].role '{role}' is not supported.", param: $"messages[{i}].role", code: "unsupported_message_role"));
            }

            if (!message.HasStringOrNullContent)
            {
                return (null, Error(400, $"messages[{i}].content must be a string for this Relay gateway.", param: $"messages[{i}].content", code: "unsupported_content_type"));
            }

            if (role is "user" or "system" or "developer" or "tool" && message.TextContent is null)
            {
                return (null, Error(400, $"messages[{i}].content is required for role '{role}'.", param: $"messages[{i}].content", code: "missing_required_parameter"));
            }
        }

        var totalTextChars = request.Messages.Sum(message => message.TextContent?.Length ?? 0);
        if (totalTextChars > MaxTextChars)
        {
            return (null, Error(413, $"Total message text is too large. Limit is {MaxTextChars} characters.", param: "messages", code: "request_too_large"));
        }

        if (request.Tools is { Count: > 0 })
        {
            if (request.Tools.Count > 32)
            {
                return (null, Error(400, "Relay supports at most 32 tools per request.", param: "tools", code: "too_many_tools"));
            }

            foreach (var (tool, index) in request.Tools.Select((tool, index) => (tool, index)))
            {
                var validation = ValidateToolDefinition(tool, index);
                if (validation is not null)
                {
                    return (null, validation);
                }
            }
        }

        var toolChoiceValidation = ValidateToolChoice(request);
        if (toolChoiceValidation is not null)
        {
            return (null, toolChoiceValidation);
        }

        var responseFormatValidation = ValidateResponseFormat(request);
        if (responseFormatValidation is not null)
        {
            return (null, responseFormatValidation);
        }

        return (request, null);
    }

    public static bool RequiresJsonObject(OpenAiChatCompletionRequest request)
    {
        if (request.ResponseFormat?["type"]?.GetValue<string>() is not { } type)
        {
            return false;
        }

        return string.Equals(type, "json_object", StringComparison.Ordinal);
    }

    public static bool WantsToolPlanning(OpenAiChatCompletionRequest request)
    {
        return request.Tools is { Count: > 0 } &&
            !string.Equals(request.ToolChoiceMode, "none", StringComparison.Ordinal);
    }

    public static string BuildCopilotPrompt(OpenAiChatCompletionRequest request)
    {
        if (!WantsToolPlanning(request))
        {
            return BuildPlainConversationPrompt(request);
        }

        return BuildToolPlannerPrompt(request);
    }

    public static IResult BuildOpenAiResponse(OpenAiChatCompletionRequest request, string copilotText)
    {
        if (WantsToolPlanning(request))
        {
            var parsed = TryParseToolPlannerResponse(request, copilotText);
            if (parsed.Error is not null)
            {
                if (request.ToolChoiceMode is "required" or "named")
                {
                    return Error(502, $"Copilot returned an invalid tool decision: {parsed.Error}", type: "relay_provider_error", code: "invalid_tool_call");
                }

                return Results.Json(
                    OpenAiChatCompletionResponse.FromText(ModelId, copilotText, EstimatePromptTokens(request), EstimateCompletionTokens(copilotText)),
                    JsonOptions.Default,
                    contentType: "application/json; charset=utf-8");
            }

            if (parsed.ToolCalls.Count > 0)
            {
                return Results.Json(
                    OpenAiChatCompletionResponse.FromToolCalls(ModelId, parsed.ToolCalls, EstimatePromptTokens(request), EstimateCompletionTokens(copilotText)),
                    JsonOptions.Default,
                    contentType: "application/json; charset=utf-8");
            }

            return Results.Json(
                OpenAiChatCompletionResponse.FromText(ModelId, parsed.Content ?? "", EstimatePromptTokens(request), EstimateCompletionTokens(parsed.Content ?? "")),
                JsonOptions.Default,
                contentType: "application/json; charset=utf-8");
        }

        var responseText = copilotText;
        if (RequiresJsonObject(request))
        {
            var normalizedJson = NormalizeJsonObject(copilotText);
            if (normalizedJson is null)
            {
                return Error(502, "Copilot response was not a valid JSON object required by response_format.", type: "relay_provider_error", param: "response_format", code: "invalid_json_object_response");
            }

            responseText = normalizedJson;
        }

        return Results.Json(
            OpenAiChatCompletionResponse.FromText(ModelId, responseText, EstimatePromptTokens(request), EstimateCompletionTokens(responseText)),
            JsonOptions.Default,
            contentType: "application/json; charset=utf-8");
    }

    private static IResult? ValidateToolDefinition(OpenAiToolDefinition tool, int index)
    {
        if (!string.Equals(tool.Type, "function", StringComparison.Ordinal))
        {
            return Error(400, $"tools[{index}].type must be 'function'.", param: $"tools[{index}].type", code: "unsupported_tool_type");
        }

        if (tool.Function is null)
        {
            return Error(400, $"tools[{index}].function is required.", param: $"tools[{index}].function", code: "missing_required_parameter");
        }

        if (string.IsNullOrWhiteSpace(tool.Function.Name) || !ToolNameRegex().IsMatch(tool.Function.Name))
        {
            return Error(400, $"tools[{index}].function.name is invalid.", param: $"tools[{index}].function.name", code: "invalid_tool_name");
        }

        if (tool.Function.Parameters is not null && tool.Function.Parameters is not JsonObject)
        {
            return Error(400, $"tools[{index}].function.parameters must be a JSON object.", param: $"tools[{index}].function.parameters", code: "invalid_tool_schema");
        }

        return null;
    }

    private static IResult? ValidateToolChoice(OpenAiChatCompletionRequest request)
    {
        if (request.ToolChoice is null)
        {
            return null;
        }

        var choice = request.ToolChoice.Value;
        if (choice.ValueKind == JsonValueKind.String)
        {
            var value = choice.GetString();
            if (value is "none" or "auto" or "required")
            {
                return null;
            }

            return Error(400, "'tool_choice' must be 'none', 'auto', 'required', or a named function object.", param: "tool_choice", code: "invalid_tool_choice");
        }

        if (choice.ValueKind == JsonValueKind.Object &&
            choice.TryGetProperty("type", out var type) &&
            string.Equals(type.GetString(), "function", StringComparison.Ordinal) &&
            choice.TryGetProperty("function", out var function) &&
            function.ValueKind == JsonValueKind.Object &&
            function.TryGetProperty("name", out var name) &&
            name.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(name.GetString()))
        {
            if (request.Tools is null || request.Tools.All(tool => !string.Equals(tool.Function?.Name, name.GetString(), StringComparison.Ordinal)))
            {
                return Error(400, $"tool_choice references unknown function '{name.GetString()}'.", param: "tool_choice", code: "unknown_tool");
            }

            return null;
        }

        return Error(400, "'tool_choice' must be 'none', 'auto', 'required', or a named function object.", param: "tool_choice", code: "invalid_tool_choice");
    }

    private static IResult? ValidateResponseFormat(OpenAiChatCompletionRequest request)
    {
        if (request.ResponseFormat is null)
        {
            return null;
        }

        if (request.ResponseFormat["type"]?.GetValue<string>() is not { } type)
        {
            return Error(400, "response_format.type is required.", param: "response_format.type", code: "missing_required_parameter");
        }

        if (type is "text" or "json_object")
        {
            return null;
        }

        return Error(400, "Relay supports response_format.type values 'text' and 'json_object'.", param: "response_format.type", code: "unsupported_parameter");
    }

    private static string BuildPlainConversationPrompt(OpenAiChatCompletionRequest request)
    {
        var sb = new StringBuilder();
        sb.AppendLine("RELAY OPENAI-COMPATIBLE CHAT REQUEST");
        sb.AppendLine("Answer the user's request directly. Do not claim local tool execution unless tool results are included in this conversation.");
        if (RequiresJsonObject(request))
        {
            sb.AppendLine("Return exactly one valid JSON object and nothing else.");
        }

        sb.AppendLine();
        AppendConversation(sb, request);
        return TrimForCopilot(sb.ToString());
    }

    private static string BuildToolPlannerPrompt(OpenAiChatCompletionRequest request)
    {
        var toolsJson = JsonSerializer.Serialize(request.Tools, JsonOptions.Default);
        var sb = new StringBuilder();
        sb.AppendLine("RELAY OPENAI-COMPATIBLE TOOL CALL PLANNER");
        sb.AppendLine("Mode: client_managed_tool_calling.");
        sb.AppendLine("You may choose client-provided tools, but Relay will not execute them. The API client is responsible for execution and for sending tool results back.");
        sb.AppendLine("Return exactly one valid JSON object and nothing else.");
        sb.AppendLine("Use one of these shapes only:");
        sb.AppendLine("{\"tool_calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}");
        sb.AppendLine("{\"content\":\"assistant message when no tool is needed\"}");
        sb.AppendLine("Do not include markdown, code fences, citations, prose outside JSON, or local tool execution claims.");
        sb.AppendLine($"tool_choice: {request.ToolChoiceDescription}");
        sb.AppendLine($"parallel_tool_calls: {(request.ParallelToolCalls == false ? "false" : "true")}");
        sb.AppendLine();
        sb.AppendLine("TOOLS:");
        sb.AppendLine(toolsJson);
        sb.AppendLine();
        sb.AppendLine("CONVERSATION:");
        AppendConversation(sb, request);
        return TrimForCopilot(sb.ToString());
    }

    private static void AppendConversation(StringBuilder sb, OpenAiChatCompletionRequest request)
    {
        foreach (var message in request.Messages ?? [])
        {
            var role = message.Role ?? "unknown";
            if (message.ToolCalls is { Count: > 0 })
            {
                sb.AppendLine($"[{role} tool_calls] {JsonSerializer.Serialize(message.ToolCalls, JsonOptions.Default)}");
            }
            else if (!string.IsNullOrWhiteSpace(message.ToolCallId))
            {
                sb.AppendLine($"[{role} tool_call_id={message.ToolCallId}] {message.TextContent}");
            }
            else
            {
                sb.AppendLine($"[{role}] {message.TextContent}");
            }
        }
    }

    private static string TrimForCopilot(string text)
    {
        if (text.Length <= MaxTextChars)
        {
            return text;
        }

        return text[..MaxTextChars] + "\n...[trimmed by Relay gateway]";
    }

    private static ToolPlannerParseResult TryParseToolPlannerResponse(OpenAiChatCompletionRequest request, string text)
    {
        var candidate = StripJsonFence(text);
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(candidate);
        }
        catch (JsonException ex)
        {
            return ToolPlannerParseResult.Invalid(ex.Message);
        }

        if (root is not JsonObject obj)
        {
            return ToolPlannerParseResult.Invalid("root was not a JSON object");
        }

        if (obj.TryGetPropertyValue("content", out var contentNode) && contentNode is not null)
        {
            if (request.ToolChoiceMode is "required" or "named")
            {
                return ToolPlannerParseResult.Invalid("tool_choice requires a tool call");
            }

            return contentNode.GetValueKind() == JsonValueKind.String
                ? ToolPlannerParseResult.Text(contentNode.GetValue<string>())
                : ToolPlannerParseResult.Invalid("content must be a string");
        }

        if (!obj.TryGetPropertyValue("tool_calls", out var toolCallsNode) || toolCallsNode is not JsonArray toolCallsArray)
        {
            return ToolPlannerParseResult.Invalid("tool_calls array was missing");
        }

        if (toolCallsArray.Count == 0)
        {
            return ToolPlannerParseResult.Invalid("tool_calls must not be empty");
        }

        if (request.ParallelToolCalls == false && toolCallsArray.Count > 1)
        {
            return ToolPlannerParseResult.Invalid("parallel_tool_calls=false but multiple tool calls were returned");
        }

        var calls = new List<OpenAiToolCall>();
        foreach (var node in toolCallsArray)
        {
            if (node is not JsonObject callObj)
            {
                return ToolPlannerParseResult.Invalid("tool call entries must be objects");
            }

            var name = callObj["name"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(name))
            {
                return ToolPlannerParseResult.Invalid("tool call name is required");
            }

            var tool = request.Tools?.FirstOrDefault(item => string.Equals(item.Function?.Name, name, StringComparison.Ordinal));
            if (tool?.Function is null)
            {
                return ToolPlannerParseResult.Invalid($"unknown tool '{name}'");
            }

            if (request.NamedToolChoice is { } named && !string.Equals(named, name, StringComparison.Ordinal))
            {
                return ToolPlannerParseResult.Invalid($"tool_choice required '{named}' but Copilot chose '{name}'");
            }

            var argumentsNode = callObj["arguments"] ?? new JsonObject();
            if (argumentsNode is not JsonObject argumentsObject)
            {
                return ToolPlannerParseResult.Invalid($"arguments for '{name}' must be an object");
            }

            var schemaError = ValidateArgumentsAgainstSchema(name, argumentsObject, tool.Function.Parameters);
            if (schemaError is not null)
            {
                return ToolPlannerParseResult.Invalid(schemaError);
            }

            calls.Add(OpenAiToolCall.FromFunction(name, argumentsObject.ToJsonString(JsonOptions.Default)));
        }

        return ToolPlannerParseResult.Tools(calls);
    }

    private static string? ValidateArgumentsAgainstSchema(string toolName, JsonObject arguments, JsonObject? schema)
    {
        if (schema is null)
        {
            return null;
        }

        if (schema["type"]?.GetValue<string>() is { } rootType && rootType != "object")
        {
            return $"schema for '{toolName}' must be an object schema";
        }

        var properties = schema["properties"] as JsonObject;
        var required = schema["required"] as JsonArray;
        if (required is not null)
        {
            foreach (var item in required)
            {
                if (item?.GetValueKind() == JsonValueKind.String && !arguments.ContainsKey(item.GetValue<string>()))
                {
                    return $"arguments for '{toolName}' missing required property '{item.GetValue<string>()}'";
                }
            }
        }

        if (properties is null)
        {
            return null;
        }

        foreach (var pair in arguments)
        {
            if (!properties.ContainsKey(pair.Key))
            {
                continue;
            }

            if (properties[pair.Key] is not JsonObject propertySchema || pair.Value is null)
            {
                continue;
            }

            if (propertySchema["type"]?.GetValue<string>() is not { } type)
            {
                continue;
            }

            if (!MatchesJsonSchemaType(pair.Value, type))
            {
                return $"arguments for '{toolName}' property '{pair.Key}' must be {type}";
            }
        }

        return null;
    }

    private static bool MatchesJsonSchemaType(JsonNode value, string type)
    {
        return type switch
        {
            "string" => value.GetValueKind() == JsonValueKind.String,
            "number" => value.GetValueKind() is JsonValueKind.Number,
            "integer" => value.GetValueKind() is JsonValueKind.Number && value.AsValue().TryGetValue<int>(out _),
            "boolean" => value.GetValueKind() is JsonValueKind.True or JsonValueKind.False,
            "array" => value is JsonArray,
            "object" => value is JsonObject,
            "null" => value.GetValueKind() == JsonValueKind.Null,
            _ => true
        };
    }

    private static string StripJsonFence(string text)
    {
        var trimmed = text.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstNewline = trimmed.IndexOf('\n');
        var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        if (firstNewline >= 0 && lastFence > firstNewline)
        {
            return trimmed[(firstNewline + 1)..lastFence].Trim();
        }

        return trimmed;
    }

    private static string? NormalizeJsonObject(string text)
    {
        try
        {
            var candidate = StripJsonFence(text);
            return JsonNode.Parse(candidate) is JsonObject ? candidate : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int EstimatePromptTokens(OpenAiChatCompletionRequest request) => 0;

    private static int EstimateCompletionTokens(string text) => 0;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex ToolNameRegex();
}

public sealed record OpenAiErrorEnvelope(
    [property: JsonPropertyName("error")] OpenAiError Error);

public sealed record OpenAiError(
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("param")] string? Param,
    [property: JsonPropertyName("code")] string? Code);

public sealed record OpenAiChatCompletionRequest
{
    [JsonPropertyName("model")]
    public string? Model { get; init; }

    [JsonPropertyName("messages")]
    public List<OpenAiChatMessage>? Messages { get; init; }

    [JsonPropertyName("stream")]
    public bool? Stream { get; init; }

    [JsonPropertyName("stream_options")]
    public JsonObject? StreamOptions { get; init; }

    [JsonPropertyName("temperature")]
    public double? Temperature { get; init; }

    [JsonPropertyName("top_p")]
    public double? TopP { get; init; }

    [JsonPropertyName("max_tokens")]
    public int? MaxTokens { get; init; }

    [JsonPropertyName("max_completion_tokens")]
    public int? MaxCompletionTokens { get; init; }

    [JsonPropertyName("presence_penalty")]
    public double? PresencePenalty { get; init; }

    [JsonPropertyName("frequency_penalty")]
    public double? FrequencyPenalty { get; init; }

    [JsonPropertyName("stop")]
    public JsonElement? Stop { get; init; }

    [JsonPropertyName("seed")]
    public long? Seed { get; init; }

    [JsonPropertyName("user")]
    public string? User { get; init; }

    [JsonPropertyName("service_tier")]
    public string? ServiceTier { get; init; }

    [JsonPropertyName("metadata")]
    public JsonObject? Metadata { get; init; }

    [JsonPropertyName("response_format")]
    public JsonObject? ResponseFormat { get; init; }

    [JsonPropertyName("tools")]
    public List<OpenAiToolDefinition>? Tools { get; init; }

    [JsonPropertyName("tool_choice")]
    public JsonElement? ToolChoice { get; init; }

    [JsonPropertyName("parallel_tool_calls")]
    public bool? ParallelToolCalls { get; init; }

    [JsonPropertyName("n")]
    public int? N { get; init; }

    [JsonIgnore]
    public string ToolChoiceMode
    {
        get
        {
            if (ToolChoice is null)
            {
                return Tools is { Count: > 0 } ? "auto" : "none";
            }

            var value = ToolChoice.Value;
            if (value.ValueKind == JsonValueKind.String)
            {
                return value.GetString() ?? "auto";
            }

            return "named";
        }
    }

    [JsonIgnore]
    public string? NamedToolChoice
    {
        get
        {
            if (ToolChoice is null || ToolChoice.Value.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return ToolChoice.Value.TryGetProperty("function", out var function) &&
                function.ValueKind == JsonValueKind.Object &&
                function.TryGetProperty("name", out var name) &&
                name.ValueKind == JsonValueKind.String
                ? name.GetString()
                : null;
        }
    }

    [JsonIgnore]
    public string ToolChoiceDescription => ToolChoice is null ? ToolChoiceMode : ToolChoice.Value.GetRawText();
}

public sealed record OpenAiChatMessage
{
    [JsonPropertyName("role")]
    public string? Role { get; init; }

    [JsonPropertyName("content")]
    public JsonElement? Content { get; init; }

    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("tool_calls")]
    public List<OpenAiToolCall>? ToolCalls { get; init; }

    [JsonPropertyName("tool_call_id")]
    public string? ToolCallId { get; init; }

    [JsonPropertyName("function_call")]
    public JsonObject? FunctionCall { get; init; }

    [JsonIgnore]
    public string? TextContent
    {
        get
        {
            if (Content is null || Content.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return null;
            }

            return Content.Value.ValueKind == JsonValueKind.String
                ? Content.Value.GetString()
                : null;
        }
    }

    [JsonIgnore]
    public bool HasStringOrNullContent => Content is null ||
        Content.Value.ValueKind is JsonValueKind.String or JsonValueKind.Null or JsonValueKind.Undefined;

    public static OpenAiChatMessage FromText(string text) => new()
    {
        Role = "assistant",
        Content = JsonSerializer.SerializeToElement(text, JsonOptions.Default)
    };

    public static OpenAiChatMessage FromToolCalls(IReadOnlyList<OpenAiToolCall> toolCalls) => new()
    {
        Role = "assistant",
        Content = JsonSerializer.SerializeToElement((string?)null, JsonOptions.Default),
        ToolCalls = toolCalls.ToList()
    };
}

public sealed record OpenAiToolDefinition
{
    [JsonPropertyName("type")]
    public string? Type { get; init; }

    [JsonPropertyName("function")]
    public OpenAiFunctionDefinition? Function { get; init; }
}

public sealed record OpenAiFunctionDefinition
{
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("parameters")]
    public JsonObject? Parameters { get; init; }

    [JsonPropertyName("strict")]
    public bool? Strict { get; init; }
}

public sealed record OpenAiToolCall
{
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    [JsonPropertyName("type")]
    public string Type { get; init; } = "function";

    [JsonPropertyName("function")]
    public OpenAiToolCallFunction Function { get; init; } = new();

    public static OpenAiToolCall FromFunction(string name, string arguments) => new()
    {
        Id = $"call_{Guid.NewGuid():N}"[..29],
        Type = "function",
        Function = new OpenAiToolCallFunction
        {
            Name = name,
            Arguments = arguments
        }
    };
}

public sealed record OpenAiToolCallFunction
{
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("arguments")]
    public string? Arguments { get; init; }
}

public sealed record OpenAiChatCompletionResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("object")] string Object,
    [property: JsonPropertyName("created")] long Created,
    [property: JsonPropertyName("model")] string Model,
    [property: JsonPropertyName("choices")] IReadOnlyList<OpenAiChoice> Choices,
    [property: JsonPropertyName("usage")] OpenAiUsage Usage,
    [property: JsonPropertyName("system_fingerprint")] string? SystemFingerprint = null)
{
    public static OpenAiChatCompletionResponse FromText(string model, string text, int promptTokens, int completionTokens)
    {
        return new(
            Id: $"chatcmpl-relay-{Guid.NewGuid():N}",
            Object: "chat.completion",
            Created: DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            Model: model,
            Choices:
            [
                new OpenAiChoice(0, OpenAiChatMessage.FromText(text), "stop")
            ],
            Usage: OpenAiUsage.From(promptTokens, completionTokens));
    }

    public static OpenAiChatCompletionResponse FromToolCalls(string model, IReadOnlyList<OpenAiToolCall> toolCalls, int promptTokens, int completionTokens)
    {
        return new(
            Id: $"chatcmpl-relay-{Guid.NewGuid():N}",
            Object: "chat.completion",
            Created: DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            Model: model,
            Choices:
            [
                new OpenAiChoice(0, OpenAiChatMessage.FromToolCalls(toolCalls), "tool_calls")
            ],
            Usage: OpenAiUsage.From(promptTokens, completionTokens));
    }
}

public sealed record OpenAiChoice(
    [property: JsonPropertyName("index")] int Index,
    [property: JsonPropertyName("message")] OpenAiChatMessage Message,
    [property: JsonPropertyName("finish_reason")] string FinishReason,
    [property: JsonPropertyName("logprobs")] object? Logprobs = null);

public sealed record OpenAiUsage(
    [property: JsonPropertyName("prompt_tokens")] int PromptTokens,
    [property: JsonPropertyName("completion_tokens")] int CompletionTokens,
    [property: JsonPropertyName("total_tokens")] int TotalTokens)
{
    public static OpenAiUsage From(int promptTokens, int completionTokens) =>
        new(promptTokens, completionTokens, promptTokens + completionTokens);
}

public sealed record ToolPlannerParseResult(
    string? Error,
    string? Content,
    IReadOnlyList<OpenAiToolCall> ToolCalls)
{
    public static ToolPlannerParseResult Invalid(string error) => new(error, null, []);
    public static ToolPlannerParseResult Text(string text) => new(null, text, []);
    public static ToolPlannerParseResult Tools(IReadOnlyList<OpenAiToolCall> toolCalls) => new(null, null, toolCalls);
}
