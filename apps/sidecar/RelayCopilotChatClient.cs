using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;
using Microsoft.Extensions.AI;

public sealed class RelayCopilotChatClient(ICopilotTransport transport) : IChatClient
{
    private static readonly ConcurrentDictionary<string, string> PendingOutputFiles = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, string> OriginalUserRequests = new(StringComparer.Ordinal);

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
        var messageList = messages.ToArray();
        var prompt = BuildPrompt(messageList, options);
        if (string.IsNullOrWhiteSpace(prompt))
        {
            throw new InvalidOperationException("RelayCopilotChatClient requires at least one non-empty chat message.");
        }

        DumpPromptIfRequested(prompt);
        var response = await transport.SendAsync(prompt, cancellationToken);
        DumpResponseIfRequested(response);
        return BuildResponse(response, options, messageList);
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var response = await GetResponseAsync(messages, options, cancellationToken);
        var responseId = GetAdditionalPropertyString(options, "ag_ui_run_id") ?? response.ResponseId;
        var conversationId = GetAdditionalPropertyString(options, "ag_ui_thread_id");
        foreach (var update in response.ToChatResponseUpdates())
        {
            update.ConversationId = conversationId;
            update.ResponseId = responseId;
            update.MessageId ??= $"relay-message-{RandomNumberGenerator.GetHexString(8).ToLowerInvariant()}";
            update.CreatedAt ??= DateTimeOffset.UtcNow;
            yield return update;
        }
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

        var agUiContext = BuildAgUiContextPrompt(options);
        if (!string.IsNullOrWhiteSpace(agUiContext))
        {
            parts.Add(agUiContext);
        }

        CaptureOriginalUserRequest(messageList, options);
        if (hasTools)
        {
            CapturePendingOutputFile(messageList, options);
            parts.Add(RelayPromptBuilder.BuildStatePrompt(BuildProtocolState(messageList, options)));
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

    private static void DumpPromptIfRequested(string prompt)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_PROMPT_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        DumpText(dumpDir, "prompt", prompt);
    }

