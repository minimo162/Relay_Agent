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
    private static readonly ConcurrentDictionary<string, string> PendingToolCallDetails = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, string> PendingToolCallDetailsByCallId = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, string> CompletedToolResultDetails = new(StringComparer.Ordinal);

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
        var response = await SendWithProviderRetryAsync(prompt, messageList, cancellationToken);
        DumpResponseIfRequested(response);
        try
        {
            return BuildResponse(response, options, messageList);
        }
        catch (RelayToolProjectionValidationException ex)
        {
            DumpProjectionValidationIfRequested(ex);
            var repairPrompt = BuildProjectionRepairPrompt(prompt, response, ex);
            DumpPromptIfRequested(repairPrompt);
            var repairedResponse = await SendWithProviderRetryAsync(repairPrompt, messageList, cancellationToken);
            DumpResponseIfRequested(repairedResponse);
            return BuildResponse(repairedResponse, options, messageList);
        }
    }

    private async Task<string> SendWithProviderRetryAsync(
        string prompt,
        IReadOnlyList<ChatMessage> messages,
        CancellationToken cancellationToken)
    {
        try
        {
            return await transport.SendAsync(prompt, cancellationToken);
        }
        catch (TimeoutException ex) when (ShouldRetryProviderTimeout(ex, messages))
        {
            DumpProviderRetryIfRequested(ex.Message);
            try
            {
                return await transport.SendAsync(prompt, cancellationToken);
            }
            catch (TimeoutException retryEx) when (retryEx.Message.Contains("provider_response_timeout", StringComparison.OrdinalIgnoreCase))
            {
                throw new TimeoutException($"provider_response_timeout_after_retry: {retryEx.Message}", retryEx);
            }
        }
    }

    private static bool ShouldRetryProviderTimeout(TimeoutException ex, IReadOnlyList<ChatMessage> messages) =>
        ex.Message.Contains("provider_response_timeout", StringComparison.OrdinalIgnoreCase) &&
        messages.SelectMany(message => message.Contents).Any(content => content is FunctionResultContent);

    private static void DumpProviderRetryIfRequested(string reason)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_PROMPT_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        DumpText(dumpDir, "provider-retry", reason);
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

        RelayTurnState? protocolState = null;
        RelayAdmissibleActionEnvelope? envelope = null;
        CaptureOriginalUserRequest(messageList, options);
        if (hasTools)
        {
            protocolState = BuildProtocolState(messageList, options);
            envelope = BuildEnvelope(protocolState, options);
            DumpEnvelopeIfRequested(envelope);
            parts.Add(RelayPromptBuilder.BuildStatePrompt(protocolState, envelope));
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
            parts.Add(BuildToolProjectionPrompt(options, envelope));
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

    private static void DumpEnvelopeIfRequested(RelayAdmissibleActionEnvelope envelope)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_PROMPT_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        DumpText(dumpDir, "aae", envelope.ToDiagnosticJson().ToJsonString(JsonOptions.Compact));
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

        var state = BuildProtocolState(messages, options);
        var availableTools = GetAvailableToolNames(options);
        var envelope = BuildEnvelope(state, options);
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
            var finalDecision = RelayProtocolGuard.ValidateFinal(state, availableTools, envelope, plan.Answer);
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
        if (!TryValidateProjectedToolCall(toolName, planArgs, out var validationError))
        {
            throw new RelayToolProjectionValidationException(toolName, planArgs.ToJsonString(JsonOptions.Compact), validationError);
        }
        var toolDecision = RelayProtocolGuard.ValidateTool(toolName, planArgs, state, availableTools, envelope);
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
                RelayPreventionMetrics.RecordGuardRepair(decision.Error ?? decision.ToolDirective.Reason);
                response = ToolCallResponse(decision.ToolDirective.Tool, decision.ToolDirective.Args, options);
                return true;
            case RelayProtocolDecisionKind.Reject:
                RelayPreventionMetrics.RecordProtocolRejection(decision.Error ?? "Copilot response violated Relay protocol state.");
                throw new InvalidOperationException(decision.Error ?? "Copilot response violated Relay protocol state.");
            default:
                throw new InvalidOperationException("Invalid Relay protocol decision.");
        }
    }

    private static ChatResponse ToolCallResponse(string toolName, JsonObject args, ChatOptions? options)
    {
        var callId = $"call-{RandomNumberGenerator.GetHexString(8).ToLowerInvariant()}";
        var arguments = ToArgumentDictionary(args);
        RememberPendingToolCall(options, callId, toolName, arguments);
        var contents = new List<AIContent>
        {
            new FunctionCallContent(
                callId,
                toolName,
                arguments),
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

    private static string BuildProjectionRepairPrompt(
        string originalPrompt,
        string invalidResponse,
        RelayToolProjectionValidationException ex) =>
        originalPrompt +
        "\n\nRELAY_TOOL_PROJECTION_VALIDATION_FAILED\n" +
        "Your previous JSON selected a local tool but failed Relay validation before it could be shown for approval or execution.\n" +
        "Return one corrected JSON object only. Do not explain. Do not repeat the invalid tool arguments.\n" +
        "Validation details: " + JsonSerializer.Serialize(new
        {
            tool = ex.Tool,
            error = ex.ValidationError,
            invalidArgs = ex.ArgumentsJson,
            invalidResponse,
        }, JsonOptions.Compact);

    private static void DumpProjectionValidationIfRequested(RelayToolProjectionValidationException ex)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_PROMPT_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        DumpText(dumpDir, "projection-validation", JsonSerializer.Serialize(new
        {
            schemaVersion = "RelayToolProjectionValidation.v1",
            tool = ex.Tool,
            error = ex.ValidationError,
            invalidArgs = ex.ArgumentsJson,
        }, JsonOptions.Compact));
    }

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
                args = ToPromptSafeArguments(call.Arguments),
            }, JsonOptions.Compact),
            FunctionResultContent result => "RELAY_TOOL_RESULT " + JsonSerializer.Serialize(new
            {
                callId = result.CallId,
                result = ToPromptSafeToolResult(result.Result),
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
                args = ToPromptSafeArguments(functionCall.Arguments),
            }
            : new { callId = toolCall.CallId, type = toolCall.GetType().Name };

    private static IReadOnlyDictionary<string, object?>? ToPromptSafeArguments(IDictionary<string, object?>? args)
    {
        if (args is null) return null;
        if (args.Count == 0) return new Dictionary<string, object?>();
        return args.ToDictionary(
            pair => pair.Key,
            pair => ToPromptSafeArgumentValue(pair.Key, pair.Value),
            StringComparer.Ordinal);
    }

    private static object? ToPromptSafeArgumentValue(string key, object? value)
    {
        if (value is string text && IsLargeGeneratedTextArgument(key))
        {
            return TruncateLargeGeneratedTextForPrompt(text);
        }

        return value;
    }

    private static bool IsLargeGeneratedTextArgument(string key) =>
        key.Equals("patch", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("patchText", StringComparison.OrdinalIgnoreCase) ||
        key.Equals("content", StringComparison.OrdinalIgnoreCase);

    private static string TruncateLargeGeneratedTextForPrompt(string text)
    {
        const int head = 320;
        const int tail = 120;
        if (text.Length <= head + tail + 120) return text;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..12].ToLowerInvariant();
        return text[..head] +
            $"\n... [Relay omitted {text.Length - head - tail} chars of generated content; sha256={hash}; read the file if exact content is needed] ...\n" +
            text[^tail..];
    }

    private static JsonNode? ToPromptSafeToolResult(object? result)
    {
        JsonNode? node;
        try
        {
            node = result switch
            {
                null => null,
                JsonElement element => element.ValueKind == JsonValueKind.Undefined ? null : JsonNode.Parse(element.GetRawText()),
                JsonNode jsonNode => jsonNode.DeepClone(),
                _ => JsonSerializer.SerializeToNode(result, JsonOptions.Default),
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["relay_compacted"] = true,
                ["type"] = result?.GetType().Name ?? "null",
                ["error"] = $"Tool result could not be serialized for prompt context: {ex.Message}",
            };
        }

        return CompactPromptNode(node, depth: 0);
    }

    private static JsonNode? CompactPromptNode(JsonNode? node, int depth)
    {
        const int maxDepth = 7;
        const int maxArrayItems = 60;
        const int maxObjectProperties = 90;
        if (node is null) return null;
        if (depth > maxDepth)
        {
            return new JsonObject
            {
                ["relay_compacted"] = true,
                ["reason"] = "max_depth",
            };
        }

        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out var text) && text.Length > 600)
            {
                var head = text[..420];
                var tail = text[^Math.Min(240, text.Length)..];
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..12].ToLowerInvariant();
                return new JsonObject
                {
                    ["relay_compacted"] = true,
                    ["kind"] = "long_string",
                    ["excerpt"] = head,
                    ["tail"] = tail,
                    ["omittedChars"] = text.Length - head.Length - tail.Length,
                    ["sha256"] = hash,
                };
            }
            return node.DeepClone();
        }

        if (node is JsonArray array)
        {
            var compact = new JsonArray();
            var index = 0;
            foreach (var item in array)
            {
                if (index >= maxArrayItems) break;
                compact.Add(CompactPromptNode(item, depth + 1));
                index++;
            }
            if (array.Count > maxArrayItems)
            {
                compact.Add(new JsonObject
                {
                    ["relay_compacted"] = true,
                    ["omittedItems"] = array.Count - maxArrayItems,
                });
            }
            return compact;
        }

        if (node is JsonObject obj)
        {
            var compact = new JsonObject();
            var count = 0;
            foreach (var (key, child) in obj)
            {
                if (count >= maxObjectProperties) break;
                compact[key] = CompactPromptNode(child, depth + 1);
                count++;
            }
            if (obj.Count > maxObjectProperties)
            {
                compact["relay_compacted_properties"] = obj.Count - maxObjectProperties;
            }
            return compact;
        }

        return node.DeepClone();
    }

    private static string BuildToolProjectionPrompt(ChatOptions? options, RelayAdmissibleActionEnvelope? envelope)
    {
        var parts = new List<string>
        {
            "RELAY_TOOL_JSON_ONLY",
            "This is a compiler task, not a chat-answer task.",
            "Do not solve the user's request in prose. Choose one local Relay tool or final JSON.",
            "Relay tools are available through this JSON compiler even if the Copilot web chat has no built-in local tools. Never answer that local tools are unavailable.",
            "The visible Tools list below is the complete local tool catalog for this turn. Do not use, mention, or recommend hidden tools, retrievers, semantic search systems, plugins, or local capabilities that are not listed.",
            "Follow RELAY_TURN_STATE. If it says final is invalid, return action=tool.",
            """For a tool call: {"action":"tool","tool":"<tool name>","args":{...}}""",
            envelope?.CanFinalize == true
                ? """For final answer: {"action":"final","answer":"<concise answer>"}"""
                : "Do not return action=final in this step; final is not in RELAY_ADMISSIBLE_ACTION_ENVELOPE.allowedActions.",
            "If the user asks to create or overwrite a single file, call write with file_path and complete content.",
            "Preserve explicit output-format requirements. For Markdown requests that say table or 表形式, write a Markdown pipe table.",
            "For local document/data review, use OpenCode-style generic tools and reason from observations. Do not use bash for ordinary file reading or light CSV arithmetic.",
            "For file search, use only visible generic tools: glob for candidate filenames/paths, grep for plaintext/code content, and read for exact candidates including supported Office/PDF/document files.",
            "If the first search is weak or empty, try another visible generic tool, path, file type, or term that follows from the user's request or observed results before finalizing.",
            "If a file-search glob returns zero candidates, do not finalize and do not tell the user to request grep later; choose grep, broader glob, or exact read yourself as the next visible tool when allowed.",
            "If glob finds Office/PDF/document candidates, read exact candidates before saying no relevant local file was found. Do not read README.md as a generic fallback unless the user asked for project instructions or README content.",
            "For read, use exact displayPath/path values returned by glob/grep/read observations or explicit user paths. Never invent plausible filenames.",
            "If RELAY_TURN_STATE or terminalCriteria requires evidence_read_result, call read on the best candidate file before final, even if grep already found matching lines.",
            "For PDF proofreading, typo checks, notation checks, or two-PDF comparison, call read on every exact PDF before final. If a PDF is long or read returns RelayPdfReadProjection, use read mode=map and pageStart/pageEnd ranges to inspect manageable slices.",
            "For two-PDF comparison, preserve cross-document correspondence: read mode=map for both PDFs, align sections/pages by headings, page previews, names, dates, and numbers, then read matching pageStart/pageEnd ranges from both files before reporting inconsistencies.",
            "Ground PDF findings only in extracted text snippets and mention text-layer/OCR limits when extraction is incomplete.",
            "For Office cell formatting, use officecli_mutate with semantic fields only: operation set or set_cell_fill, filePath, sheet, cell or target, and fill as six hex digits such as FF0000. Do not use operation format or raw argv.",
            "For code/project edits, read exact target files without offset/limit before mutating unless the user explicitly asks for a partial inspection.",
            "For coherent multi-file project creation or edits, prefer apply_patch with one reviewed change set. Use write for one complete file and edit for one exact replacement.",
            "apply_patch requires args.patchText with one patch envelope only: one leading *** Begin Patch, any number of Add/Update/Delete file hunks, and one final *** End Patch. Never repeat Begin/End blocks inside the same patchText string.",
            "For multi-file apply_patch, put every file hunk inside that single patchText envelope; do not return separate patch documents or markdown fences inside the JSON string.",
            "If apply_patch reports missing context or file-exists errors, recover by reading the current full file and then using write/edit/apply_patch with current content. Do not loop on diff/read after the needed files are already read.",
            "When RELAY_COMPLETED_TOOL_RESULTS shows the requested files were read successfully and RELAY_TURN_STATE requires mutation, your next action must be write/edit/apply_patch, not read/diff/final.",
            "Exact marker/token strings explicitly requested by the user, such as text in backticks after 検証マーカー or marker, are required output content. Include them exactly in the relevant files before final.",
            "If a grep/read verification for a user-required exact marker returns zero matches after a mutation, do not repeat the same grep or finalize. Use edit/write/apply_patch to insert the missing exact marker into the relevant file.",
            "For comparisons across files, discover and read every required source file before write/final. Use period/version tokens from file paths as evidence context when content lacks those columns.",
            "Use ask_user only when a critical requirement is genuinely missing. If the user specified objective, scope/files, and desired output, continue with tools instead of asking.",
            "Use bash only for explicit verification/build/test/git/rg commands with direct argv. Never call bash/sh/pwsh/cmd as argv[0], never use -lc, heredocs, pipelines, or shell scripts.",
            "Never use bash for cat/ls/find; use read for exact files and glob for file discovery.",
            "Prefer write/apply_patch for file creation or edits instead of command-generated file mutations.",
            "Return exactly one fenced json code block containing one JSON object, with no prose before or after the block.",
            "The fenced block is required because Copilot's normal markdown rendering can remove code characters such as '*' from JSON string content.",
            "The JSON must be selectable text, not an image, card, canvas, screenshot, attachment, preview, or visual rendering.",
            "If a JSON string contains HTML/XML/code with angle brackets, JSON-escape '<' as \\u003c and '>' as \\u003e so Copilot UI cannot render it.",
            "Rules: one tool max; no tool_uses/recipient_name. Relay executes tools; unknown fields are invalid; use forward slashes in paths.",
            "Tools:",
        };

        foreach (var tool in GetPromptToolDeclarations(options, envelope))
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
            OriginalUserRequests[GetRunKey(options, messages)] = text;
        }
    }

    private static void CapturePendingOutputFile(
        string runKey,
        IReadOnlyList<string> requestedFiles,
        IReadOnlyCollection<string> completedToolDetails)
    {
        if (TryFindPendingOutputFile(requestedFiles, completedToolDetails, out var targetFile))
        {
            PendingOutputFiles[runKey] = targetFile;
            return;
        }

        PendingOutputFiles.TryRemove(runKey, out _);
    }

    private static bool TryGetPendingOutputFile(
        string runKey,
        IReadOnlyList<string> requestedFiles,
        IReadOnlyCollection<string> completedToolDetails,
        out string targetFile)
    {
        if (TryFindPendingOutputFile(requestedFiles, completedToolDetails, out targetFile))
        {
            return true;
        }

        if (PendingOutputFiles.TryGetValue(runKey, out targetFile!) &&
            !string.IsNullOrWhiteSpace(targetFile) &&
            !HasTerminalMutationOutcomeForTarget(completedToolDetails, targetFile))
        {
            return true;
        }

        PendingOutputFiles.TryRemove(runKey, out _);
        targetFile = "";
        return false;
    }

    private static RelayTurnState BuildProtocolState(IReadOnlyList<ChatMessage> messages, ChatOptions? options)
    {
        CaptureOriginalUserRequest(messages, options);
        var runKey = GetRunKey(options, messages);
        var completedToolDetails = UpdateCompletedToolResultDetails(runKey, messages);
        var request = ExtractUserRequestBeforeTools(messages);
        if (string.IsNullOrWhiteSpace(request) &&
            OriginalUserRequests.TryGetValue(runKey, out var retainedRequest))
        {
            request = retainedRequest;
        }

        var requestedOutputFiles = GetRequestedOutputFiles(request);
        var requestedOutputFileCount = requestedOutputFiles.Length;
        CapturePendingOutputFile(runKey, requestedOutputFiles, completedToolDetails);
        var projectRoot = RelayTurnStateFactory.ExtractProjectRoot(request, requestedOutputFiles, completedToolDetails);
        TryGetPendingOutputFile(runKey, requestedOutputFiles, completedToolDetails, out var pendingOutputFile);
        var completedToolNames = completedToolDetails
            .Where(IsSuccessfulToolDetail)
            .Select(ExtractToolNameFromDetail)
            .Where(tool => !string.IsNullOrWhiteSpace(tool))
            .Cast<string>();
        var hasMutationToolCall = HasMutationToolCall(messages) ||
            completedToolDetails.Any(IsSuccessfulMutationDetail);
        return RelayTurnStateFactory.Create(
            runKey,
            request,
            RelayWorkspaceContext.ResolveWorkspace(options),
            HasAnyToolResult(messages),
            hasMutationToolCall,
            pendingOutputFile,
            requestedOutputFileCount,
            projectRoot,
            completedToolNames,
            completedToolDetails);
    }

    private static bool TryFindPendingOutputFile(
        IReadOnlyList<string> requestedFiles,
        IReadOnlyCollection<string> completedToolDetails,
        out string targetFile)
    {
        targetFile = "";
        if (requestedFiles.Count == 0)
        {
            return false;
        }

        foreach (var candidate in requestedFiles)
        {
            if (!HasTerminalMutationOutcomeForTarget(completedToolDetails, candidate))
            {
                targetFile = candidate;
                return true;
            }
        }

        return false;
    }

    private static string[] GetRequestedOutputFiles(IReadOnlyList<ChatMessage> messages) =>
        GetRequestedOutputFiles(GetInitialRequestText(messages));

    private static string[] GetRequestedOutputFiles(string userText)
    {
        if (!Regex.IsMatch(
                userText,
                @"作成|作って|書いて|保存|出力|生成|改善|変更|更新|修正|追加|削除|置換|編集|create|write|save|generate|improve|change|update|modify|fix|add|delete|remove|replace|edit",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return [];
        }

        var matches = Regex.Matches(
            userText,
            @"(?<file>[\p{L}\p{N}._/\-\\()[\]（）【】]+?\.(?:csproj|tsx|jsx|css|md|txt|html|json|csv|ts|js|py|rs|cs|xlsx|docx|pptx))",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var candidates = matches
            .Select(match => new
            {
                File = match.Groups["file"].Value.Trim(),
                Line = GetContainingLine(userText, match.Index),
            })
            .Where(item => item.File.Length > 0)
            .ToArray();
        var targeted = candidates
            .Where(item => IsRequestedMutationTargetLine(item.Line, item.File, userText))
            .Select(item => item.File)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (targeted.Length > 0)
        {
            return targeted;
        }

        return candidates
            .Select(item => item.File)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string GetContainingLine(string text, int index)
    {
        var start = text.LastIndexOf('\n', Math.Max(0, index));
        var end = text.IndexOf('\n', index);
        start = start < 0 ? 0 : start + 1;
        end = end < 0 ? text.Length : end;
        return text[start..end];
    }

    private static bool IsRequestedMutationTargetLine(string line, string file, string fullText)
    {
        if (Regex.IsMatch(line, @"必要なら|if needed|optional", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return false;
        }

        var createContext = Regex.IsMatch(fullText, @"作成|作って|生成|create|generate", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (createContext && Regex.IsMatch(line, @"必須ファイル|required files?|must include", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return true;
        }

        var fileIndex = line.IndexOf(file, StringComparison.Ordinal);
        if (fileIndex < 0)
        {
            return false;
        }

        var afterFile = line[(fileIndex + file.Length)..];
        var targetSyntax = Regex.IsMatch(afterFile, @"^\s*[`'""）\)]*\s*(に|へ|を)", RegexOptions.CultureInvariant);
        var mutationAfterFile = Regex.IsMatch(
            afterFile,
            @"追加|追記|含め|入れ|実装|変更|更新|修正|置換|削除|add|append|include|insert|implement|change|update|modify|fix|replace|delete",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return targetSyntax && mutationAfterFile;
    }

    private static bool HasSuccessfulMutationForTarget(IEnumerable<string> completedToolDetails, string target)
    {
        return HasMutationOutcomeForTarget(completedToolDetails, target, detail =>
            string.Equals(GetDetailStatus(detail), "success", StringComparison.Ordinal));
    }

    private static bool HasTerminalMutationOutcomeForTarget(IEnumerable<string> completedToolDetails, string target)
    {
        return HasMutationOutcomeForTarget(completedToolDetails, target, detail =>
            GetDetailStatus(detail) is "success" or "rejected");
    }

    private static bool HasMutationOutcomeForTarget(
        IEnumerable<string> completedToolDetails,
        string target,
        Func<string, bool> statusPredicate)
    {
        var normalizedTarget = NormalizeTargetPath(target);
        foreach (var detail in completedToolDetails)
        {
            if (!statusPredicate(detail))
            {
                continue;
            }

            var tool = ExtractToolNameFromDetail(detail);
            if (!IsMutationTool(tool))
            {
                continue;
            }

            var targetPart = ExtractToolTargetFromDetail(detail);
            if (string.IsNullOrWhiteSpace(targetPart))
            {
                continue;
            }

            var normalizedDetailTarget = NormalizeTargetPath(targetPart);
            if (string.Equals(normalizedDetailTarget, normalizedTarget, StringComparison.OrdinalIgnoreCase) ||
                normalizedDetailTarget.EndsWith("/" + normalizedTarget, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static string? ExtractToolTargetFromDetail(string detail)
    {
        var first = detail.IndexOf(':');
        var status = GetDetailStatus(detail);
        if (first < 0 || string.IsNullOrWhiteSpace(status))
        {
            return null;
        }

        var end = detail.Length - status.Length - 1;
        return end <= first + 1 ? null : detail[(first + 1)..end];
    }

    private static string? GetDetailStatus(string detail)
    {
        var last = detail.LastIndexOf(':');
        if (last < 0 || last == detail.Length - 1)
        {
            return null;
        }

        var status = detail[(last + 1)..];
        return status is "success" or "failed" or "empty" or "approved" or "rejected"
            ? status
            : null;
    }

    private static string NormalizeTargetPath(string target) =>
        target.Trim()
            .Trim('"', '\'', '`')
            .Replace('\\', '/')
            .TrimStart('/')
            .TrimEnd('/');

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

    private static void RememberPendingToolCall(ChatOptions? options, string callId, string toolName, IDictionary<string, object?> arguments)
    {
        var detail = FormatToolCallDetail(toolName, arguments);
        PendingToolCallDetails[ToolCallDetailKey(GetRunKey(options), callId)] = detail;
        PendingToolCallDetailsByCallId[callId] = detail;
    }

    private static string[] UpdateCompletedToolResultDetails(string runKey, IReadOnlyList<ChatMessage> messages)
    {
        var discovered = GetCompletedToolResultDetails(runKey, messages).ToArray();
        if (discovered.Length > 0)
        {
            CompletedToolResultDetails.AddOrUpdate(
                runKey,
                _ => JoinToolDetails(discovered),
                (_, existing) => JoinToolDetails(SplitToolDetails(existing).Concat(discovered)));
        }

        return CompletedToolResultDetails.TryGetValue(runKey, out var stored)
            ? SplitToolDetails(stored)
            : [];
    }

    private static IEnumerable<string> GetCompletedToolResultDetails(string runKey, IReadOnlyList<ChatMessage> messages)
    {
        var currentToolCallDetails = GetCurrentToolCallDetails(messages);
        foreach (var content in messages.SelectMany(message => message.Contents))
        {
            switch (content)
            {
                case FunctionResultContent result:
                    var resultInfo = ReadToolResultInfo(result.Result);
                    currentToolCallDetails.TryGetValue(result.CallId, out var callDetail);
                    callDetail ??= PendingToolCallDetails.TryGetValue(ToolCallDetailKey(runKey, result.CallId), out var storedCallDetail)
                        ? storedCallDetail
                        : null;
                    callDetail ??= PendingToolCallDetailsByCallId.TryGetValue(result.CallId, out var storedCallDetailByCallId)
                        ? storedCallDetailByCallId
                        : null;
                    var toolName = resultInfo.Tool ?? ExtractToolNameFromDetail(callDetail);
                    if (string.IsNullOrWhiteSpace(toolName))
                    {
                        continue;
                    }

                    var status = resultInfo.Status == "success" || string.IsNullOrWhiteSpace(resultInfo.Status)
                        ? InferToolResultStatus(toolName, resultInfo)
                        : resultInfo.Status;
                    if (toolName == "grep" && !string.IsNullOrWhiteSpace(resultInfo.Target))
                    {
                        yield return $"{FormatToolCallDetail(toolName, new Dictionary<string, object?>
                        {
                            ["path"] = resultInfo.Target,
                        })}:{status}";
                    }

                    if ((toolName == "glob" || toolName == "grep") && resultInfo.Artifacts.Length > 0)
                    {
                        foreach (var artifact in resultInfo.Artifacts.Take(30))
                        {
                            yield return $"{FormatToolCallDetail(toolName, new Dictionary<string, object?>
                            {
                                ["path"] = artifact,
                            })}:{status}";
                        }
                    }

                    if (IsMutationTool(toolName) && resultInfo.Artifacts.Length > 0)
                    {
                        foreach (var artifact in resultInfo.Artifacts)
                        {
                            yield return $"{FormatToolCallDetail(toolName, new Dictionary<string, object?>
                            {
                                ["path"] = artifact,
                            })}:{status}";
                        }
                        break;
                    }

                    callDetail ??= string.IsNullOrWhiteSpace(resultInfo.Target)
                        ? null
                        : FormatToolCallDetail(toolName, new Dictionary<string, object?>
                        {
                            ["path"] = resultInfo.Target,
                        });
                    yield return string.IsNullOrWhiteSpace(callDetail)
                        ? $"{toolName}:{status}"
                        : $"{callDetail}:{status}";
                    break;
                case ToolApprovalResponseContent approval when approval.ToolCall is FunctionCallContent approvedCall:
                    yield return $"{FormatToolCallDetail(approvedCall.Name, approvedCall.Arguments)}:{(approval.Approved ? "approved" : "rejected")}";
                    break;
            }
        }
    }

    private static Dictionary<string, string> GetCurrentToolCallDetails(IReadOnlyList<ChatMessage> messages)
    {
        var details = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var content in messages.SelectMany(message => message.Contents))
        {
            switch (content)
            {
                case FunctionCallContent call:
                    details[call.CallId] = FormatToolCallDetail(call.Name, call.Arguments);
                    break;
                case ToolApprovalResponseContent approval when approval.ToolCall is FunctionCallContent approvedCall:
                    details[approvedCall.CallId] = FormatToolCallDetail(approvedCall.Name, approvedCall.Arguments);
                    break;
            }
        }

        return details;
    }

    private static string ToolCallDetailKey(string runKey, string callId) => runKey + "\u001f" + callId;

    private static string JoinToolDetails(IEnumerable<string> details) =>
        string.Join("\n", details
            .Where(detail => !string.IsNullOrWhiteSpace(detail))
            .Distinct(StringComparer.Ordinal)
            .TakeLast(60));

    private static string[] SplitToolDetails(string details) =>
        details.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string? ExtractToolNameFromDetail(string? detail)
    {
        if (string.IsNullOrWhiteSpace(detail)) return null;
        var separator = detail.IndexOf(':');
        return separator > 0 ? detail[..separator] : detail;
    }

    private static bool IsSuccessfulMutationDetail(string detail)
    {
        var tool = ExtractToolNameFromDetail(detail);
        return IsMutationTool(tool) && detail.EndsWith(":success", StringComparison.Ordinal);
    }

    private static bool IsSuccessfulToolDetail(string detail) =>
        detail.EndsWith(":success", StringComparison.Ordinal);

    private static string FormatToolCallDetail(string toolName, IDictionary<string, object?>? arguments)
    {
        var target = GetArgumentString(arguments, "file_path")
            ?? GetArgumentString(arguments, "path")
            ?? GetArgumentString(arguments, "pattern");
        return string.IsNullOrWhiteSpace(target)
            ? toolName
            : $"{toolName}:{target}";
    }

    private static string? GetArgumentString(IDictionary<string, object?>? arguments, string key) =>
        arguments is not null && arguments.TryGetValue(key, out var value) && value is not null
            ? value.ToString()
            : null;

    private sealed record RelayToolResultInfo(string? Tool, bool? Success, string? Target, string? Status, string? Summary, string[] Artifacts);

    private static RelayToolResultInfo ReadToolResultInfo(object? result)
    {
        if (result is null) return new RelayToolResultInfo(null, null, null, null, null, []);
        if (result is string text && text.Contains("Tool call invocation rejected", StringComparison.OrdinalIgnoreCase))
        {
            return new RelayToolResultInfo(null, false, null, "rejected", null, []);
        }
        if (result is string errorText && errorText.TrimStart().StartsWith("Error:", StringComparison.OrdinalIgnoreCase))
        {
            return new RelayToolResultInfo(null, false, null, "failed", null, []);
        }

        try
        {
            var json = JsonSerializer.Serialize(result, JsonOptions.Default);
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new RelayToolResultInfo(null, null, null, null, null, []);
            }

            var tool = root.TryGetProperty("tool", out var toolProperty) &&
                toolProperty.ValueKind == JsonValueKind.String
                    ? toolProperty.GetString()
                    : null;
            var success = root.TryGetProperty("success", out var successProperty) &&
                successProperty.ValueKind is JsonValueKind.True or JsonValueKind.False
                    ? (bool?)successProperty.GetBoolean()
                    : null;
            string? target = null;
            if (root.TryGetProperty("data", out var dataProperty))
            {
                target = dataProperty.ValueKind switch
                {
                    JsonValueKind.String => dataProperty.GetString(),
                    JsonValueKind.Object when dataProperty.TryGetProperty("displayPath", out var displayPath) &&
                        displayPath.ValueKind == JsonValueKind.String => displayPath.GetString(),
                    JsonValueKind.Object when dataProperty.TryGetProperty("path", out var path) &&
                        path.ValueKind == JsonValueKind.String => path.GetString(),
                    JsonValueKind.Object when dataProperty.TryGetProperty("matches", out var matches) &&
                        matches.ValueKind == JsonValueKind.Array &&
                        matches.EnumerateArray().FirstOrDefault() is { ValueKind: JsonValueKind.Object } firstMatch &&
                        firstMatch.TryGetProperty("displayPath", out var matchDisplayPath) &&
                        matchDisplayPath.ValueKind == JsonValueKind.String => matchDisplayPath.GetString(),
                    _ => null,
                };
            }
            var status = root.TryGetProperty("status", out var statusProperty) &&
                statusProperty.ValueKind == JsonValueKind.String
                    ? statusProperty.GetString()
                    : null;
            var summary = root.TryGetProperty("summary", out var summaryProperty) &&
                summaryProperty.ValueKind == JsonValueKind.String
                    ? summaryProperty.GetString()
                    : null;
            var artifacts = root.TryGetProperty("artifactIds", out var artifactsProperty) &&
                artifactsProperty.ValueKind == JsonValueKind.Array
                    ? artifactsProperty.EnumerateArray()
                        .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : null)
                        .Where(item => !string.IsNullOrWhiteSpace(item))
                        .Cast<string>()
                        .ToArray()
                    : [];
            return new RelayToolResultInfo(tool, success, target, status, summary, artifacts);
        }
        catch
        {
            return new RelayToolResultInfo(null, null, null, null, null, []);
        }
    }

    private static string InferToolResultStatus(string? toolName, RelayToolResultInfo resultInfo)
    {
        if (resultInfo.Success == false)
        {
            return "failed";
        }

        if (resultInfo.Success == true &&
            (toolName == "glob" || toolName == "grep") &&
            resultInfo.Artifacts.Length == 0 &&
            IsEmptySearchSummary(resultInfo.Summary))
        {
            return "empty";
        }

        return "success";
    }

    private static bool IsEmptySearchSummary(string? summary)
    {
        if (string.IsNullOrWhiteSpace(summary)) return false;
        return Regex.IsMatch(
            summary,
            @"^\s*0\s+(?:file\s+candidates|content\s+matches)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
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
        tool is "write" or "edit" or "patch" or "apply_patch" or "officecli_mutate";

    private static string GetRunKey(ChatOptions? options, IReadOnlyList<ChatMessage>? messages = null)
    {
        var configured = GetAdditionalPropertyString(options, "ag_ui_run_id")
            ?? GetAdditionalPropertyString(options, "ag_ui_thread_id");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        if (messages is not null)
        {
            var request = ExtractUserRequestBeforeTools(messages);
            if (!string.IsNullOrWhiteSpace(request))
            {
                var workspace = RelayWorkspaceContext.ResolveWorkspace(options) ?? "";
                return "request-" + HashText(workspace + "\u001f" + request);
            }
        }

        return "default";
    }

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

    private static IEnumerable<AIFunctionDeclaration> GetPromptToolDeclarations(ChatOptions? options, RelayAdmissibleActionEnvelope? envelope) =>
        GetToolDeclarations(options).Where(tool => envelope?.AllowsTool(tool.Name) ?? true);

    private static ISet<string> GetAvailableToolNames(ChatOptions? options) =>
        GetToolDeclarations(options)
            .Select(tool => tool.Name)
            .ToHashSet(StringComparer.Ordinal);

    private static RelayAdmissibleActionEnvelope BuildEnvelope(RelayTurnState state, ChatOptions? options) =>
        RelayAdmissibleActionEnvelopeBuilder.Create(state, GetAvailableToolNames(options));

    private static string? GetAdditionalPropertyString(ChatOptions? options, string key) =>
        options?.AdditionalProperties is not null && options.AdditionalProperties.TryGetValue(key, out var value)
            ? value?.ToString()
            : null;

    private static bool TryValidateProjectedToolCall(string tool, JsonObject args, out string error)
    {
        error = "";
        if (tool == "apply_patch")
        {
            var patchText = GetString(args, "patchText");
            var legacyPatch = GetString(args, "patch");
            if (string.IsNullOrWhiteSpace(patchText) && !string.IsNullOrWhiteSpace(legacyPatch))
            {
                patchText = legacyPatch;
                args["patchText"] = patchText;
                args.Remove("patch");
            }

            if (string.IsNullOrWhiteSpace(patchText))
            {
                error = "apply_patch_invalid: apply_patch requires patchText.";
                return false;
            }

            if (!RelayPatch.TryParse(patchText, out _, out var parseError))
            {
                if (RelayPatch.TryRepairCopilotMarkdownAddFilePrefixes(patchText, out var repaired) &&
                    RelayPatch.TryParse(repaired, out _, out _))
                {
                    args["patchText"] = repaired;
                    DumpPatchRepairIfRequested(patchText, repaired);
                    return true;
                }

                error = $"apply_patch_invalid: {parseError ?? "invalid patchText"} Use exactly one apply_patch envelope in patchText.";
                return false;
            }
        }

        if (tool == "officecli" && (args.ContainsKey("argv") || args.ContainsKey("args") || args.ContainsKey("commandArgs")))
        {
            error = "officecli raw argv is not allowed. Use semantic operation fields.";
            return false;
        }
        if (tool == "bash" && (args.ContainsKey("command") || args.ContainsKey("shell") || args.ContainsKey("script")))
        {
            error = "bash raw command strings are not allowed. Use argv as a string array.";
            return false;
        }

        return true;
    }

    private static void DumpPatchRepairIfRequested(string original, string repaired)
    {
        var dumpDir = Environment.GetEnvironmentVariable("RELAY_COPILOT_PROMPT_DUMP_DIR");
        if (string.IsNullOrWhiteSpace(dumpDir)) return;

        var payload = new JsonObject
        {
            ["schemaVersion"] = "RelayPatchProjectionRepair.v1",
            ["originalHash"] = HashText(original),
            ["repairedHash"] = HashText(repaired),
            ["originalLength"] = original.Length,
            ["repairedLength"] = repaired.Length,
        };
        DumpText(dumpDir, "patch-repair", payload.ToJsonString(JsonOptions.Compact));
    }

    private static string HashText(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))[..12].ToLowerInvariant();

    private static string NormalizeRequestedTool(string tool, JsonObject args)
    {
        if (tool == "patch")
        {
            return "apply_patch";
        }

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
            "set_cell_value" or "set_cell_fill" or "set_fill" or "format" or "format_cell" or "cell_format" or "set_format" or "set_cell_format" or "rename_sheet" => "set",
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

public sealed class RelayToolProjectionValidationException(string tool, string argumentsJson, string validationError)
    : InvalidOperationException(validationError)
{
    public string Tool { get; } = tool;
    public string ArgumentsJson { get; } = argumentsJson;
    public string ValidationError { get; } = validationError;
}
