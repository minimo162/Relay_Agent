using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.AI;

public sealed class RelayCopilotChatClient(ICopilotTransport transport) : IChatClient
{
    private static readonly ChatClientMetadata Metadata = new(
        providerName: "m365-copilot",
        providerUri: new Uri("https://m365.cloud.microsoft/chat"),
        defaultModelId: "m365-copilot");

    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var prompt = BuildPrompt(messages, options);
        if (string.IsNullOrWhiteSpace(prompt))
        {
            throw new InvalidOperationException("RelayCopilotChatClient requires at least one non-empty chat message.");
        }

        var response = await transport.SendAsync(prompt, cancellationToken);
        return BuildResponse(response, options);
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var response = await GetResponseAsync(messages, options, cancellationToken);
        yield return new ChatResponseUpdate(ChatRole.Assistant, response.Text);
    }

    public object? GetService(Type serviceType, object? serviceKey = null)
    {
        ArgumentNullException.ThrowIfNull(serviceType);
        if (serviceKey is not null) return null;
        if (serviceType == typeof(ChatClientMetadata)) return Metadata;
        if (serviceType.IsInstanceOfType(this)) return this;
        return null;
    }

    public void Dispose()
    {
        // The CDP transport is owned by the sidecar lifetime, not this adapter.
    }

    private static string BuildPrompt(IEnumerable<ChatMessage> messages, ChatOptions? options)
    {
        var messageList = messages.ToArray();
        var hasTools = GetToolDeclarations(options).Any();
        if (!hasTools && string.IsNullOrWhiteSpace(options?.Instructions) && messageList.Length == 1)
        {
            return messageList[0].Text;
        }

        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(options?.Instructions))
        {
            parts.Add(options.Instructions);
        }

        foreach (var message in messageList)
        {
            var rendered = RenderMessage(message);
            if (!string.IsNullOrWhiteSpace(rendered))
            {
                parts.Add(rendered);
            }
        }

        if (hasTools)
        {
            parts.Add(BuildToolProjectionPrompt(options));
        }

        return string.Join("\n\n", parts);
    }

    private static ChatResponse BuildResponse(string responseText, ChatOptions? options)
    {
        if (!GetToolDeclarations(options).Any())
        {
            return TextResponse(responseText, options);
        }

        RelayAgentPlan plan;
        try
        {
            plan = RelayAgentPlan.Parse(responseText);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Copilot tool projection returned invalid JSON: {ex.Message}", ex);
        }

        if (plan.Action == "final")
        {
            return TextResponse(plan.Answer ?? "", options);
        }

        if (plan.Action != "tool" || string.IsNullOrWhiteSpace(plan.Tool))
        {
            throw new InvalidOperationException("Copilot tool projection must return action=tool or action=final.");
        }

        var toolName = NormalizeRequestedTool(plan.Tool, plan.Args ?? new JsonObject());
        var availableTools = GetToolDeclarations(options).Select(tool => tool.Name).ToHashSet(StringComparer.Ordinal);
        if (!availableTools.Contains(toolName))
        {
            throw new InvalidOperationException($"Copilot requested an unavailable tool: {toolName}");
        }

        var contents = new List<AIContent>
        {
            new FunctionCallContent(
                $"call-{RandomNumberGenerator.GetHexString(8).ToLowerInvariant()}",
                toolName,
                ToArgumentDictionary(plan.Args ?? new JsonObject())),
        };
        return new ChatResponse(new ChatMessage(ChatRole.Assistant, contents))
        {
            ModelId = options?.ModelId ?? Metadata.DefaultModelId,
        };
    }

    private static ChatResponse TextResponse(string text, ChatOptions? options) =>
        new(new ChatMessage(ChatRole.Assistant, text))
        {
            ModelId = options?.ModelId ?? Metadata.DefaultModelId,
        };

    private static string RenderMessage(ChatMessage message)
    {
        var contents = message.Contents
            .Select(RenderContent)
            .Where(content => !string.IsNullOrWhiteSpace(content))
            .ToArray();
        if (contents.Length == 0 && !string.IsNullOrWhiteSpace(message.Text))
        {
            contents = [message.Text];
        }

        return contents.Length == 0
            ? ""
            : $"{message.Role.Value}:\n{string.Join("\n", contents)}";
    }

    private static string RenderContent(AIContent content) =>
        content switch
        {
            TextContent text => text.Text,
            FunctionCallContent call => "RELAY_ASSISTANT_TOOL_CALL " + JsonSerializer.Serialize(new
            {
                callId = call.CallId,
                tool = call.Name,
                args = call.Arguments,
            }, JsonOptions.Compact),
            FunctionResultContent result => "RELAY_TOOL_RESULT " + JsonSerializer.Serialize(new
            {
                callId = result.CallId,
                result = result.Result,
            }, JsonOptions.Compact),
            ToolApprovalRequestContent approval => "RELAY_TOOL_APPROVAL_REQUEST " + JsonSerializer.Serialize(new
            {
                toolCall = RenderToolCall(approval.ToolCall),
            }, JsonOptions.Compact),
            ToolApprovalResponseContent approval => "RELAY_TOOL_APPROVAL_RESPONSE " + JsonSerializer.Serialize(new
            {
                approved = approval.Approved,
                reason = approval.Reason,
                toolCall = RenderToolCall(approval.ToolCall),
            }, JsonOptions.Compact),
            _ => content.ToString() ?? "",
        };

    private static object RenderToolCall(ToolCallContent toolCall) =>
        toolCall is FunctionCallContent functionCall
            ? new
            {
                callId = functionCall.CallId,
                tool = functionCall.Name,
                args = functionCall.Arguments,
            }
            : new { callId = toolCall.CallId, type = toolCall.GetType().Name };

    private static string BuildToolProjectionPrompt(ChatOptions? options)
    {
        var parts = new List<string>
        {
            "RELAY AGENT FUNCTION CALL PROJECTION",
            "Mode: choose whether to call one Relay function tool or return a final answer.",
            "Return exactly one valid JSON object and nothing else.",
            """For a tool call: {"action":"tool","tool":"<tool name>","args":{...}}""",
            """For final answer: {"action":"final","answer":"<concise answer>"}""",
            "Rules:",
            "- Use one tool at most in a single response.",
            "- Relay executes tools locally. Do not claim execution without a tool result.",
            "- Do not return tool_uses, recipient_name, bash, shell, markdown, prose, or code fences.",
            "- Use the JSON schema and descriptions below. Unknown fields are invalid.",
            "- Prefer forward slashes in paths when possible, or escape Windows backslashes correctly.",
            "Available Relay function tools:",
        };

        foreach (var tool in GetToolDeclarations(options))
        {
            parts.Add(string.Join("\n", [
                $"- name: {tool.Name}",
                $"  description: {tool.Description}",
                $"  jsonSchema: {tool.JsonSchema.GetRawText()}",
            ]));
        }

        return string.Join("\n", parts);
    }

    private static IEnumerable<AIFunctionDeclaration> GetToolDeclarations(ChatOptions? options) =>
        options?.Tools?.OfType<AIFunctionDeclaration>() ?? [];

    private static string NormalizeRequestedTool(string tool, JsonObject args)
    {
        if (tool != "officecli") return tool;
        if (args.ContainsKey("argv") || args.ContainsKey("args") || args.ContainsKey("commandArgs"))
        {
            return "officecli_mutate";
        }

        var operation = NormalizeOfficeCliOperation(GetString(args, "operation") ?? GetString(args, "command") ?? "view");
        var readOnly = operation is "capabilities" or "help" or "view" or "get" or "query" or "validate" or "dump" or "raw" or "open";
        return readOnly ? "officecli" : "officecli_mutate";
    }

    private static string NormalizeOfficeCliOperation(string operation)
    {
        var normalized = operation.Trim().ToLowerInvariant().Replace('-', '_');
        return normalized switch
        {
            "schema" or "help_schema" => "help",
            "inspect" or "view_outline" => "view",
            "read_node" or "read_range" => "get",
            "find_nodes" => "query",
            "set_cell_value" or "set_cell_fill" or "rename_sheet" => "set",
            "delete" => "remove",
            _ => normalized.Replace('_', '-'),
        };
    }

    private static string? GetString(JsonObject args, string key) =>
        args.TryGetPropertyValue(key, out var value) && value is not null
            ? ToClrValue(value)?.ToString()
            : null;

    private static Dictionary<string, object?> ToArgumentDictionary(JsonObject args)
    {
        var result = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in args)
        {
            result[key] = ToClrValue(value);
        }
        return result;
    }

    private static object? ToClrValue(JsonNode? node)
    {
        if (node is null) return null;
        if (node is JsonArray array) return array.Select(ToClrValue).ToArray();
        if (node is JsonObject obj)
        {
            var dictionary = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var (key, child) in obj)
            {
                dictionary[key] = ToClrValue(child);
            }
            return dictionary;
        }

        if (node is JsonValue scalar)
        {
            if (scalar.TryGetValue<string>(out var text)) return text;
            if (scalar.TryGetValue<int>(out var intValue)) return intValue;
            if (scalar.TryGetValue<long>(out var longValue)) return longValue;
            if (scalar.TryGetValue<double>(out var doubleValue)) return doubleValue;
            if (scalar.TryGetValue<bool>(out var boolValue)) return boolValue;
        }

        return JsonSerializer.Deserialize<object?>(node.ToJsonString(), JsonOptions.Compact);
    }
}