    private static void DumpResponseIfRequested(string response)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_RESPONSE_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        DumpText(dumpDir, "response", response);
    }

    private static void DumpText(string dumpDir, string kind, string text)
    {
        Directory.CreateDirectory(dumpDir);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..12].ToLowerInvariant();
        var path = Path.Combine(dumpDir, $"relay-copilot-{kind}-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}-{hash}.txt");
        File.WriteAllText(path, text, Encoding.UTF8);
    }

    private static ChatResponse BuildResponse(string responseText, ChatOptions? options, IReadOnlyList<ChatMessage> messages)
    {
        if (!GetToolDeclarations(options).Any())
        {
            return TextResponse(responseText, options);
        }

        var availableTools = GetAvailableToolNames(options);
        var state = BuildProtocolState(messages, options);
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
            var finalDecision = RelayProtocolGuard.ValidateFinal(state, availableTools);
            if (TryApplyProtocolDecision(finalDecision, options, out var finalResponse))
            {
                return finalResponse;
            }
            return TextResponse(plan.Answer ?? "", options);
        }

        if (plan.Action != "tool" || string.IsNullOrWhiteSpace(plan.Tool))
        {
            throw new InvalidOperationException("Copilot tool projection must return action=tool or action=final.");
        }

        var planArgs = plan.Args ?? new JsonObject();
        var toolName = NormalizeRequestedTool(plan.Tool, planArgs);
        ValidateProjectedToolCall(toolName, planArgs);
        var toolDecision = RelayProtocolGuard.ValidateTool(toolName, planArgs, state, availableTools);
        if (TryApplyProtocolDecision(toolDecision, options, out var toolResponse))
        {
            return toolResponse;
        }

        return ToolCallResponse(toolName, planArgs, options);
    }

    private static bool TryApplyProtocolDecision(
        RelayProtocolDecision decision,
        ChatOptions? options,
        out ChatResponse response)
    {
        response = default!;
        switch (decision.Kind)
        {
            case RelayProtocolDecisionKind.Allow:
                return false;
            case RelayProtocolDecisionKind.ReplaceWithTool when decision.ToolDirective is not null:
                response = ToolCallResponse(decision.ToolDirective.Tool, decision.ToolDirective.Args, options);
                return true;
            case RelayProtocolDecisionKind.Reject:
                throw new InvalidOperationException(decision.Error ?? "Copilot response violated Relay protocol state.");
            default:
                throw new InvalidOperationException("Invalid Relay protocol decision.");
        }
    }

    private static ChatResponse ToolCallResponse(string toolName, JsonObject args, ChatOptions? options)
    {
        var contents = new List<AIContent>
        {
            new FunctionCallContent(
                $"call-{RandomNumberGenerator.GetHexString(8).ToLowerInvariant()}",
                toolName,
                ToArgumentDictionary(args)),
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
            "RELAY_TOOL_JSON_ONLY",
            "This is a compiler task, not a chat-answer task.",
            "Do not solve the user's request in prose. Choose one local Relay tool or final JSON.",
            "Relay tools are available through this JSON compiler even if the Copilot web chat has no built-in local tools. Never answer that local tools are unavailable.",
            "Follow RELAY_TURN_STATE. If it says final is invalid, return action=tool.",
            """For a tool call: {"action":"tool","tool":"<tool name>","args":{...}}""",
            """For final answer: {"action":"final","answer":"<concise answer>"}""",
            "If the user asks to create or overwrite a file, call write with file_path and complete content.",
            "Preserve explicit output-format requirements. For Markdown requests that say table or 表形式, write a Markdown pipe table.",
            "For local document/data review, use glob/read/grep first and reason from those results. Do not use bash for ordinary file reading or light CSV arithmetic.",
            "For comparisons across files, discover and read every required source file before write/final. Use period/version tokens from file paths as evidence context when content lacks those columns.",
            "Use ask_user only when a critical requirement is genuinely missing. If the user specified objective, scope/files, and desired output, continue with tools instead of asking.",
            "Use bash only for explicit verification/build/test/git/rg commands with direct argv. Never call bash/sh/pwsh/cmd as argv[0], never use -lc, heredocs, pipelines, or shell scripts.",
            "Never use bash for cat/ls/find; use read for exact files and glob for file discovery.",
            "Prefer write/apply_patch for file creation or edits instead of command-generated file mutations.",
            "Return exactly one plain JSON object. Do not use markdown, prose, headings, bullets, or code fences.",
            "If a JSON string contains HTML/XML/code with angle brackets, JSON-escape '<' as \\u003c and '>' as \\u003e so Copilot UI cannot render it.",
            "Rules: one tool max; no tool_uses/recipient_name. Relay executes tools; unknown fields are invalid; use forward slashes in paths.",
            "Tools:",
        };

        foreach (var tool in GetToolDeclarations(options))
        {
            parts.Add($"- {tool.Name}({SummarizeToolArguments(tool.JsonSchema)}): {CompactToolDescription(tool.Description)}");
        }

        return string.Join("\n", parts);
    }

    private static void CaptureOriginalUserRequest(IReadOnlyList<ChatMessage> messages, ChatOptions? options)
    {
        var text = ExtractUserRequestBeforeTools(messages);
        if (!string.IsNullOrWhiteSpace(text))
        {
            OriginalUserRequests[GetRunKey(options)] = text;
        }
    }

    private static void CapturePendingOutputFile(IReadOnlyList<ChatMessage> messages, ChatOptions? options)
    {
        if (TryFindPendingOutputFile(messages, out var targetFile))
        {
            PendingOutputFiles[GetRunKey(options)] = targetFile;
        }
    }

    private static bool TryGetPendingOutputFile(IReadOnlyList<ChatMessage> messages, ChatOptions? options, out string targetFile)
    {
        if (TryFindPendingOutputFile(messages, out targetFile))
        {
            return true;
        }

        return PendingOutputFiles.TryGetValue(GetRunKey(options), out targetFile!) &&
            !string.IsNullOrWhiteSpace(targetFile);
    }

    private static RelayTurnState BuildProtocolState(IReadOnlyList<ChatMessage> messages, ChatOptions? options)
    {
        CaptureOriginalUserRequest(messages, options);
        CapturePendingOutputFile(messages, options);
        var runKey = GetRunKey(options);
        var request = ExtractUserRequestBeforeTools(messages);
        if (string.IsNullOrWhiteSpace(request) &&
            OriginalUserRequests.TryGetValue(runKey, out var retainedRequest))
        {
            request = retainedRequest;
        }

        TryGetPendingOutputFile(messages, options, out var pendingOutputFile);
        return RelayTurnStateFactory.Create(
            runKey,
            request,
            RelayWorkspaceContext.ResolveWorkspace(options),
            HasAnyToolResult(messages),
            HasMutationToolCall(messages),
            pendingOutputFile,
            GetCompletedToolNames(messages));
    }

    private static bool TryFindPendingOutputFile(IReadOnlyList<ChatMessage> messages, out string targetFile)
    {
        targetFile = "";
        var userText = GetInitialRequestText(messages);
        if (!Regex.IsMatch(
                userText,
                @"作成|作って|書いて|保存|出力|生成|create|write|save|generate",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return false;
        }

        var matches = Regex.Matches(
            userText,
            @"(?<file>[\p{L}\p{N}._/\-\\()[\]（）【】]+?\.(?:md|txt|html|json|csv|ts|tsx|js|jsx|py|rs|cs|css|xlsx|docx|pptx))",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (matches.Count == 0)
        {
            return false;
        }

        targetFile = matches[^1].Groups["file"].Value.Trim();
        return targetFile.Length > 0;
    }

    private static bool HasMutationToolCall(IReadOnlyList<ChatMessage> messages)
    {
        foreach (var message in messages)
        {
            foreach (var content in message.Contents)
            {
                if (content is FunctionCallContent call && IsMutationTool(call.Name))
                {
                    return true;
                }

                if (content is ToolApprovalResponseContent approval &&
                    approval.ToolCall is FunctionCallContent approvedCall &&
                    IsMutationTool(approvedCall.Name))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool HasAnyToolResult(IReadOnlyList<ChatMessage> messages) =>
        messages.SelectMany(message => message.Contents).Any(content =>
            content is FunctionResultContent or ToolApprovalResponseContent);

    private static IEnumerable<string> GetCompletedToolNames(IReadOnlyList<ChatMessage> messages)
    {
        foreach (var content in messages.SelectMany(message => message.Contents))
        {
            switch (content)
            {
                case FunctionCallContent call:
                    yield return call.Name;
                    break;
                case ToolApprovalResponseContent approval when approval.ToolCall is FunctionCallContent approvedCall:
                    yield return approvedCall.Name;
                    break;
            }
        }
    }

    private static string GetInitialRequestText(IReadOnlyList<ChatMessage> messages)
    {
        var plain = ExtractUserRequestBeforeTools(messages);
        if (!string.IsNullOrWhiteSpace(plain))
        {
            return plain;
        }

        var requestMessages = new List<string>();
        foreach (var message in messages)
        {
            if (message.Contents.Any(content => content is FunctionCallContent or FunctionResultContent or ToolApprovalRequestContent or ToolApprovalResponseContent))
            {
                break;
            }

            var rendered = RenderMessage(message);
            if (!string.IsNullOrWhiteSpace(rendered))
            {
                requestMessages.Add(rendered);
            }
        }

        return requestMessages.Count > 0
            ? string.Join("\n", requestMessages)
            : string.Join("\n", messages.Select(RenderMessage));
    }

    private static string ExtractUserRequestBeforeTools(IReadOnlyList<ChatMessage> messages)
    {
        var requestMessages = new List<string>();
        foreach (var message in messages)
        {
            if (message.Contents.Any(content => content is FunctionCallContent or FunctionResultContent or ToolApprovalRequestContent or ToolApprovalResponseContent))
            {
                break;
            }

            if (message.Role != ChatRole.User)
            {
                continue;
            }

            var text = message.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                text = string.Join("\n", message.Contents.OfType<TextContent>().Select(content => content.Text));
            }
            if (!string.IsNullOrWhiteSpace(text))
            {
                requestMessages.Add(text.Trim());
            }
        }

        return string.Join("\n", requestMessages).Trim();
    }

    private static bool IsMutationTool(string? tool) =>
        tool is "write" or "edit" or "apply_patch" or "officecli_mutate";

    private static string GetRunKey(ChatOptions? options) =>
        GetAdditionalPropertyString(options, "ag_ui_run_id")
        ?? GetAdditionalPropertyString(options, "ag_ui_thread_id")
        ?? "default";

    private static string CompactToolDescription(string? description)
    {
        var text = Regex.Replace(description ?? "", @"\s+", " ").Trim();
        if (text.Length == 0) return "Relay tool.";
        var end = text.IndexOf('.');
        if (end > 0) text = text[..(end + 1)];
        return text.Length <= 84 ? text : text[..84].TrimEnd() + ".";
    }

    private static string SummarizeToolArguments(JsonElement schema)
    {
        var properties = schema.TryGetProperty("properties", out var props) && props.ValueKind == JsonValueKind.Object
            ? props.EnumerateObject().Select(property => property.Name).ToArray()
            : [];
        var required = schema.TryGetProperty("required", out var req) && req.ValueKind == JsonValueKind.Array
            ? req.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Cast<string>()
                .ToHashSet(StringComparer.Ordinal)
            : [];

        if (properties.Length == 0) return "{}";

        var requiredItems = properties.Where(required.Contains).ToArray();
        var optionalItems = properties.Where(property => !required.Contains(property)).ToArray();
        var parts = new List<string>();
        if (requiredItems.Length > 0) parts.Add("req:" + string.Join("|", requiredItems));
        if (optionalItems.Length > 0) parts.Add("opt:" + string.Join("|", optionalItems));
        return string.Join(" ", parts);
    }

    private static string BuildAgUiContextPrompt(ChatOptions? options)
    {
        if (options?.AdditionalProperties is null) return "";
        var context = new JsonObject();
        var workspace = RelayWorkspaceContext.ResolveWorkspace(options);
        if (!string.IsNullOrWhiteSpace(workspace))
        {
            context["workspace"] = workspace;
        }

        return context.Count == 0
            ? ""
            : "RELAY_CONTEXT " + context.ToJsonString(JsonOptions.Compact);
    }

    private static JsonNode? TrySerializeContextValue(object? value)
    {
        if (value is null) return null;
        if (value is JsonElement element)
        {
            return element.ValueKind is JsonValueKind.Undefined
                ? null
                : JsonNode.Parse(element.GetRawText());
        }
        if (value is JsonNode node) return node.DeepClone();
        return JsonSerializer.SerializeToNode(value, JsonOptions.Default);
    }

    private static IEnumerable<AIFunctionDeclaration> GetToolDeclarations(ChatOptions? options) =>
        options?.Tools?.OfType<AIFunctionDeclaration>() ?? [];

    private static ISet<string> GetAvailableToolNames(ChatOptions? options) =>
        GetToolDeclarations(options)
            .Select(tool => tool.Name)
            .ToHashSet(StringComparer.Ordinal);

    private static string? GetAdditionalPropertyString(ChatOptions? options, string key) =>
        options?.AdditionalProperties is not null && options.AdditionalProperties.TryGetValue(key, out var value)
            ? value?.ToString()
            : null;

    private static void ValidateProjectedToolCall(string tool, JsonObject args)
    {
        if (tool == "officecli" && (args.ContainsKey("argv") || args.ContainsKey("args") || args.ContainsKey("commandArgs")))
        {
            throw new InvalidOperationException("officecli raw argv is not allowed. Use semantic operation fields.");
        }
        if (tool == "bash" && (args.ContainsKey("command") || args.ContainsKey("shell") || args.ContainsKey("script")))
        {
            throw new InvalidOperationException("bash raw command strings are not allowed. Use argv as a string array.");
        }
    }

    private static string NormalizeRequestedTool(string tool, JsonObject args)
    {
        if (tool == "bash")
        {
            var argv = GetStringArray(args, "argv");
            if (argv.Length == 2 && string.Equals(argv[0], "cat", StringComparison.OrdinalIgnoreCase))
            {
                args.Clear();
                args["file_path"] = argv[1];
                return "read";
            }

            return tool;
        }

        if (tool != "officecli") return tool;
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

    private static string[] GetStringArray(JsonObject args, string key)
    {
        if (!args.TryGetPropertyValue(key, out var value) || value is not JsonArray array)
        {
            return [];
        }

        return array
            .Select(item => item is null ? null : ToClrValue(item)?.ToString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Cast<string>()
            .ToArray();
    }

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
