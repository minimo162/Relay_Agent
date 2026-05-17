using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;

public sealed class RelayAgentFrameworkRunner
{
    private const int MaxToolIterations = 8;
    private const string AgentInstructions = """
        You are Relay Agent. M365 Copilot reasons; Relay executes local tools.
        Relay local tools are available through the function catalog even if the Copilot web chat itself has no built-in local tools.
        When the user requests local work, do not say tools are unavailable; choose a Relay tool so Relay can execute it.
        Use tools for local files, Office work, code edits, and verification.
        For workspace file discovery and document/data review, prefer glob/read/grep and then reason over the observed text.
        Use direct corpus interaction for local search: search direct terms, combine weak clues with grep allTerms/anyTerms/excludeTerms when useful, read local context around promising matches, extract new terms/entities from observations, refine the search, cross-check evidence, then answer.
        Do not treat filename/entity matches as proof by themselves when the user asks about document contents or business meaning; verify with grep/read evidence when possible.
        For comparisons across files, first discover and read every required source file before writing or finalizing.
        If the user names multiple files, read each named file that is needed for the task before finalizing.
        If the user asks to create or update a file, do not finalize until a write/apply_patch/edit/office mutation tool result exists.
        apply_patch uses args.patchText with one envelope only: one leading *** Begin Patch, all file hunks, then one final *** End Patch.
        Patch paths are workspace-relative, OpenCode-style paths. Reuse the exact displayPath returned by read/glob/workspace_status for later edits; do not shorten nested paths such as project/src/app.js to src/app.js unless that exact path exists.
        If apply_patch reports a missing or ambiguous path, use the returned candidate display paths with read/glob before retrying. Do not retry the same failing path.
        After creating or changing a multi-file project, verify expected referenced files exist before finalizing.
        Exact marker/token strings explicitly requested by the user are required output content, not optional verification notes.
        Preserve explicit output-format requirements. For Markdown requests that say table or 表形式, write a Markdown pipe table.
        Treat period, version, region, and department tokens in file names and paths as evidence context when the file content omits them.
        Use ask_user only when a critical requirement is genuinely missing. Do not ask for clarification when the user already gave the objective, target files or scope, and desired output.
        Use bash only for explicit build/test/lint/typecheck/git/rg verification commands; never wrap commands in bash/sh -lc.
        Prefer write/apply_patch for file creation or edits instead of command-generated file mutations.
        Never claim local execution without tool results. Keep final answers concise in the user's language.
        """;
    private readonly IChatClient _chatClient;
    private readonly RelayToolExecutor _tools;

    public RelayAgentFrameworkRunner(IChatClient chatClient, RelayToolExecutor tools)
    {
        _chatClient = chatClient;
        _tools = tools;
    }

    public AIAgent CreateHostedAgent()
    {
        var functionSet = new RelayAgentFunctionSet(null, _tools);
        return CreateAgUiApprovalBridge(CreateAgent(functionSet.CreateTools()));
    }

    private ChatClientAgent CreateAgent(IList<AITool> tools) =>
        new(
            CreateFunctionInvokingClient(),
            "relay-agent",
            "Relay Agent",
            AgentInstructions,
            tools,
            null,
            null);

    private static AIAgent CreateAgUiApprovalBridge(AIAgent agent) =>
        agent
            .AsBuilder()
            .Use(
                runFunc: null,
                runStreamingFunc: static (messages, session, options, innerAgent, cancellationToken) =>
                    RunAgUiApprovalBridgeStreamingAsync(messages, session!, options!, innerAgent, cancellationToken))
            .Build(null);

    private static async IAsyncEnumerable<AgentResponseUpdate> RunAgUiApprovalBridgeStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession session,
        AgentRunOptions options,
        AIAgent innerAgent,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var previousWorkspace = RelayWorkspaceContext.Current;
        var resolvedWorkspace = RelayWorkspaceContext.ResolveWorkspace(options);
        RelayWorkspaceContext.Current = resolvedWorkspace ?? previousWorkspace;
        try
        {
            var processedMessages = ConvertAgUiApprovalResponses(messages);
            await foreach (var update in innerAgent.RunStreamingAsync(processedMessages, session, options, cancellationToken))
            {
                yield return ConvertToolApprovalRequestsToAgUiClientTools(update);
            }
        }
        finally
        {
            RelayWorkspaceContext.Current = previousWorkspace;
        }
    }

    private static IEnumerable<ChatMessage> ConvertAgUiApprovalResponses(IEnumerable<ChatMessage> messages)
    {
        var materialized = messages.ToList();
        var approvalRequests = new Dictionary<string, AgUiApprovalRequest>(StringComparer.Ordinal);
        foreach (var message in materialized)
        {
            foreach (var content in message.Contents)
            {
                if (content is FunctionCallContent { Name: AgUiApprovalRequest.ToolName } call &&
                    TryReadAgUiApprovalRequest(call.Arguments, out var request))
                {
                    approvalRequests[call.CallId] = request;
                }
            }
        }

        if (approvalRequests.Count == 0)
        {
            return materialized;
        }

        var convertedMessages = new List<ChatMessage>();
        foreach (var message in materialized)
        {
            var convertedContents = new List<AIContent>();
            var convertedApprovalResult = false;
            var removedApprovalRequest = false;

            foreach (var content in message.Contents)
            {
                if (content is FunctionCallContent { Name: AgUiApprovalRequest.ToolName } call &&
                    approvalRequests.ContainsKey(call.CallId))
                {
                    removedApprovalRequest = true;
                    continue;
                }

                if (content is FunctionResultContent result &&
                    approvalRequests.TryGetValue(result.CallId, out var request) &&
                    TryReadAgUiApprovalResponse(result.Result, out var response))
                {
                    var toolCall = request.ToFunctionCall();
                    var approval = new ToolApprovalResponseContent(request.ApprovalId, response.Approved, toolCall)
                    {
                        Reason = response.Reason ?? (response.Approved ? "Approved by Relay user." : "Rejected by Relay user."),
                    };
                    convertedContents.Add(approval);
                    convertedApprovalResult = true;
                    continue;
                }

                convertedContents.Add(content);
            }

            if (removedApprovalRequest && convertedContents.Count == 0)
            {
                continue;
            }

            convertedMessages.Add(convertedApprovalResult
                ? new ChatMessage(ChatRole.User, convertedContents)
                : message);
        }

        return convertedMessages;
    }

    private static AgentResponseUpdate ConvertToolApprovalRequestsToAgUiClientTools(AgentResponseUpdate update)
    {
        List<AIContent>? converted = null;
        var contents = update.Contents;
        for (var index = 0; index < contents.Count; index++)
        {
            var content = contents[index];
            if (content is not ToolApprovalRequestContent approvalRequest)
            {
                converted?.Add(content);
                continue;
            }

            converted ??= contents.Take(index).ToList();
            converted.Add(AgUiApprovalRequest.ToClientToolCall(approvalRequest));
        }

        return converted is null ? update : new AgentResponseUpdate(update.Role, converted);
    }

    private static bool TryReadAgUiApprovalRequest(
        IDictionary<string, object?>? arguments,
        out AgUiApprovalRequest request)
    {
        request = default!;
        if (arguments is null || !arguments.TryGetValue("request", out var rawRequest))
        {
            return false;
        }

        try
        {
            request = rawRequest switch
            {
                string text => JsonSerializer.Deserialize<AgUiApprovalRequest>(text, JsonOptions.Compact)!,
                JsonElement element when element.ValueKind == JsonValueKind.String =>
                    JsonSerializer.Deserialize<AgUiApprovalRequest>(element.GetString() ?? "", JsonOptions.Compact)!,
                JsonElement element => JsonSerializer.Deserialize<AgUiApprovalRequest>(element.GetRawText(), JsonOptions.Compact)!,
                JsonNode node => JsonSerializer.Deserialize<AgUiApprovalRequest>(node.ToJsonString(), JsonOptions.Compact)!,
                _ => JsonSerializer.Deserialize<AgUiApprovalRequest>(JsonSerializer.Serialize(rawRequest, JsonOptions.Compact), JsonOptions.Compact)!,
            };
            return !string.IsNullOrWhiteSpace(request.ApprovalId)
                && !string.IsNullOrWhiteSpace(request.ToolCallId)
                && !string.IsNullOrWhiteSpace(request.FunctionName);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool TryReadAgUiApprovalResponse(object? result, out AgUiApprovalResponse response)
    {
        response = default!;
        try
        {
            response = result switch
            {
                string text => JsonSerializer.Deserialize<AgUiApprovalResponse>(text, JsonOptions.Compact)!,
                JsonElement element when element.ValueKind == JsonValueKind.String =>
                    JsonSerializer.Deserialize<AgUiApprovalResponse>(element.GetString() ?? "", JsonOptions.Compact)!,
                JsonElement element => JsonSerializer.Deserialize<AgUiApprovalResponse>(element.GetRawText(), JsonOptions.Compact)!,
                JsonNode node => JsonSerializer.Deserialize<AgUiApprovalResponse>(node.ToJsonString(), JsonOptions.Compact)!,
                _ => JsonSerializer.Deserialize<AgUiApprovalResponse>(JsonSerializer.Serialize(result, JsonOptions.Compact), JsonOptions.Compact)!,
            };
            return response is not null;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private IChatClient CreateFunctionInvokingClient()
    {
        var functionInvokingClient = _chatClient
            .AsBuilder()
            .UseFunctionInvocation(
                NullLoggerFactory.Instance,
                client =>
                {
                    client.MaximumIterationsPerRequest = MaxToolIterations;
                    client.AllowConcurrentInvocation = false;
                    client.TerminateOnUnknownCalls = true;
                    client.IncludeDetailedErrors = true;
                    client.FunctionInvoker = InvokeFunctionWithRelayWorkspaceAsync;
                })
            .Build(null);
        return new RelayWorkspaceScopeChatClient(functionInvokingClient);
    }

    private static async ValueTask<object?> InvokeFunctionWithRelayWorkspaceAsync(
        FunctionInvocationContext context,
        CancellationToken cancellationToken)
    {
        var previous = RelayWorkspaceContext.Current;
        RelayWorkspaceContext.Current = RelayWorkspaceContext.ResolveWorkspace(context.Options) ?? previous;
        try
        {
            return await context.Function.InvokeAsync(context.Arguments, cancellationToken);
        }
        finally
        {
            RelayWorkspaceContext.Current = previous;
        }
    }

}

public sealed class RelayAgentFunctionSet(
    string? workspace,
    RelayToolExecutor tools)
{
    private int _toolSequence;

    public IList<AITool> CreateTools()
    {
        return RelayAgentToolCatalog.All.Select(registration => (AITool)Function(registration)).ToList();
    }

    public Task<ToolObservation> GlobAsync(
        string pattern,
        string? path = null,
        int? limit = null,
        int? timeoutMs = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("glob", Args(
            ("pattern", pattern),
            ("path", path),
            ("limit", limit),
            ("timeoutMs", timeoutMs)), cancellationToken);

    public Task<ToolObservation> GrepAsync(
        string? pattern = null,
        string? path = null,
        string? glob = null,
        string[]? allTerms = null,
        string[]? anyTerms = null,
        string[]? excludeTerms = null,
        string[]? includeGlobs = null,
        string[]? excludeGlobs = null,
        bool? case_insensitive = null,
        bool? caseInsensitive = null,
        bool? fixedStrings = null,
        int? contextLines = null,
        int? maxMatchesPerFile = null,
        int? limit = null,
        int? timeoutMs = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("grep", Args(
            ("pattern", pattern),
            ("path", path),
            ("glob", glob),
            ("allTerms", allTerms),
            ("anyTerms", anyTerms),
            ("excludeTerms", excludeTerms),
            ("includeGlobs", includeGlobs),
            ("excludeGlobs", excludeGlobs),
            ("case_insensitive", case_insensitive),
            ("caseInsensitive", caseInsensitive),
            ("fixedStrings", fixedStrings),
            ("contextLines", contextLines),
            ("maxMatchesPerFile", maxMatchesPerFile),
            ("limit", limit),
            ("timeoutMs", timeoutMs)), cancellationToken);

    public Task<ToolObservation> ReadAsync(
        string file_path,
        int? offset = null,
        int? limit = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("read", Args(("file_path", file_path), ("offset", offset), ("limit", limit)), cancellationToken);

    public Task<ToolObservation> OfficeCliAsync(
        string filePath,
        string operation = "view",
        string? target = null,
        string? mode = null,
        string? selector = null,
        string? elementType = null,
        JsonElement? properties = null,
        int? depth = null,
        string? format = null,
        string? verb = null,
        string? element = null,
        string? content = null,
        CancellationToken cancellationToken = default)
    {
        var args = Args(
            ("filePath", filePath),
            ("operation", operation),
            ("target", target),
            ("mode", mode),
            ("selector", selector),
            ("elementType", elementType),
            ("properties", properties),
            ("depth", depth),
            ("format", format),
            ("verb", verb),
            ("element", element),
            ("content", content));
        var call = new RelayToolCall("validation", "officecli", args);
        if (tools.RequiresApproval(call))
        {
            throw new InvalidOperationException("This officecli operation changes a file. Use officecli_mutate so Relay can request user approval.");
        }
        return InvokeAsync("officecli", args, cancellationToken);
    }

    public Task<ToolObservation> OfficeCliMutateAsync(
        string filePath,
        string operation,
        string? target = null,
        string? mode = null,
        string? selector = null,
        string? elementType = null,
        JsonElement? properties = null,
        int? depth = null,
        string? format = null,
        string? verb = null,
        string? element = null,
        string? content = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("officecli", Args(
            ("filePath", filePath),
            ("operation", operation),
            ("target", target),
            ("mode", mode),
            ("selector", selector),
            ("elementType", elementType),
            ("properties", properties),
            ("depth", depth),
            ("format", format),
            ("verb", verb),
            ("element", element),
            ("content", content)), cancellationToken);

    public Task<ToolObservation> EditAsync(
        string file_path,
        string old_string,
        string new_string,
        bool? replace_all = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("edit", Args(
            ("file_path", file_path),
            ("old_string", old_string),
            ("new_string", new_string),
            ("replace_all", replace_all)), cancellationToken);

    public Task<ToolObservation> WriteAsync(
        string file_path,
        string content,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("write", Args(("file_path", file_path), ("content", content)), cancellationToken);

    public Task<ToolObservation> PatchAsync(
        string patch,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("patch", Args(("patch", patch)), cancellationToken);

    public Task<ToolObservation> ApplyPatchAsync(
        string patchText,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("apply_patch", Args(("patchText", patchText)), cancellationToken);

    public Task<ToolObservation> WorkspaceStatusAsync(int? limit = null, CancellationToken cancellationToken = default) =>
        InvokeAsync("workspace_status", Args(("limit", limit)), cancellationToken);

    public Task<ToolObservation> DiffAsync(string? path = null, CancellationToken cancellationToken = default) =>
        InvokeAsync("diff", Args(("path", path)), cancellationToken);

    public Task<ToolObservation> BashAsync(
        string[] argv,
        string? cwd = null,
        int? timeoutMs = null,
        CancellationToken cancellationToken = default) =>
        InvokeAsync("bash", Args(("argv", argv), ("cwd", cwd), ("timeoutMs", timeoutMs)), cancellationToken);

    public Task<ToolObservation> AskUserAsync(string question, CancellationToken cancellationToken = default) =>
        InvokeAsync("ask_user", Args(("question", question)), cancellationToken);

    private AIFunction Function(RelayAgentToolRegistration registration)
    {
        var method = GetType().GetMethod(registration.MethodName, BindingFlags.Instance | BindingFlags.Public)
            ?? throw new InvalidOperationException($"Missing function method: {registration.MethodName}");
        var function = AIFunctionFactory.Create(method, this, registration.Name, registration.Description, JsonOptions.Default);
        return registration.Safety is RelayAgentToolSafety.Mutating
            ? new ApprovalRequiredAIFunction(function)
            : function;
    }

    private async Task<ToolObservation> InvokeAsync(string tool, JsonObject args, CancellationToken cancellationToken)
    {
        var effectiveWorkspace = RelayWorkspaceContext.RequireWorkspace(workspace);
        var call = new RelayToolCall($"tool-{Interlocked.Increment(ref _toolSequence):00}", tool, args);
        var validation = tools.Validate(effectiveWorkspace, call);
        if (!validation.Ok)
        {
            var failed = ToolObservation.Fail(call.Id, call.Tool, validation.Error ?? "Invalid tool call.");
            throw new InvalidOperationException(failed.Summary);
        }

        var observation = await tools.ExecuteAsync(effectiveWorkspace, call, cancellationToken, approvalGranted: true);
        if (!observation.Success)
        {
            throw new InvalidOperationException(observation.Summary);
        }

        return observation;
    }

    private static JsonObject Args(params (string Key, object? Value)[] values)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values)
        {
            if (value is null) continue;
            result[key] = value switch
            {
                JsonNode node => node.DeepClone(),
                JsonElement element => JsonNode.Parse(element.GetRawText()),
                _ => JsonSerializer.SerializeToNode(value, JsonOptions.Default),
            };
        }
        return result;
    }
}

public enum RelayAgentToolSafety
{
    ReadOnly,
    Mutating,
}

public enum RelayFrameworkToolType
{
    Function,
    LocalMcp,
    Client,
    ProviderHostedDisabled,
}

public enum RelayMutationClass
{
    Read,
    Write,
    SideEffect,
}

public sealed record RelayAgentToolRegistration(
    string MethodName,
    string Name,
    string Description,
    string ExecutorTool,
    RelayAgentToolSafety Safety,
    RelayFrameworkToolType FrameworkToolType,
    string CapabilityFamily,
    string ProviderKey,
    RelayMutationClass MutationClass,
    string ApprovalPolicy,
    string OutputContract,
    string PromptVisibility);

public static class RelayAgentToolCatalog
{
    public static readonly RelayAgentToolRegistration[] All =
    [
        Tool(
            nameof(RelayAgentFunctionSet.GlobAsync),
            "glob",
            "Find workspace files by glob pattern. Use before read when the exact file is unknown.",
            "glob",
            RelayAgentToolSafety.ReadOnly,
            "workspace.search",
            "ripgrep",
            RelayMutationClass.Read,
            "none",
            "capped_path_list"),
        Tool(
            nameof(RelayAgentFunctionSet.GrepAsync),
            "grep",
            "Search plaintext/code content with ripgrep. Supports pattern plus DCI filters such as allTerms, anyTerms, excludeTerms, includeGlobs, excludeGlobs, contextLines, and maxMatchesPerFile. Do not use for Office/PDF containers; use glob then exact read.",
            "grep",
            RelayAgentToolSafety.ReadOnly,
            "workspace.search",
            "ripgrep",
            RelayMutationClass.Read,
            "none",
            "capped_match_lines"),
        Tool(
            nameof(RelayAgentFunctionSet.ReadAsync),
            "read",
            "Read an exact workspace file. Office/PDF text is extracted when supported.",
            "read",
            RelayAgentToolSafety.ReadOnly,
            "workspace.read",
            "file_read",
            RelayMutationClass.Read,
            "none",
            "bounded_text_or_document_extract"),
        Tool(
            nameof(RelayAgentFunctionSet.OfficeCliAsync),
            "officecli",
            "Inspect Office files using semantic officecli operations that do not modify files.",
            "officecli",
            RelayAgentToolSafety.ReadOnly,
            "office.inspect",
            "officecli",
            RelayMutationClass.Read,
            "none",
            "officecli_observation"),
        Tool(
            nameof(RelayAgentFunctionSet.WorkspaceStatusAsync),
            "workspace_status",
            "Inspect workspace file count and git status.",
            "workspace_status",
            RelayAgentToolSafety.ReadOnly,
            "workspace.verify",
            "workspace",
            RelayMutationClass.Read,
            "none",
            "workspace_status"),
        Tool(
            nameof(RelayAgentFunctionSet.DiffAsync),
            "diff",
            "Show git diff for the workspace or a path.",
            "diff",
            RelayAgentToolSafety.ReadOnly,
            "workspace.verify",
            "workspace",
            RelayMutationClass.Read,
            "none",
            "git_diff"),
        Tool(
            nameof(RelayAgentFunctionSet.AskUserAsync),
            "ask_user",
            "Ask the user for missing information.",
            "ask_user",
            RelayAgentToolSafety.ReadOnly,
            "agent.ask",
            "ag-ui",
            RelayMutationClass.Read,
            "client_response",
            "question",
            RelayFrameworkToolType.Client,
            "state_scoped"),
        Tool(
            nameof(RelayAgentFunctionSet.OfficeCliMutateAsync),
            "officecli_mutate",
            "Edit Office files using semantic officecli operations. Requires user approval.",
            "officecli",
            RelayAgentToolSafety.Mutating,
            "office.mutate",
            "officecli",
            RelayMutationClass.Write,
            "required",
            "officecli_mutation_observation"),
        Tool(
            nameof(RelayAgentFunctionSet.EditAsync),
            "edit",
            "Replace exact text in a workspace file. Requires user approval.",
            "edit",
            RelayAgentToolSafety.Mutating,
            "workspace.mutate",
            "file_mutation",
            RelayMutationClass.Write,
            "required",
            "replacement_summary"),
        Tool(
            nameof(RelayAgentFunctionSet.WriteAsync),
            "write",
            "Create or overwrite a workspace file. Requires user approval.",
            "write",
            RelayAgentToolSafety.Mutating,
            "workspace.mutate",
            "file_mutation",
            RelayMutationClass.Write,
            "required",
            "write_summary"),
        Tool(
            nameof(RelayAgentFunctionSet.ApplyPatchAsync),
            "apply_patch",
            "Apply a structured multi-file patch in one Begin/End envelope. Paths are workspace-relative OpenCode-style paths; use exact displayPath values returned by read/glob/workspace_status. Requires user approval.",
            "apply_patch",
            RelayAgentToolSafety.Mutating,
            "workspace.mutate",
            "file_mutation",
            RelayMutationClass.Write,
            "required",
            "patch_summary"),
        Tool(
            nameof(RelayAgentFunctionSet.BashAsync),
            "bash",
            "Run bounded build/test/lint/typecheck/git-inspection commands through structured argv. Requires user approval; raw shell is unavailable.",
            "bash",
            RelayAgentToolSafety.Mutating,
            "workspace.verify",
            "command",
            RelayMutationClass.SideEffect,
            "required",
            "bounded_command_output"),
    ];

    private static RelayAgentToolRegistration Tool(
        string methodName,
        string name,
        string description,
        string executorTool,
        RelayAgentToolSafety safety,
        string capabilityFamily,
        string providerKey,
        RelayMutationClass mutationClass,
        string approvalPolicy,
        string outputContract,
        RelayFrameworkToolType frameworkToolType = RelayFrameworkToolType.Function,
        string promptVisibility = "visible") =>
        new(
            methodName,
            name,
            description,
            executorTool,
            safety,
            frameworkToolType,
            capabilityFamily,
            providerKey,
            mutationClass,
            approvalPolicy,
            outputContract,
            promptVisibility);
}

public sealed record AgUiApprovalRequest(
    string ApprovalId,
    string ToolCallId,
    string FunctionName,
    JsonElement? FunctionArguments,
    string? Message = null)
{
    public const string ToolName = "request_approval";

    public static FunctionCallContent ToClientToolCall(ToolApprovalRequestContent request)
    {
        if (request.ToolCall is not FunctionCallContent functionCall)
        {
            throw new InvalidOperationException($"Unsupported approval tool call type: {request.ToolCall.GetType().Name}");
        }

        var approvalRequest = new AgUiApprovalRequest(
            request.RequestId,
            functionCall.CallId,
            functionCall.Name,
            functionCall.Arguments is null ? null : JsonSerializer.SerializeToElement(functionCall.Arguments, JsonOptions.Compact),
            $"Approve execution of '{functionCall.Name}'?");
        return new FunctionCallContent(
            request.RequestId,
            ToolName,
            new Dictionary<string, object?>
            {
                ["request"] = JsonSerializer.Serialize(approvalRequest, JsonOptions.Compact),
            });
    }

    public FunctionCallContent ToFunctionCall() =>
        new(
            ToolCallId,
            FunctionName,
            FunctionArguments is null
                ? null
                : JsonSerializer.Deserialize<Dictionary<string, object?>>(FunctionArguments.Value.GetRawText(), JsonOptions.Compact));
}

public sealed record AgUiApprovalResponse(
    bool Approved,
    string? Reason = null);

public sealed class RelayWorkspaceScopeChatClient(IChatClient inner) : IChatClient
{
    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var previous = RelayWorkspaceContext.Current;
        RelayWorkspaceContext.Current = RelayWorkspaceContext.ResolveWorkspace(options) ?? previous;
        try
        {
            return await inner.GetResponseAsync(messages, options, cancellationToken);
        }
        finally
        {
            RelayWorkspaceContext.Current = previous;
        }
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var previous = RelayWorkspaceContext.Current;
        RelayWorkspaceContext.Current = RelayWorkspaceContext.ResolveWorkspace(options) ?? previous;
        try
        {
            await foreach (var update in inner.GetStreamingResponseAsync(messages, options, cancellationToken))
            {
                yield return update;
            }
        }
        finally
        {
            RelayWorkspaceContext.Current = previous;
        }
    }

    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType.IsInstanceOfType(this)
            ? this
            : inner.GetService(serviceType, serviceKey);

    public void Dispose() => inner.Dispose();
}

public static class RelayWorkspaceContext
{
    private static readonly AsyncLocal<string?> Scope = new();

    public static string? Current
    {
        get => Scope.Value;
        set => Scope.Value = value;
    }

    public static string RequireWorkspace(string? fallback)
    {
        var workspace = string.IsNullOrWhiteSpace(fallback) ? Current : fallback;
        if (string.IsNullOrWhiteSpace(workspace))
        {
            throw new InvalidOperationException("Workspace is required for Relay local tools.");
        }
        return workspace;
    }

    public static string? ResolveWorkspace(ChatOptions? options)
    {
        if (options?.AdditionalProperties is null) return null;
        foreach (var key in new[]
        {
            "workspace",
            "relay_workspace",
            "relayWorkspace",
            "ag_ui_forwarded_properties",
            "forwardedProps",
            "forwardedProperties",
            "ag_ui_state",
            "state",
        })
        {
            if (TryGetWorkspace(options.AdditionalProperties, key, out var workspace)) return workspace;
        }
        foreach (var key in new[] { "ag_ui_context", "context" })
        {
            if (TryGetWorkspace(options.AdditionalProperties, key, out var workspace)) return workspace;
        }
        return null;
    }

    public static string? ResolveWorkspace(AgentRunOptions? options) =>
        options is ChatClientAgentRunOptions chatClientOptions
            ? ResolveWorkspace(chatClientOptions.ChatOptions)
            : null;

    private static bool TryGetWorkspace(IDictionary<string, object?> properties, string key, out string? workspace)
    {
        workspace = null;
        if (!properties.TryGetValue(key, out var value)) return false;
        return TryReadWorkspace(value, out workspace);
    }

    private static bool TryReadWorkspace(object? value, out string? workspace)
    {
        workspace = null;
        switch (value)
        {
            case null:
                return false;
            case string text when !string.IsNullOrWhiteSpace(text):
                workspace = text;
                return true;
            case JsonElement element:
                return TryReadWorkspace(element, out workspace);
            case JsonObject obj:
                return TryReadWorkspace(obj, out workspace);
            case JsonArray array:
                foreach (var item in array)
                {
                    if (TryReadWorkspace(item, out workspace)) return true;
                }
                return false;
            case IDictionary<string, object?> dictionary:
                return TryReadWorkspace(dictionary, out workspace);
            case IEnumerable<KeyValuePair<string, string>> pairs:
                return TryReadWorkspace(pairs.ToDictionary(pair => pair.Key, pair => (object?)pair.Value), out workspace);
            default:
                return false;
        }
    }

    private static bool TryReadWorkspace(JsonElement element, out string? workspace)
    {
        workspace = null;
        if (element.ValueKind == JsonValueKind.String)
        {
            workspace = element.GetString();
            return !string.IsNullOrWhiteSpace(workspace);
        }
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in element.EnumerateArray())
            {
                if (TryReadWorkspace(child, out workspace)) return true;
            }
            return false;
        }
        if (element.ValueKind != JsonValueKind.Object) return false;
        foreach (var key in new[] { "workspace", "relayWorkspace", "relay_workspace" })
        {
            if (element.TryGetProperty(key, out var child) && TryReadWorkspace(child, out workspace))
            {
                return true;
            }
        }
        if (TryReadContextLikeWorkspace(
            TryGetElementString(element, "description") ?? TryGetElementString(element, "key") ?? TryGetElementString(element, "name"),
            element.TryGetProperty("value", out var value) ? value : default,
            out workspace))
        {
            return true;
        }
        foreach (var property in element.EnumerateObject())
        {
            if (TryReadWorkspace(property.Value, out workspace)) return true;
        }
        return false;
    }

    private static bool TryReadWorkspace(JsonObject obj, out string? workspace)
    {
        workspace = null;
        foreach (var key in new[] { "workspace", "relayWorkspace", "relay_workspace" })
        {
            if (obj.TryGetPropertyValue(key, out var child) && child is not null)
            {
                if (TryReadWorkspace(child, out workspace)) return true;
            }
        }
        if (TryReadContextLikeWorkspace(
            TryGetJsonObjectString(obj, "description") ?? TryGetJsonObjectString(obj, "key") ?? TryGetJsonObjectString(obj, "name"),
            obj.TryGetPropertyValue("value", out var value) ? value : null,
            out workspace))
        {
            return true;
        }
        foreach (var (_, child) in obj)
        {
            if (TryReadWorkspace(child, out workspace)) return true;
        }
        return false;
    }

    private static bool TryReadWorkspace(IDictionary<string, object?> dictionary, out string? workspace)
    {
        workspace = null;
        foreach (var key in new[] { "workspace", "relayWorkspace", "relay_workspace" })
        {
            if (dictionary.TryGetValue(key, out var child) && TryReadWorkspace(child, out workspace))
            {
                return true;
            }
        }
        if (TryReadContextLikeWorkspace(
            TryGetDictionaryString(dictionary, "description") ?? TryGetDictionaryString(dictionary, "key") ?? TryGetDictionaryString(dictionary, "name"),
            dictionary.TryGetValue("value", out var value) ? value : null,
            out workspace))
        {
            return true;
        }
        foreach (var (_, child) in dictionary)
        {
            if (TryReadWorkspace(child, out workspace)) return true;
        }
        return false;
    }

    private static bool IsWorkspaceKey(string key) =>
        key.Equals("workspace", StringComparison.OrdinalIgnoreCase)
        || key.Equals("relay_workspace", StringComparison.OrdinalIgnoreCase)
        || key.Equals("relayWorkspace", StringComparison.OrdinalIgnoreCase);

    private static bool TryReadContextLikeWorkspace(string? key, object? value, out string? workspace)
    {
        workspace = null;
        if (key is null || !IsWorkspaceKey(key)) return false;
        return TryReadWorkspace(value, out workspace);
    }

    private static bool TryReadContextLikeWorkspace(string? key, JsonElement value, out string? workspace)
    {
        workspace = null;
        if (key is null || !IsWorkspaceKey(key)) return false;
        return TryReadWorkspace(value, out workspace);
    }

    private static string? TryGetElementString(JsonElement element, string key) =>
        element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? TryGetJsonObjectString(JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var value) &&
        value is JsonValue jsonValue &&
        jsonValue.TryGetValue<string>(out var text)
            ? text
            : null;

    private static string? TryGetDictionaryString(IDictionary<string, object?> dictionary, string key) =>
        dictionary.TryGetValue(key, out var value) ? value switch
        {
            string text => text,
            JsonElement element when element.ValueKind == JsonValueKind.String => element.GetString(),
            JsonValue jsonValue when jsonValue.TryGetValue<string>(out var text) => text,
            _ => null,
        } : null;
}

public sealed class RelayToolExecutor
{
    private readonly string dataDirectory;
    private readonly ToolResolver toolResolver;
    private readonly IReadOnlyDictionary<string, RelayToolProvider> providers;

    private static readonly HashSet<string> AllowedCommands = [
        "cargo",
        "dotnet",
        "git",
        "go",
        "make",
        "node",
        "npm",
        "pnpm",
        "python",
        "python3",
        "pytest",
        "rg",
        "uv",
    ];
    private static readonly HashSet<string> AllowedGitSubcommands = [
        "branch",
        "diff",
        "log",
        "ls-files",
        "rev-parse",
        "show",
        "status",
    ];
    private static readonly HashSet<string> BlockedCommandTokens = [
        "add",
        "checkout",
        "clean",
        "delete",
        "del",
        "fetch",
        "install",
        "pull",
        "push",
        "publish",
        "remove",
        "reset",
        "restore",
        "rm",
        "upgrade",
        "update",
    ];

    public RelayToolExecutor(string dataDirectory, ToolResolver toolResolver)
    {
        this.dataDirectory = dataDirectory;
        this.toolResolver = toolResolver;
        providers = CreateProviders();
    }

    public bool RequiresApproval(RelayToolCall call) =>
        providers.TryGetValue(call.Tool, out var provider) && provider.RequiresApproval(call);

    public ToolValidation Validate(string workspace, RelayToolCall call)
    {
        if (!providers.TryGetValue(call.Tool, out var provider))
        {
            return ToolValidation.Fail($"Unknown tool: {call.Tool}");
        }
        if (!Directory.Exists(workspace)) return ToolValidation.Fail("Workspace does not exist.");

        return provider.Validate(workspace, call.Args);
    }

    public string Describe(RelayToolCall call) =>
        providers.TryGetValue(call.Tool, out var provider) ? provider.Describe(call) : call.Tool;

    public async Task<ToolObservation> ExecuteAsync(
        string workspace,
        RelayToolCall call,
        CancellationToken cancellationToken,
        bool approvalGranted = false)
    {
        if (RequiresApproval(call) && !approvalGranted)
        {
            return ToolObservation.Fail(call.Id, call.Tool, "Approval is required before mutation.");
        }

        try
        {
            return providers.TryGetValue(call.Tool, out var provider)
                ? await provider.Execute(workspace, call, cancellationToken)
                : ToolObservation.Fail(call.Id, call.Tool, $"Unknown tool: {call.Tool}");
        }
        catch (Exception ex)
        {
            return ToolObservation.Fail(call.Id, call.Tool, ex.Message);
        }
    }

    private IReadOnlyDictionary<string, RelayToolProvider> CreateProviders()
    {
        var items = new RelayToolProvider[]
        {
            ToolProvider(
                "glob",
                (_, args) => string.IsNullOrWhiteSpace(GetString(args, "pattern"))
                    ? ToolValidation.Fail("glob requires pattern.")
                    : ToolValidation.Pass(),
                call => $"glob pattern={GetString(call.Args, "pattern")}",
                GlobAsync),
            ToolProvider(
                "grep",
                ValidateGrep,
                call => $"grep pattern={GetString(call.Args, "pattern")}",
                GrepAsync),
            ToolProvider(
                "read",
                (workspace, args) => ValidateWorkspacePath(workspace, args, mustExist: true, key: "file_path", fallbackKey: "path"),
                call => $"file_path={GetPathArg(call.Args, "file_path", "path")}",
                ReadAsync),
            ToolProvider(
                "officecli",
                (workspace, args) => OfficeCliCapabilityRegistry.TryCompile(workspace, args, out _, out var officeError)
                    ? ToolValidation.Pass()
                    : ToolValidation.Fail(officeError ?? "Invalid officecli operation."),
                call => OfficeCliCapabilityRegistry.Describe(call.Args),
                OfficeCliAsync,
                call => OfficeCliCapabilityRegistry.RequiresApproval(call.Args)),
            ToolProvider(
                "edit",
                (workspace, args) => ValidateWorkspacePath(workspace, args, mustExist: true, key: "file_path", fallbackKey: "path"),
                call => $"file_path={GetPathArg(call.Args, "file_path", "path")}",
                EditAsync,
                _ => true),
            ToolProvider(
                "write",
                (workspace, args) => ValidateWorkspacePath(workspace, args, mustExist: false, key: "file_path", fallbackKey: "path"),
                call => $"file_path={GetPathArg(call.Args, "file_path", "path")}",
                WriteAsync,
                _ => true),
            ToolProvider(
                "patch",
                ValidatePatch,
                _ => "apply structured patch",
                PatchAsync,
                _ => true),
            ToolProvider(
                "apply_patch",
                ValidatePatch,
                _ => "apply structured patch compatibility alias",
                PatchAsync,
                _ => true),
            ToolProvider(
                "workspace_status",
                (_, _) => ToolValidation.Pass(),
                _ => "inspect workspace and git status",
                WorkspaceStatusAsync),
            ToolProvider(
                "diff",
                (workspace, args) => ValidateOptionalWorkspacePath(workspace, args),
                call => $"diff path={GetString(call.Args, "path") ?? "."}",
                DiffAsync),
            ToolProvider(
                "bash",
                ValidateRunCommand,
                call => $"bounded command={string.Join(" ", GetStringArray(call.Args, "argv") ?? [])}",
                RunCommandAsync,
                _ => true),
            ToolProvider(
                "ask_user",
                (_, _) => ToolValidation.Pass(),
                call => GetString(call.Args, "question") ?? "追加情報が必要です。",
                (workspace, call, _) => Task.FromResult(ToolObservation.Ok(call.Id, call.Tool, GetString(call.Args, "question") ?? "追加情報が必要です。", null))),
        };

        return items.ToDictionary(provider => provider.Name, StringComparer.Ordinal);
    }

    private static RelayToolProvider ToolProvider(
        string name,
        Func<string, JsonObject, ToolValidation> validate,
        Func<RelayToolCall, string> describe,
        Func<string, RelayToolCall, CancellationToken, Task<ToolObservation>> execute,
        Func<RelayToolCall, bool>? requiresApproval = null) =>
        new(name, validate, describe, execute, requiresApproval ?? (_ => false));

    private async Task<ToolObservation> GlobAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var rg = toolResolver.ResolveRipgrep();
        if (!rg.Available || string.IsNullOrWhiteSpace(rg.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, rg.Detail);
        }

        var pattern = NormalizeGlobPattern(GetString(call.Args, "pattern") ?? "**/*");
        var limit = Math.Clamp(GetInt(call.Args, "limit") ?? 50, 1, 200);
        var workingDirectory = ResolveSearchDirectory(workspace, call.Args);
        var result = await RunLineProcessAsync(
            rg.ExecutablePath,
            BuildGlobArgs(pattern, call.Args),
            workingDirectory,
            cancellationToken,
            maxLines: limit,
            includeLine: null,
            allowExitOne: true,
            timeoutMs: Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 60000, 1000, 120000));
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        string? expandedDirectoryPattern = null;
        if (result.Lines.Count == 0 && TryBuildDirectoryDescendantGlob(pattern, out var descendantPattern))
        {
            var descendantResult = await RunLineProcessAsync(
                rg.ExecutablePath,
                BuildGlobArgs(descendantPattern, call.Args),
                workingDirectory,
                cancellationToken,
                maxLines: limit,
                includeLine: null,
                allowExitOne: true,
                timeoutMs: Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 60000, 1000, 120000));
            if (!descendantResult.Success)
            {
                return ToolObservation.Fail(call.Id, call.Tool, descendantResult.Output);
            }
            if (descendantResult.Lines.Count > 0)
            {
                result = descendantResult;
                expandedDirectoryPattern = descendantPattern;
            }
        }

        var summary = result.Truncated
            ? $"{result.Lines.Count} file candidates (truncated at limit)"
            : $"{result.Lines.Count} file candidates";
        if (expandedDirectoryPattern is not null)
        {
            summary += $" (matched descendants via {expandedDirectoryPattern})";
        }
        return ToolObservation.Ok(call.Id, call.Tool, summary, result.Lines);
    }

    private async Task<ToolObservation> GrepAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var rg = toolResolver.ResolveRipgrep();
        if (!rg.Available || string.IsNullOrWhiteSpace(rg.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, rg.Detail);
        }

        var grepPlan = BuildGrepPlan(call.Args);
        var limit = Math.Clamp(GetInt(call.Args, "limit") ?? 80, 1, 200);
        var args = new List<string> { "--line-number", "--color", "never" };
        if (grepPlan.CaseInsensitive)
        {
            args.Add("--ignore-case");
        }
        if (grepPlan.ContextLines > 0)
        {
            args.Add("--context");
            args.Add(grepPlan.ContextLines.ToString());
        }
        if (grepPlan.MaxMatchesPerFile is not null)
        {
            args.Add("--max-count");
            args.Add(grepPlan.MaxMatchesPerFile.Value.ToString());
        }
        AddRipgrepFilters(args, call.Args);
        args.AddRange(["--", grepPlan.RipgrepPattern]);
        var workingDirectory = ResolveSearchDirectory(workspace, call.Args);
        var result = await RunLineProcessAsync(
            rg.ExecutablePath,
            args,
            workingDirectory,
            cancellationToken,
            maxLines: limit,
            includeLine: null,
            allowExitOne: true,
            timeoutMs: Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 60000, 1000, 120000));
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        var matches = BuildGrepObservationMatches(
            workspace,
            workingDirectory,
            result.Lines,
            grepPlan,
            limit);
        var summary = result.Truncated
            ? $"{matches.Count} content matches (truncated at limit)"
            : $"{matches.Count} content matches";
        return ToolObservation.Ok(call.Id, call.Tool, summary, new
        {
            schemaVersion = "RelayGrepObservation.v1",
            root = workingDirectory,
            pattern = grepPlan.RipgrepPattern,
            allTerms = grepPlan.AllTerms,
            anyTerms = grepPlan.AnyTerms,
            excludeTerms = grepPlan.ExcludeTerms,
            caseInsensitive = grepPlan.CaseInsensitive,
            contextLines = grepPlan.ContextLines,
            maxMatchesPerFile = grepPlan.MaxMatchesPerFile,
            truncated = result.Truncated,
            matches,
            continuation = result.Truncated
                ? new
                {
                    tool = "grep",
                    args = new
                    {
                        pattern = grepPlan.RipgrepPattern,
                        path = ToWorkspaceDisplayPath(workspace, workingDirectory),
                        limit = Math.Min(limit * 2, 200),
                    },
                }
                : null,
        });
    }

    private static async Task<ToolObservation> ReadAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetPathArg(call.Args, "file_path", "path") ?? "");
        var offset = Math.Max(GetInt(call.Args, "offset") ?? 0, 0);
        var limit = Math.Clamp(GetInt(call.Args, "limit") ?? 8000, 1, 12000);
        var info = new FileInfo(path);
        if (DocumentTextExtractor.IsSupported(path))
        {
            var document = await DocumentTextExtractor.ExtractAsync(path, maxChars: 12000, cancellationToken);
            var documentText = SliceText(document.Text, offset, limit);
            var suffix = document.Truncated ? " (truncated)" : "";
            var warningSuffix = document.Warnings.Count > 0 ? $"; warnings={document.Warnings.Count}" : "";
            return ToolObservation.Ok(
                call.Id,
                call.Tool,
                $"{document.Kind} extracted, {documentText.Length} chars returned{suffix}{warningSuffix}",
                BuildReadObservationData(
                    workspace,
                    path,
                    document.Kind,
                    documentText,
                    document.Text,
                    offset,
                    limit,
                    info.Exists ? info.Length : 0,
                    document.Text.Length,
                    document.Truncated,
                    document.Warnings));
        }

        if (info.Length > 512_000)
        {
            return ToolObservation.Fail(call.Id, call.Tool, $"File is too large to read directly: {info.Length} bytes.");
        }
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        if (bytes.Any(b => b == 0))
        {
            return ToolObservation.Ok(call.Id, call.Tool, $"Binary file, {bytes.Length} bytes", null);
        }
        var text = Encoding.UTF8.GetString(bytes);
        var sliced = SliceText(text, offset, limit);
        return ToolObservation.Ok(
            call.Id,
            call.Tool,
            $"{sliced.Length} chars read",
            BuildReadObservationData(
                workspace,
                path,
                "text",
                sliced,
                text,
                offset,
                limit,
                bytes.Length,
                text.Length,
                false,
                []));
    }

    private static object BuildReadObservationData(
        string workspace,
        string path,
        string kind,
        string text,
        string sourceText,
        int offset,
        int limit,
        long sizeBytes,
        int knownTotalChars,
        bool sourceTruncated,
        IReadOnlyList<string> warnings)
    {
        var nextOffset = offset + text.Length;
        var hasMore = sourceTruncated || nextOffset < knownTotalChars;
        var displayPath = ToWorkspaceDisplayPath(workspace, path);
        var lineRange = ComputeLineRange(sourceText, offset, text.Length);
        var anchors = BuildReadAnchors(kind, displayPath, lineRange.StartLine, lineRange.EndLine);
        return new
        {
            schemaVersion = "RelayReadObservation.v1",
            kind,
            path,
            displayPath,
            evidenceState = kind.Equals("text", StringComparison.OrdinalIgnoreCase)
                ? "exact_text"
                : "extracted_content",
            anchors,
            sizeBytes,
            encoding = kind.Equals("text", StringComparison.OrdinalIgnoreCase) ? "utf-8" : "extracted-text",
            offset,
            limit,
            startLine = lineRange.StartLine,
            endLine = lineRange.EndLine,
            returnedChars = text.Length,
            knownTotalChars,
            truncated = hasMore,
            sourceTruncated,
            text,
            textSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant(),
            warnings,
            continuation = hasMore
                ? new
                {
                    tool = "read",
                    args = new
                    {
                        file_path = displayPath,
                        offset = nextOffset,
                        limit,
                    },
                }
                : null,
        };
    }

    private static (int StartLine, int EndLine) ComputeLineRange(string sourceText, int offset, int returnedChars)
    {
        var safeOffset = Math.Clamp(offset, 0, sourceText.Length);
        var endOffset = Math.Clamp(safeOffset + Math.Max(0, returnedChars), safeOffset, sourceText.Length);
        var startLine = 1 + sourceText[..safeOffset].Count(static c => c == '\n');
        var segment = sourceText[safeOffset..endOffset];
        var lineCount = Math.Max(1, segment.Count(static c => c == '\n') + 1);
        return (startLine, startLine + lineCount - 1);
    }

    private static object[] BuildReadAnchors(string kind, string displayPath, int startLine, int endLine)
    {
        var anchorKind = kind.Equals("text", StringComparison.OrdinalIgnoreCase)
            ? "line_range"
            : kind.Contains("excel", StringComparison.OrdinalIgnoreCase) || kind.Contains("spreadsheet", StringComparison.OrdinalIgnoreCase) || kind.Contains("xlsx", StringComparison.OrdinalIgnoreCase)
                ? "document_extract"
                : kind.Contains("pdf", StringComparison.OrdinalIgnoreCase)
                    ? "page_extract"
                    : "document_extract";
        return
        [
            new
            {
                kind = anchorKind,
                displayPath,
                startLine,
                endLine,
            },
        ];
    }

    private async Task<ToolObservation> OfficeCliAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        if (!OfficeCliCapabilityRegistry.TryCompile(workspace, call.Args, out var plan, out var planError) || plan is null)
        {
            return ToolObservation.Fail(call.Id, call.Tool, planError ?? "Invalid officecli operation.");
        }

        if (plan.LocalResult is not null)
        {
            return ToolObservation.Ok(call.Id, call.Tool, plan.Summary, plan.LocalResult);
        }

        var officeCli = toolResolver.ResolveOfficeCli();
        if (!officeCli.Available || string.IsNullOrWhiteSpace(officeCli.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, $"OfficeCLI is not available: {officeCli.Detail}");
        }

        string? backupPath = null;
        if (plan.MutatesExistingFile && plan.FilePath is not null && File.Exists(plan.FilePath))
        {
            backupPath = await CreateBackupAsync(plan.FilePath, cancellationToken);
        }

        var result = await RelayProcess.RunAsync(
            officeCli.ExecutablePath,
            plan.Argv,
            workspace,
            cancellationToken,
            timeoutMs: plan.TimeoutMs);
        if (!result.Success)
        {
            return ToolObservation.Fail(call.Id, call.Tool, result.Output);
        }

        ProcessResult? verification = null;
        if (plan.VerifyAfter && plan.FilePath is not null && File.Exists(plan.FilePath))
        {
            verification = await RelayProcess.RunAsync(
                officeCli.ExecutablePath,
                ["view", plan.FilePath, "outline", "--json"],
                workspace,
                cancellationToken,
                timeoutMs: 20000);
            if (!verification.Success)
            {
                return ToolObservation.Fail(call.Id, call.Tool, $"OfficeCLI operation succeeded but verification failed: {verification.Output}");
            }
        }

        var data = new
        {
            operation = plan.Operation,
            argv = plan.Argv,
            output = Truncate(result.Output, 12000),
            backupPath,
            verification = verification is null ? null : Truncate(verification.Output, 12000),
        };
        return ToolObservation.Ok(
            call.Id,
            call.Tool,
            backupPath is null ? plan.Summary : $"{plan.Summary}; backup={backupPath}",
            data);
    }

    private async Task<ToolObservation> EditAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetPathArg(call.Args, "file_path", "path") ?? "");
        var oldString = GetString(call.Args, "old_string") ?? GetString(call.Args, "oldString") ?? "";
        var newString = GetString(call.Args, "new_string") ?? GetString(call.Args, "newString") ?? "";
        var replaceAll = GetBool(call.Args, "replace_all") == true || GetBool(call.Args, "replaceAll") == true;
        if (oldString.Length == 0) return ToolObservation.Fail(call.Id, call.Tool, "old_string is required.");
        var text = await File.ReadAllTextAsync(path, cancellationToken);
        var count = CountOccurrences(text, oldString);
        if (count == 0) return ToolObservation.Fail(call.Id, call.Tool, "old_string was not found.");
        if (count != 1 && !replaceAll) return ToolObservation.Fail(call.Id, call.Tool, $"old_string must match exactly once unless replace_all=true; matches={count}.");
        var backupPath = await CreateBackupAsync(path, cancellationToken);
        await File.WriteAllTextAsync(path, text.Replace(oldString, newString), cancellationToken);
        return ToolObservation.Ok(call.Id, call.Tool, $"{(replaceAll ? count : 1)} replacement(s) applied; backup={backupPath}", path);
    }

    private async Task<ToolObservation> WriteAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetPathArg(call.Args, "file_path", "path") ?? "");
        var content = NormalizeGeneratedFileContent(path, GetString(call.Args, "content") ?? "");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var backupPath = File.Exists(path) ? await CreateBackupAsync(path, cancellationToken) : null;
        await File.WriteAllTextAsync(path, content, cancellationToken);
        return ToolObservation.Ok(call.Id, call.Tool, backupPath is null ? "file written" : $"file written; backup={backupPath}", path);
    }

    private async Task<ToolObservation> PatchAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var patch = GetString(call.Args, "patchText") ?? GetString(call.Args, "patch") ?? "";
        if (string.IsNullOrWhiteSpace(patch)) return ToolObservation.Fail(call.Id, call.Tool, "patch is required.");

        if (!RelayPatch.TryParse(patch, out var operations, out var error))
        {
            if (!RelayPatch.TryRepairCopilotMarkdownAddFilePrefixes(patch, out var repaired) ||
                !RelayPatch.TryParse(repaired, out operations, out error))
            {
                return ToolObservation.Fail(call.Id, call.Tool, error ?? "Invalid patch.");
            }
            patch = repaired;
        }

        var changed = new List<string>();
        var changedDisplayPaths = new List<string>();
        var backups = new List<string>();
        var pathResolutions = new List<object>();
        foreach (var operation in operations)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!TryResolvePatchOperationPath(workspace, operation, out var resolution, out var resolutionError, out var resolutionData))
            {
                return ToolObservation.Fail(call.Id, call.Tool, resolutionError ?? $"Patch path could not be resolved: {operation.Path}", resolutionData);
            }
            var path = resolution!.FullPath;
            if (!string.Equals(operation.Path, resolution.DisplayPath, StringComparison.Ordinal) ||
                !string.Equals(resolution.Strategy, "exact", StringComparison.Ordinal))
            {
                pathResolutions.Add(new
                {
                    requestedPath = operation.Path,
                    resolvedPath = resolution.DisplayPath,
                    resolution.Strategy,
                });
            }

            switch (operation.Kind)
            {
                case RelayPatchOperationKind.Add:
                    if (File.Exists(path)) return ToolObservation.Fail(call.Id, call.Tool, $"Add file already exists: {operation.Path}");
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    await File.WriteAllTextAsync(path, NormalizeGeneratedFileContent(path, operation.NewText ?? ""), cancellationToken);
                    changed.Add(path);
                    changedDisplayPaths.Add(ToWorkspaceDisplayPath(workspace, path));
                    break;
                case RelayPatchOperationKind.Delete:
                    if (!File.Exists(path)) return ToolObservation.Fail(call.Id, call.Tool, $"Delete file does not exist: {operation.Path}");
                    backups.Add(await CreateBackupAsync(path, cancellationToken));
                    File.Delete(path);
                    changed.Add(path);
                    changedDisplayPaths.Add(ToWorkspaceDisplayPath(workspace, path));
                    break;
                case RelayPatchOperationKind.Update:
                    if (!File.Exists(path)) return ToolObservation.Fail(call.Id, call.Tool, $"Update file does not exist: {operation.Path}");
                    var original = await File.ReadAllTextAsync(path, cancellationToken);
                    var oldText = operation.OldText ?? "";
                    var newText = operation.NewText ?? "";
                    if (oldText.Length == 0 || !original.Contains(oldText, StringComparison.Ordinal))
                    {
                        return ToolObservation.Fail(
                            call.Id,
                            call.Tool,
                            $"Patch context was not found: {resolution.DisplayPath}",
                            new
                            {
                                schemaVersion = "RelayPatchContextError.v1",
                                requestedPath = operation.Path,
                                resolvedPath = resolution.DisplayPath,
                                nextAction = "Read the resolvedPath and retry apply_patch with current file context.",
                            });
                    }
                    backups.Add(await CreateBackupAsync(path, cancellationToken));
                    await File.WriteAllTextAsync(path, original.Replace(oldText, NormalizeGeneratedFileContent(path, newText), StringComparison.Ordinal), cancellationToken);
                    changed.Add(path);
                    changedDisplayPaths.Add(ToWorkspaceDisplayPath(workspace, path));
                    break;
            }
        }

        return ToolObservation.Ok(call.Id, call.Tool, $"{changed.Count} file(s) patched", new
        {
            changed,
            changedDisplayPaths,
            backups,
            pathResolutions,
        });
    }

    private sealed record PatchPathResolution(string FullPath, string DisplayPath, string Strategy);

    private static bool TryResolvePatchOperationPath(
        string workspace,
        RelayPatchOperation operation,
        out PatchPathResolution? resolution,
        out string? error,
        out object? errorData)
    {
        resolution = null;
        error = null;
        errorData = null;

        var exactPath = ResolveWorkspacePath(workspace, operation.Path);
        var exactDisplayPath = ToWorkspaceDisplayPath(workspace, exactPath);
        if (operation.Kind is RelayPatchOperationKind.Add)
        {
            resolution = new PatchPathResolution(exactPath, exactDisplayPath, "exact");
            return true;
        }

        if (File.Exists(exactPath))
        {
            resolution = new PatchPathResolution(exactPath, exactDisplayPath, "exact");
            return true;
        }

        var candidates = FindWorkspaceFilesByPathTail(workspace, operation.Path, maxCandidates: 16);
        if (candidates.Count == 1)
        {
            var candidatePath = ResolveWorkspacePath(workspace, candidates[0]);
            resolution = new PatchPathResolution(candidatePath, candidates[0], "unique_suffix");
            return true;
        }

        var verb = operation.Kind is RelayPatchOperationKind.Delete ? "Delete" : "Update";
        error = candidates.Count == 0
            ? $"{verb} file does not exist: {operation.Path}"
            : $"{verb} file path is ambiguous: {operation.Path}";
        errorData = new
        {
            schemaVersion = "RelayPatchPathResolutionError.v1",
            operation = operation.Kind.ToString().ToLowerInvariant(),
            requestedPath = operation.Path,
            candidates,
            nextAction = candidates.Count == 0
                ? "Use glob/read to find the exact workspace-relative displayPath, then retry apply_patch with that path."
                : "Read one exact candidate displayPath, then retry apply_patch with that path.",
        };
        return false;
    }

    private static async Task<ToolObservation> WorkspaceStatusAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var root = Path.GetFullPath(workspace);
        var sampleLimit = Math.Clamp(GetInt(call.Args, "limit") ?? 5000, 100, 20000);
        var filesScanned = 0;
        try
        {
            foreach (var _ in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).Take(sampleLimit + 1))
            {
                cancellationToken.ThrowIfCancellationRequested();
                filesScanned++;
            }
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
        {
            return ToolObservation.Fail(call.Id, call.Tool, $"Workspace scan failed: {ex.Message}");
        }

        var gitRoot = FindGitRoot(root);
        string? gitStatus = null;
        if (gitRoot is not null)
        {
            var status = await RelayProcess.RunAsync(
                "git",
                ["status", "--short", "--branch"],
                gitRoot,
                cancellationToken,
                timeoutMs: 15000);
            gitStatus = status.Success ? Truncate(status.Output, 12000) : $"git status failed: {status.Output}";
        }

        var data = new
        {
            workspace = root,
            exists = Directory.Exists(root),
            scannedFiles = Math.Min(filesScanned, sampleLimit),
            truncated = filesScanned > sampleLimit,
            gitRoot,
            gitStatus,
        };
        return ToolObservation.Ok(call.Id, call.Tool, gitRoot is null ? "workspace inspected" : "workspace and git status inspected", data);
    }

    private static async Task<ToolObservation> DiffAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var root = Path.GetFullPath(workspace);
        var gitRoot = FindGitRoot(root);
        if (gitRoot is null)
        {
            return ToolObservation.Ok(call.Id, call.Tool, "workspace is not a git repository", "");
        }

        var args = new List<string> { "diff", "--no-ext-diff", "--" };
        var path = GetString(call.Args, "path");
        if (!string.IsNullOrWhiteSpace(path))
        {
            var full = ResolveWorkspacePath(workspace, path);
            args.Add(Path.GetRelativePath(gitRoot, full));
        }

        var result = await RelayProcess.RunAsync("git", args, gitRoot, cancellationToken, timeoutMs: 30000);
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);
        var output = Truncate(result.Output, 24000);
        return ToolObservation.Ok(call.Id, call.Tool, string.IsNullOrWhiteSpace(output) ? "no diff" : "diff captured", output);
    }

    private static async Task<ToolObservation> RunCommandAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var argv = GetStringArray(call.Args, "argv") ?? [];
        if (argv.Length == 0) return ToolObservation.Fail(call.Id, call.Tool, "argv is required.");
        var cwd = GetString(call.Args, "cwd");
        var workingDirectory = string.IsNullOrWhiteSpace(cwd)
            ? Path.GetFullPath(workspace)
            : ResolveWorkspaceDirectory(workspace, cwd);
        var timeoutMs = Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 120000, 1000, 600000);
        var result = await RelayProcess.RunAsync(
            argv[0],
            argv.Skip(1).ToArray(),
            workingDirectory,
            cancellationToken,
            allowExitOne: false,
            timeoutMs: timeoutMs);
        return result.Success
            ? ToolObservation.Ok(call.Id, call.Tool, "verification command completed", Truncate(result.Output, 24000))
            : ToolObservation.Fail(call.Id, call.Tool, Truncate(result.Output, 24000));
    }

    private sealed record OfficeCliOperationPlan(
        string Operation,
        IReadOnlyList<string> Argv,
        string? FilePath,
        bool RequiresApproval,
        bool MutatesExistingFile,
        bool VerifyAfter,
        int TimeoutMs,
        string Summary,
        object? LocalResult = null);

    private sealed record OfficeCliCapability(
        string Operation,
        string Safety,
        string Summary,
        string[] RequiredArgs,
        string[] OptionalArgs);

    private static class OfficeCliCapabilityRegistry
    {
        private static readonly HashSet<string> Formats = new(StringComparer.OrdinalIgnoreCase)
        {
            "docx",
            "xlsx",
            "xlsm",
            "pptx",
            "word",
            "excel",
            "ppt",
            "powerpoint",
        };

        private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ".docx",
            ".xlsx",
            ".xlsm",
            ".pptx",
            ".csv",
        };

        private static readonly HashSet<string> ViewModes = new(StringComparer.OrdinalIgnoreCase)
        {
            "outline",
            "stats",
            "issues",
            "text",
            "annotated",
            "html",
            "screenshot",
        };

        private static readonly HashSet<string> ReadOnlyOperations = new(StringComparer.OrdinalIgnoreCase)
        {
            "capabilities",
            "help",
            "view",
            "get",
            "query",
            "validate",
            "dump",
            "raw",
            "open",
        };

        private static readonly Dictionary<string, OfficeCliCapability> Capabilities = new(StringComparer.OrdinalIgnoreCase)
        {
            ["capabilities"] = new("capabilities", "read", "Return Relay's OfficeCLI semantic capability registry.", [], []),
            ["help"] = new("help", "read", "Ask OfficeCLI for command, element, or property schema help.", [], ["format", "verb", "element", "property"]),
            ["view"] = new("view", "read", "Inspect a document using OfficeCLI view modes.", ["filePath"], ["mode"]),
            ["get"] = new("get", "read", "Read one document node/path and optional children.", ["filePath", "target"], ["depth"]),
            ["query"] = new("query", "read", "Query document nodes with an OfficeCLI selector.", ["filePath", "selector"], []),
            ["validate"] = new("validate", "read", "Run OfficeCLI validation for a document.", ["filePath"], []),
            ["dump"] = new("dump", "read", "Serialize a supported document into replayable structured JSON.", ["filePath"], []),
            ["raw"] = new("raw", "read", "Read raw Office document XML for a path/part.", ["filePath", "target"], []),
            ["create"] = new("create", "write", "Create a new Office document.", ["filePath"], []),
            ["set"] = new("set", "write", "Set properties on a document path, cell, range, shape, paragraph, or other OfficeCLI node.", ["filePath", "target", "properties"], []),
            ["add"] = new("add", "write", "Add an OfficeCLI element below a target path.", ["filePath", "target", "elementType"], ["properties", "after", "before"]),
            ["remove"] = new("remove", "write", "Remove a document element at a target path.", ["filePath", "target"], []),
            ["move"] = new("move", "write", "Move a document element from source to destination.", ["filePath", "source", "destination"], []),
            ["copy"] = new("copy", "write", "Copy a document element from source to destination.", ["filePath", "source", "destination"], []),
            ["refresh"] = new("refresh", "write", "Refresh calculated document state such as fields or workbook calculations when OfficeCLI supports it.", ["filePath"], []),
            ["close"] = new("close", "write", "Close a resident OfficeCLI session and save/release the file.", ["filePath"], []),
            ["watch"] = new("watch", "side_effect", "Start OfficeCLI live preview for a document.", ["filePath"], ["port"]),
            ["unwatch"] = new("unwatch", "side_effect", "Stop OfficeCLI live preview for a document.", ["filePath"], []),
            ["goto"] = new("goto", "side_effect", "Scroll a watched preview to a target path.", ["filePath", "target"], []),
        };

        public static bool RequiresApproval(JsonObject args)
        {
            if (args.ContainsKey("argv") || args.ContainsKey("args") || args.ContainsKey("commandArgs"))
            {
                return true;
            }

            var operation = NormalizeOperation(GetString(args, "operation") ?? GetString(args, "command") ?? "view");
            return !ReadOnlyOperations.Contains(operation);
        }

        public static string Describe(JsonObject args)
        {
            var operation = NormalizeOperation(GetString(args, "operation") ?? GetString(args, "command") ?? "view");
            var target = GetString(args, "target")
                ?? GetString(args, "selector")
                ?? GetString(args, "mode")
                ?? GetString(args, "format")
                ?? "";
            var file = GetString(args, "filePath") ?? "";
            return $"file={file}, operation={operation}{(string.IsNullOrWhiteSpace(target) ? "" : $", target={target}")}";
        }

        public static bool TryCompile(
            string workspace,
            JsonObject args,
            out OfficeCliOperationPlan? plan,
            out string? error)
        {
            plan = null;
            error = null;

            if (args.ContainsKey("argv") || args.ContainsKey("args") || args.ContainsKey("commandArgs"))
            {
                error = "officecli raw argv is not allowed. Use semantic operation fields.";
                return false;
            }

            var operation = NormalizeOperation(GetString(args, "operation") ?? GetString(args, "command") ?? "view");
            if (!Capabilities.TryGetValue(operation, out _))
            {
                error = $"Unsupported officecli operation: {operation}. Use operation=capabilities to inspect the supported registry.";
                return false;
            }

            if (operation == "capabilities")
            {
                var registry = Capabilities.Values
                    .Select(capability => new
                    {
                        operation = capability.Operation,
                        safety = capability.Safety,
                        summary = capability.Summary,
                        requiredArgs = capability.RequiredArgs,
                        optionalArgs = capability.OptionalArgs,
                    })
                    .ToArray();
                plan = new OfficeCliOperationPlan(
                    operation,
                    [],
                    null,
                    RequiresApproval: false,
                    MutatesExistingFile: false,
                    VerifyAfter: false,
                    TimeoutMs: 1000,
                    Summary: "OfficeCLI capability registry",
                    LocalResult: registry);
                return true;
            }

            if (operation == "help")
            {
                if (!TryBuildHelpArgs(args, out var helpArgs, out error)) return false;
                plan = new OfficeCliOperationPlan(
                    operation,
                    helpArgs,
                    null,
                    RequiresApproval: false,
                    MutatesExistingFile: false,
                    VerifyAfter: false,
                    TimeoutMs: 15000,
                    Summary: "OfficeCLI help/schema requested");
                return true;
            }

            var filePathInput = GetString(args, "filePath");
            if (string.IsNullOrWhiteSpace(filePathInput))
            {
                error = "officecli requires filePath for this operation.";
                return false;
            }

            string filePath;
            try
            {
                filePath = ResolveWorkspacePath(workspace, filePathInput);
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }

            var extension = Path.GetExtension(filePath);
            if (!SupportedExtensions.Contains(extension))
            {
                error = $"Unsupported OfficeCLI file extension: {extension}. Supported: {string.Join(", ", SupportedExtensions)}.";
                return false;
            }

            if (operation == "create")
            {
                if (File.Exists(filePath))
                {
                    error = "officecli create target already exists.";
                    return false;
                }
            }
            else if (!File.Exists(filePath))
            {
                error = "officecli filePath does not exist.";
                return false;
            }

            if (!TryBuildOfficeArgs(operation, filePath, args, out var argv, out error)) return false;

            var requiresApproval = !ReadOnlyOperations.Contains(operation);
            var mutatesExistingFile = requiresApproval && operation != "create" && File.Exists(filePath);
            plan = new OfficeCliOperationPlan(
                operation,
                argv,
                filePath,
                requiresApproval,
                mutatesExistingFile,
                VerifyAfter: requiresApproval && operation is not ("watch" or "unwatch" or "goto"),
                TimeoutMs: Math.Clamp(GetInt(args, "timeoutMs") ?? 120000, 1000, 600000),
                Summary: $"OfficeCLI {operation} prepared");
            return true;
        }

        private static string NormalizeOperation(string operation)
        {
            var normalized = operation.Trim().ToLowerInvariant().Replace('-', '_');
            return normalized switch
            {
                "schema" or "help_schema" => "help",
                "inspect" or "view_outline" => "view",
                "read_node" => "get",
                "find_nodes" => "query",
                "set_cell_value" or "set_cell_fill" or "rename_sheet" => "set",
                "read_range" => "get",
                "delete" => "remove",
                _ => normalized.Replace('_', '-'),
            };
        }

        private static bool TryBuildHelpArgs(JsonObject args, out List<string> argv, out string? error)
        {
            argv = ["help"];
            error = null;

            var format = NormalizeFormat(GetString(args, "format"));
            var verb = GetString(args, "verb");
            var element = GetString(args, "element") ?? GetString(args, "elementType");
            var property = GetString(args, "property");

            if (format is not null)
            {
                if (!Formats.Contains(format))
                {
                    error = $"Unsupported OfficeCLI help format: {format}.";
                    return false;
                }
                argv.Add(format);
            }

            if (!string.IsNullOrWhiteSpace(verb))
            {
                if (!IsSafeHelpToken(verb))
                {
                    error = "OfficeCLI help verb contains unsupported characters.";
                    return false;
                }
                argv.Add(verb.Trim());
            }

            if (!string.IsNullOrWhiteSpace(element))
            {
                if (!IsSafeHelpToken(element))
                {
                    error = "OfficeCLI help element contains unsupported characters.";
                    return false;
                }
                argv.Add(element.Trim());
            }

            if (!string.IsNullOrWhiteSpace(property))
            {
                if (string.IsNullOrWhiteSpace(element) || !IsSafeHelpToken(property))
                {
                    error = "OfficeCLI help property requires a safe element and property.";
                    return false;
                }
                argv[^1] = $"{argv[^1]}.{property.Trim()}";
            }

            argv.Add("--json");
            return true;
        }

        private static bool TryBuildOfficeArgs(
            string operation,
            string filePath,
            JsonObject args,
            out List<string> argv,
            out string? error)
        {
            argv = [];
            error = null;

            switch (operation)
            {
                case "view":
                {
                    var mode = GetString(args, "mode") ?? GetString(args, "command") ?? "outline";
                    if (!ViewModes.Contains(mode))
                    {
                        error = $"Unsupported OfficeCLI view mode: {mode}.";
                        return false;
                    }
                    argv.AddRange(["view", filePath, mode, "--json"]);
                    return true;
                }
                case "get":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: true, out error)) return false;
                    argv.AddRange(["get", filePath, target!, "--json"]);
                    var depth = GetInt(args, "depth");
                    if (depth is not null)
                    {
                        argv.AddRange(["--depth", Math.Clamp(depth.Value, 0, 20).ToString()]);
                    }
                    return true;
                }
                case "query":
                {
                    var selector = GetString(args, "selector") ?? GetTarget(args, required: true);
                    if (!ValidateSelector(selector, out error)) return false;
                    argv.AddRange(["query", filePath, selector!, "--json"]);
                    return true;
                }
                case "validate":
                case "dump":
                case "refresh":
                case "open":
                case "close":
                case "watch":
                case "unwatch":
                {
                    argv.AddRange([operation, filePath, "--json"]);
                    var port = GetInt(args, "port");
                    if (operation == "watch" && port is not null)
                    {
                        if (port < 1024 || port > 65535)
                        {
                            error = "OfficeCLI watch port must be between 1024 and 65535.";
                            return false;
                        }
                        argv.AddRange(["--port", port.Value.ToString()]);
                    }
                    return true;
                }
                case "raw":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: false, out error)) return false;
                    argv.AddRange(["raw", filePath, target!, "--json"]);
                    return true;
                }
                case "create":
                    argv.AddRange(["create", filePath, "--json"]);
                    return true;
                case "set":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: false, out error)) return false;
                    if (!TryBuildPropertyArgs(args, out var propertyArgs, out error)) return false;
                    argv.AddRange(["set", filePath, target!]);
                    argv.AddRange(propertyArgs);
                    argv.Add("--json");
                    return true;
                }
                case "add":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: false, out error)) return false;
                    var elementType = GetString(args, "elementType") ?? GetString(args, "type");
                    if (!IsSafeHelpToken(elementType))
                    {
                        error = "officecli add requires a safe elementType.";
                        return false;
                    }
                    argv.AddRange(["add", filePath, target!, "--type", elementType!.Trim()]);
                    AddPlacement(argv, args, "after");
                    AddPlacement(argv, args, "before");
                    if (!TryBuildPropertyArgs(args, out var propertyArgs, out error, allowEmpty: true)) return false;
                    argv.AddRange(propertyArgs);
                    argv.Add("--json");
                    return true;
                }
                case "remove":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: false, out error)) return false;
                    argv.AddRange(["remove", filePath, target!, "--json"]);
                    return true;
                }
                case "move":
                case "copy":
                {
                    var source = GetString(args, "source") ?? GetString(args, "from");
                    var destination = GetString(args, "destination") ?? GetString(args, "to");
                    if (!ValidateTarget(source, allowSelected: false, out error)) return false;
                    if (!ValidateTarget(destination, allowSelected: false, out error)) return false;
                    argv.AddRange([operation, filePath, source!, destination!, "--json"]);
                    return true;
                }
                case "goto":
                {
                    var target = GetTarget(args, required: true);
                    if (!ValidateTarget(target, allowSelected: false, out error)) return false;
                    argv.AddRange(["goto", filePath, target!, "--json"]);
                    return true;
                }
                default:
                    error = $"Unsupported OfficeCLI operation: {operation}.";
                    return false;
            }
        }

        private static string? NormalizeFormat(string? format)
        {
            if (string.IsNullOrWhiteSpace(format)) return null;
            var normalized = format.Trim().ToLowerInvariant();
            return normalized switch
            {
                "word" => "docx",
                "excel" => "xlsx",
                "ppt" or "powerpoint" => "pptx",
                _ => normalized,
            };
        }

        private static string? GetTarget(JsonObject args, bool required)
        {
            var target = GetString(args, "target")
                ?? GetString(args, "pathInDocument")
                ?? GetString(args, "range");
            var sheet = GetString(args, "sheet") ?? GetString(args, "sheetName");
            if (!string.IsNullOrWhiteSpace(sheet) && !string.IsNullOrWhiteSpace(target) && !target.StartsWith('/'))
            {
                target = $"/{sheet}/{target}";
            }
            else if (string.IsNullOrWhiteSpace(target) && !string.IsNullOrWhiteSpace(sheet))
            {
                var cell = GetString(args, "cell") ?? GetString(args, "address");
                target = string.IsNullOrWhiteSpace(cell) ? $"/{sheet}" : $"/{sheet}/{cell}";
            }
            if (string.IsNullOrWhiteSpace(target) && !required) return null;
            return target;
        }

        private static bool ValidateTarget(string? target, bool allowSelected, out string? error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(target))
            {
                error = "officecli target is required.";
                return false;
            }
            if (target.IndexOf('\0') >= 0 || target.Length > 600)
            {
                error = "officecli target is invalid.";
                return false;
            }
            if (allowSelected && string.Equals(target, "selected", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            if (!target.StartsWith('/'))
            {
                error = "officecli target must be a path starting with `/`.";
                return false;
            }
            return true;
        }

        private static bool ValidateSelector(string? selector, out string? error)
        {
            error = null;
            if (string.IsNullOrWhiteSpace(selector))
            {
                error = "officecli selector is required.";
                return false;
            }
            if (selector.IndexOf('\0') >= 0 || selector.Length > 600)
            {
                error = "officecli selector is invalid.";
                return false;
            }
            return true;
        }

        private static void AddPlacement(List<string> argv, JsonObject args, string key)
        {
            var value = GetString(args, key);
            if (string.IsNullOrWhiteSpace(value)) return;
            argv.Add($"--{key}");
            argv.Add(value);
        }

        private static bool TryBuildPropertyArgs(
            JsonObject args,
            out List<string> argv,
            out string? error,
            bool allowEmpty = false)
        {
            argv = [];
            error = null;

            var properties = args["properties"] as JsonObject ?? args["props"] as JsonObject;
            if (properties is null)
            {
                var singleKey = GetString(args, "property");
                if (!string.IsNullOrWhiteSpace(singleKey))
                {
                    properties = new JsonObject { [singleKey] = JsonValue.Create(GetScalarString(args["value"])) };
                }
                else if (args.TryGetPropertyValue("fill", out var fill) || args.TryGetPropertyValue("color", out fill))
                {
                    properties = new JsonObject { ["fill"] = JsonValue.Create(GetScalarString(fill)) };
                }
                else if (args.TryGetPropertyValue("newName", out var newName))
                {
                    properties = new JsonObject { ["name"] = JsonValue.Create(GetScalarString(newName)) };
                }
                else if (args.TryGetPropertyValue("value", out var value))
                {
                    properties = new JsonObject { ["value"] = JsonValue.Create(GetScalarString(value)) };
                }
                else if (args.TryGetPropertyValue("formula", out var formula))
                {
                    var formulaText = GetScalarString(formula);
                    if (!string.IsNullOrWhiteSpace(formulaText) && !formulaText.StartsWith('='))
                    {
                        formulaText = $"={formulaText}";
                    }
                    properties = new JsonObject { ["value"] = JsonValue.Create(formulaText) };
                }
            }

            if (properties is null || properties.Count == 0)
            {
                if (allowEmpty) return true;
                error = "officecli properties are required.";
                return false;
            }

            foreach (var (key, value) in properties)
            {
                if (!IsSafePropertyName(key))
                {
                    error = $"Unsupported OfficeCLI property name: {key}";
                    return false;
                }
                var scalar = GetScalarString(value);
                if (scalar is null || scalar.IndexOf('\0') >= 0 || scalar.Length > 4000)
                {
                    error = $"Unsupported OfficeCLI property value for {key}.";
                    return false;
                }
                argv.Add("--prop");
                argv.Add($"{key}={scalar.Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "\\n")}");
            }

            return true;
        }

        private static bool IsSafeHelpToken(string? value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 80) return false;
            foreach (var c in value)
            {
                if (char.IsLetterOrDigit(c) || c is '_' or '-' or '.' or '/') continue;
                return false;
            }
            return true;
        }

        private static bool IsSafePropertyName(string value)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 120) return false;
            foreach (var c in value)
            {
                if (char.IsLetterOrDigit(c) || c is '_' or '-' or '.' or ':' or '@') continue;
                return false;
            }
            return true;
        }
    }

    private async Task<string> CreateBackupAsync(string path, CancellationToken cancellationToken)
    {
        var backupRoot = Path.Combine(dataDirectory, "backups", DateTimeOffset.UtcNow.ToString("yyyyMMdd"));
        Directory.CreateDirectory(backupRoot);
        var backupPath = Path.Combine(
            backupRoot,
            $"{Path.GetFileName(path)}.{DateTimeOffset.UtcNow:HHmmssfff}.{RandomNumberGenerator.GetHexString(4).ToLowerInvariant()}.bak");
        await using (var source = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        await using (var destination = File.Create(backupPath))
        {
            await source.CopyToAsync(destination, cancellationToken);
        }
        var manifestPath = backupPath + ".json";
        var manifest = new
        {
            schemaVersion = "RelayBackupManifest.v1",
            originalPath = path,
            backupPath,
            createdAt = DateTimeOffset.UtcNow,
        };
        await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, JsonOptions.Default), cancellationToken);
        return backupPath;
    }

    private static ToolValidation ValidateGrep(string workspace, JsonObject args)
    {
        if (string.IsNullOrWhiteSpace(GetString(args, "pattern")) &&
            NonEmptyTerms(args, "allTerms").Length == 0 &&
            NonEmptyTerms(args, "anyTerms").Length == 0)
        {
            return ToolValidation.Fail("grep requires pattern, allTerms, or anyTerms.");
        }

        var path = GetPathArg(args, "path");
        if (!string.IsNullOrWhiteSpace(path))
        {
            try
            {
                var full = ResolveWorkspacePath(workspace, path);
                if (File.Exists(full) && DocumentTextExtractor.IsSupported(full))
                {
                    return ToolValidation.Fail("grep supports plaintext/code only for direct file targets. Use glob then exact read for Office/PDF containers.");
                }
            }
            catch (Exception ex)
            {
                return ToolValidation.Fail(ex.Message);
            }
        }

        var glob = GetString(args, "glob");
        if (LooksLikeOfficeOrPdfGlob(glob))
        {
            return ToolValidation.Fail("grep supports plaintext/code only. Use glob then exact read for Office/PDF containers.");
        }

        return ToolValidation.Pass();
    }

    private sealed record GrepPlan(
        string RipgrepPattern,
        string[] AllTerms,
        string[] AnyTerms,
        string[] ExcludeTerms,
        bool CaseInsensitive,
        int ContextLines,
        int? MaxMatchesPerFile);

    private static GrepPlan BuildGrepPlan(JsonObject args)
    {
        var allTerms = NonEmptyTerms(args, "allTerms");
        var anyTerms = NonEmptyTerms(args, "anyTerms");
        var excludeTerms = NonEmptyTerms(args, "excludeTerms");
        var caseInsensitive = GetBool(args, "caseInsensitive") == true || GetBool(args, "case_insensitive") == true;
        var contextLines = Math.Clamp(GetInt(args, "contextLines") ?? 0, 0, 10);
        var maxMatchesPerFile = GetInt(args, "maxMatchesPerFile");
        if (maxMatchesPerFile is not null) maxMatchesPerFile = Math.Clamp(maxMatchesPerFile.Value, 1, 200);
        var pattern = GetString(args, "pattern");
        if (string.IsNullOrWhiteSpace(pattern))
        {
            var sourceTerms = anyTerms.Length > 0 ? anyTerms : allTerms;
            pattern = string.Join("|", sourceTerms.Select(Regex.Escape));
        }
        else if (GetBool(args, "fixedStrings") == true)
        {
            pattern = Regex.Escape(pattern);
        }

        return new GrepPlan(pattern, allTerms, anyTerms, excludeTerms, caseInsensitive, contextLines, maxMatchesPerFile);
    }

    private static IReadOnlyList<object> BuildGrepObservationMatches(
        string workspace,
        string workingDirectory,
        IReadOnlyList<string> lines,
        GrepPlan plan,
        int limit)
    {
        var matches = new List<object>();
        foreach (var line in lines)
        {
            if (line == "--") continue;
            if (!TryParseRipgrepLine(workingDirectory, line, out var fullPath, out var lineNumber, out var text)) continue;
            if (!LineSatisfiesTerms(text, plan)) continue;
            var matchedTerms = MatchedTerms(text, plan);
            matches.Add(new
            {
                path = fullPath,
                displayPath = ToWorkspaceDisplayPath(workspace, fullPath),
                lineNumber,
                excerpt = Truncate(text, 1200),
                matchedTerms,
                evidenceState = plan.AllTerms.Length > 1 && plan.AllTerms.All(term => ContainsTerm(text, term, plan.CaseInsensitive))
                    ? "conjunctive_content_match"
                    : "content_match",
            });
            if (matches.Count >= limit) break;
        }
        return matches;
    }

    private static bool TryParseRipgrepLine(string workingDirectory, string line, out string fullPath, out int lineNumber, out string text)
    {
        fullPath = "";
        lineNumber = 0;
        text = "";
        var first = line.IndexOf(':', StringComparison.Ordinal);
        if (first <= 0) return false;
        var second = line.IndexOf(':', first + 1);
        if (second < 0)
        {
            second = line.IndexOf('-', first + 1);
        }
        if (second < 0) return false;
        var pathPart = line[..first];
        var linePart = line[(first + 1)..second];
        if (!int.TryParse(linePart, out lineNumber)) return false;
        text = line[(second + 1)..];
        fullPath = Path.GetFullPath(Path.IsPathRooted(pathPart) ? pathPart : Path.Combine(workingDirectory, pathPart));
        return true;
    }

    private static bool LineSatisfiesTerms(string text, GrepPlan plan)
    {
        if (plan.AllTerms.Any(term => !ContainsTerm(text, term, plan.CaseInsensitive))) return false;
        if (plan.AnyTerms.Length > 0 && !plan.AnyTerms.Any(term => ContainsTerm(text, term, plan.CaseInsensitive))) return false;
        if (plan.ExcludeTerms.Any(term => ContainsTerm(text, term, plan.CaseInsensitive))) return false;
        return true;
    }

    private static string[] MatchedTerms(string text, GrepPlan plan) =>
        plan.AllTerms
            .Concat(plan.AnyTerms)
            .Where(term => ContainsTerm(text, term, plan.CaseInsensitive))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    private static bool ContainsTerm(string text, string term, bool caseInsensitive) =>
        text.IndexOf(term, caseInsensitive ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) >= 0;

    private static ToolValidation ValidatePatch(string workspace, JsonObject args)
    {
        var patch = GetString(args, "patchText") ?? GetString(args, "patch");
        if (string.IsNullOrWhiteSpace(patch))
        {
            return ToolValidation.Fail("apply_patch requires patchText.");
        }

        if (!RelayPatch.TryParse(patch, out var operations, out var error))
        {
            return ToolValidation.Fail(error ?? "Invalid patch.");
        }

        foreach (var operation in operations)
        {
            try
            {
                ResolveWorkspacePath(workspace, operation.Path);
            }
            catch (Exception ex)
            {
                return ToolValidation.Fail(ex.Message);
            }
        }

        return ToolValidation.Pass();
    }

    private static ToolValidation ValidateWorkspacePath(string workspace, JsonObject args, bool mustExist, string key = "path", string? fallbackKey = null)
    {
        var path = GetPathArg(args, key, fallbackKey);
        if (string.IsNullOrWhiteSpace(path)) return ToolValidation.Fail($"{key} is required.");
        try
        {
            var full = ResolveWorkspacePath(workspace, path);
            if (mustExist && !File.Exists(full)) return ToolValidation.Fail($"{key} does not exist.");
            return ToolValidation.Pass();
        }
        catch (Exception ex)
        {
            return ToolValidation.Fail(ex.Message);
        }
    }

    private static ToolValidation ValidateOptionalWorkspacePath(string workspace, JsonObject args, string key = "path")
    {
        var path = GetString(args, key);
        if (string.IsNullOrWhiteSpace(path)) return ToolValidation.Pass();
        try
        {
            ResolveWorkspacePath(workspace, path);
            return ToolValidation.Pass();
        }
        catch (Exception ex)
        {
            return ToolValidation.Fail(ex.Message);
        }
    }

    private static ToolValidation ValidateRunCommand(string workspace, JsonObject args)
    {
        var argv = GetStringArray(args, "argv");
        if (argv is null || argv.Length == 0 || string.IsNullOrWhiteSpace(argv[0]))
        {
            return ToolValidation.Fail("bash requires argv as a non-empty string array.");
        }

        var executable = Path.GetFileNameWithoutExtension(argv[0]).ToLowerInvariant();
        if (!AllowedCommands.Contains(executable))
        {
            return ToolValidation.Fail($"bash executable is not allowed for verification: {argv[0]}");
        }

        var normalized = argv.Skip(1).Select(arg => arg.Trim().ToLowerInvariant()).ToArray();
        if (normalized.Any(arg => BlockedCommandTokens.Contains(arg)))
        {
            return ToolValidation.Fail("bash contains a blocked mutation, network, or package-management token.");
        }

        if (executable == "git")
        {
            var subcommand = normalized.FirstOrDefault(arg => !arg.StartsWith('-'));
            if (string.IsNullOrWhiteSpace(subcommand) || !AllowedGitSubcommands.Contains(subcommand))
            {
                return ToolValidation.Fail("bash git usage is limited to status, diff, show, log, branch, rev-parse, and ls-files.");
            }
        }

        var cwd = GetString(args, "cwd");
        if (!string.IsNullOrWhiteSpace(cwd))
        {
            try
            {
                ResolveWorkspaceDirectory(workspace, cwd);
            }
            catch (Exception ex)
            {
                return ToolValidation.Fail(ex.Message);
            }
        }

        var timeoutMs = GetInt(args, "timeoutMs");
        if (timeoutMs is not null && (timeoutMs < 1000 || timeoutMs > 600000))
        {
            return ToolValidation.Fail("timeoutMs must be between 1000 and 600000.");
        }

        return ToolValidation.Pass();
    }

    private static string ResolveWorkspacePath(string workspace, string path)
    {
        var root = Path.GetFullPath(workspace);
        var full = Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(root, path));
        if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && !string.Equals(full, root, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Path is outside the selected workspace.");
        }
        return full;
    }

    private static string ToWorkspaceDisplayPath(string workspace, string path) =>
        NormalizeWorkspaceRelativePath(Path.GetRelativePath(Path.GetFullPath(workspace), path));

    private static string NormalizeWorkspaceRelativePath(string path)
    {
        var normalized = path.Replace('\\', '/');
        while (normalized.StartsWith("./", StringComparison.Ordinal))
        {
            normalized = normalized[2..];
        }
        return normalized;
    }

    private static IReadOnlyList<string> FindWorkspaceFilesByPathTail(string workspace, string requestedPath, int maxCandidates)
    {
        var root = Path.GetFullPath(workspace);
        var requested = NormalizeWorkspaceRelativePath(requestedPath);
        var hasDirectorySegment = requested.Contains('/', StringComparison.Ordinal);
        var fileName = Path.GetFileName(requested.Replace('/', Path.DirectorySeparatorChar));
        var matches = new List<string>();
        var scanned = 0;

        try
        {
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                if (++scanned > 50000) break;
                var displayPath = ToWorkspaceDisplayPath(workspace, file);
                var isMatch = hasDirectorySegment
                    ? displayPath.EndsWith("/" + requested, StringComparison.Ordinal)
                    : !string.IsNullOrWhiteSpace(fileName) &&
                        Path.GetFileName(displayPath).Equals(fileName, StringComparison.Ordinal);
                if (!isMatch) continue;
                matches.Add(displayPath);
                if (matches.Count > maxCandidates) break;
            }
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
        {
            // Best-effort candidate discovery. The original validation failure remains authoritative.
        }

        return matches
            .Distinct(StringComparer.Ordinal)
            .OrderBy(static path => path, StringComparer.Ordinal)
            .Take(maxCandidates)
            .ToArray();
    }

    private static string ResolveWorkspaceDirectory(string workspace, string path)
    {
        var full = ResolveWorkspacePath(workspace, path);
        if (!Directory.Exists(full)) throw new InvalidOperationException("cwd does not exist or is not a directory.");
        return full;
    }

    private static string ResolveSearchDirectory(string workspace, JsonObject args)
    {
        var path = GetPathArg(args, "path");
        if (string.IsNullOrWhiteSpace(path)) return Path.GetFullPath(workspace);
        var full = ResolveWorkspacePath(workspace, path);
        if (File.Exists(full)) return Path.GetDirectoryName(full) ?? Path.GetFullPath(workspace);
        if (!Directory.Exists(full)) throw new InvalidOperationException("path does not exist or is not a directory.");
        return full;
    }

    private static string? FindGitRoot(string start)
    {
        var current = new DirectoryInfo(start);
        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, ".git")) || File.Exists(Path.Combine(current.FullName, ".git")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }
        return null;
    }

    private static string? GetString(JsonObject args, string key) =>
        args.TryGetPropertyValue(key, out var value) ? value?.GetValue<string>() : null;

    private static string? GetPathArg(JsonObject args, string key, string? fallbackKey = null) =>
        GetString(args, key) ?? (fallbackKey is null ? null : GetString(args, fallbackKey));

    private static string[]? GetStringArray(JsonObject args, string key)
    {
        if (!args.TryGetPropertyValue(key, out var value) || value is null) return null;
        if (value is not JsonArray array) return null;
        var strings = new List<string>();
        foreach (var item in array)
        {
            if (item is null) return null;
            try
            {
                strings.Add(item.GetValue<string>());
            }
            catch
            {
                return null;
            }
        }
        return strings.ToArray();
    }

    private static string[] NonEmptyTerms(JsonObject args, string key) =>
        (GetStringArray(args, key) ?? [])
            .Select(static term => term.Trim())
            .Where(static term => term.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    private static int? GetInt(JsonObject args, string key)
    {
        if (!args.TryGetPropertyValue(key, out var value) || value is null) return null;
        try
        {
            return value.GetValue<int>();
        }
        catch
        {
            return null;
        }
    }

    private static bool? GetBool(JsonObject args, string key)
    {
        if (!args.TryGetPropertyValue(key, out var value) || value is null) return null;
        try
        {
            return value.GetValue<bool>();
        }
        catch
        {
            return null;
        }
    }

    private static string? GetScalarString(JsonNode? value)
    {
        if (value is null) return null;
        if (value is JsonArray or JsonObject) return null;
        try
        {
            if (value.GetValueKind() == JsonValueKind.String) return value.GetValue<string>();
            if (value.GetValueKind() == JsonValueKind.True) return "true";
            if (value.GetValueKind() == JsonValueKind.False) return "false";
            if (value.GetValueKind() == JsonValueKind.Number) return value.ToJsonString();
        }
        catch
        {
            return null;
        }
        return null;
    }

    private static int CountOccurrences(string source, string value)
    {
        var count = 0;
        var index = 0;
        while ((index = source.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }
        return count;
    }

    private static string NormalizeGeneratedFileContent(string path, string content)
    {
        if (content.Length == 0) return content;
        var extension = Path.GetExtension(path);
        if (!IsMarkupExtension(extension)) return content;

        var trimmed = content.TrimStart();
        if (!trimmed.StartsWith(@"\u003c", StringComparison.OrdinalIgnoreCase) &&
            !content.Contains(@"\u003chtml", StringComparison.OrdinalIgnoreCase) &&
            !content.Contains(@"\u003c!doctype", StringComparison.OrdinalIgnoreCase))
        {
            return content;
        }

        return Regex.Replace(
            content,
            @"\\u(?<hex>[0-9a-fA-F]{4})",
            static match => ((char)Convert.ToInt32(match.Groups["hex"].Value, 16)).ToString());
    }

    private static bool IsMarkupExtension(string extension) =>
        extension.Equals(".html", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".htm", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".svg", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".xml", StringComparison.OrdinalIgnoreCase);

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static string SliceText(string value, int offset, int limit)
    {
        if (offset >= value.Length) return "";
        var length = Math.Min(limit, value.Length - offset);
        return value.Substring(offset, length);
    }

    private static bool LooksLikeOfficeOrPdfGlob(string? glob)
    {
        if (string.IsNullOrWhiteSpace(glob)) return false;
        return Regex.IsMatch(glob, @"\.(xlsx|xlsm|xls|docx|doc|pptx|ppt|pdf)(\W|$)", RegexOptions.IgnoreCase);
    }

    private static void AddRipgrepFilters(List<string> args, JsonObject callArgs)
    {
        AddGlob(args, GetString(callArgs, "glob"));
        foreach (var glob in GetStringArray(callArgs, "includeGlobs") ?? [])
        {
            AddGlob(args, glob);
        }
        foreach (var glob in GetStringArray(callArgs, "globs") ?? [])
        {
            AddGlob(args, glob);
        }
        AddGlob(args, GetString(callArgs, "excludeGlob"), exclude: true);
        foreach (var glob in GetStringArray(callArgs, "excludeGlobs") ?? [])
        {
            AddGlob(args, glob, exclude: true);
        }

        var maxDepth = GetInt(callArgs, "maxDepth");
        if (maxDepth is not null)
        {
            args.Add("--max-depth");
            args.Add(Math.Clamp(maxDepth.Value, 1, 64).ToString());
        }
    }

    private static List<string> BuildGlobArgs(string pattern, JsonObject callArgs)
    {
        var args = new List<string> { "--files" };
        AddGlob(args, pattern);
        AddRipgrepFilters(args, callArgs);
        return args;
    }

    private static string NormalizeGlobPattern(string pattern)
    {
        var trimmed = pattern.Trim();
        if (trimmed.Length == 0) return "**/*";
        if (!ContainsGlobWildcard(trimmed))
        {
            return $"**/*{trimmed}*";
        }

        var normalized = trimmed.Replace('\\', '/');
        if (normalized.StartsWith("**/", StringComparison.Ordinal) &&
            !normalized.EndsWith('*') &&
            !normalized.EndsWith('/') &&
            Path.GetFileName(normalized).IndexOf('.') < 0)
        {
            var prefix = normalized[..^Path.GetFileName(normalized).Length];
            var leaf = Path.GetFileName(normalized);
            return $"{prefix}*{leaf}*";
        }

        return pattern;
    }

    private static bool TryBuildDirectoryDescendantGlob(string pattern, out string descendantPattern)
    {
        descendantPattern = "";
        var normalized = pattern.Trim().Replace('\\', '/').TrimEnd('/');
        if (normalized.Length == 0 ||
            normalized.EndsWith("/**", StringComparison.Ordinal) ||
            normalized.EndsWith("/**/*", StringComparison.Ordinal))
        {
            return false;
        }

        var leaf = Path.GetFileName(normalized);
        if (string.IsNullOrWhiteSpace(leaf) ||
            leaf is "*" or "**" ||
            leaf.Contains('.', StringComparison.Ordinal))
        {
            return false;
        }

        descendantPattern = $"{normalized}/**/*";
        return true;
    }

    private static bool ContainsGlobWildcard(string text) =>
        text.IndexOfAny(['*', '?', '[', ']', '{', '}']) >= 0;

    private static void AddGlob(List<string> args, string? glob, bool exclude = false)
    {
        if (string.IsNullOrWhiteSpace(glob)) return;
        var pattern = exclude && !glob.StartsWith('!') ? $"!{glob}" : glob;
        args.AddRange(["-g", pattern]);
    }

    private static async Task<ProcessResult> RunProcessAsync(
        string fileName,
        IReadOnlyList<string> args,
        string workingDirectory,
        CancellationToken cancellationToken,
        bool allowExitOne = false)
    {
        return await RelayProcess.RunAsync(fileName, args, workingDirectory, cancellationToken, allowExitOne);
    }

    private static async Task<LineProcessResult> RunLineProcessAsync(
        string fileName,
        IReadOnlyList<string> args,
        string workingDirectory,
        CancellationToken cancellationToken,
        int maxLines,
        Func<string, bool>? includeLine,
        bool allowExitOne = false,
        int timeoutMs = 60000)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(timeoutMs);

        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);

        var lines = new List<string>();
        var stderr = new StringBuilder();
        var linesLock = new object();
        var stderrLock = new object();
        var stdoutDone = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var stderrDone = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var truncated = 0;

        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null)
            {
                stdoutDone.TrySetResult(null);
                return;
            }

            if (Volatile.Read(ref truncated) == 1) return;
            if (includeLine is not null && !includeLine(eventArgs.Data)) return;

            var shouldStop = false;
            lock (linesLock)
            {
                if (lines.Count < maxLines)
                {
                    lines.Add(eventArgs.Data.Trim());
                    shouldStop = lines.Count >= maxLines;
                }
            }

            if (shouldStop)
            {
                Volatile.Write(ref truncated, 1);
                TryKill(process);
            }
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null)
            {
                stderrDone.TrySetResult(null);
                return;
            }

            lock (stderrLock)
            {
                if (stderr.Length < 12000) stderr.AppendLine(eventArgs.Data);
            }
        };

        try
        {
            if (!process.Start())
            {
                return new LineProcessResult(false, [], "Process did not start.", false);
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync(timeout.Token);
            await Task.WhenAll(stdoutDone.Task, stderrDone.Task).WaitAsync(timeout.Token);

            var wasTruncated = Volatile.Read(ref truncated) == 1;
            var exitCode = process.ExitCode;
            var success = wasTruncated || exitCode == 0 || (allowExitOne && exitCode == 1);
            IReadOnlyList<string> snapshot;
            lock (linesLock)
            {
                snapshot = lines.ToArray();
            }

            string errorText;
            lock (stderrLock)
            {
                errorText = stderr.ToString().Trim();
            }
            var output = success
                ? errorText
                : string.Join("\n", [string.Join("\n", snapshot), errorText]).Trim();
            return new LineProcessResult(success, snapshot, output, wasTruncated);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            TryKill(process);
            return new LineProcessResult(false, [], $"{fileName} timed out after {timeoutMs}ms.", false);
        }
        catch (Exception ex)
        {
            TryKill(process);
            return new LineProcessResult(false, [], ex.Message, false);
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best-effort cleanup.
        }
    }
}

public enum RelayPatchOperationKind
{
    Add,
    Delete,
    Update,
}

public sealed record RelayPatchOperation(
    RelayPatchOperationKind Kind,
    string Path,
    string? OldText,
    string? NewText);

public static class RelayPatch
{
    public static bool TryRepairCopilotMarkdownAddFilePrefixes(string patch, out string repaired)
    {
        repaired = patch.Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = repaired.Split('\n');
        var changed = false;
        var inRepairableAddFile = false;
        var output = new List<string>(lines.Length);

        foreach (var line in lines)
        {
            if (line.StartsWith("*** ", StringComparison.Ordinal))
            {
                inRepairableAddFile = line.StartsWith("*** Add File: ", StringComparison.Ordinal) &&
                    IsMarkdownPatchPath(line["*** Add File: ".Length..].Trim());
                output.Add(line);
                continue;
            }

            if (inRepairableAddFile && !line.StartsWith('+'))
            {
                output.Add("+" + line);
                changed = true;
                continue;
            }

            output.Add(line);
        }

        repaired = string.Join('\n', output);
        return changed;
    }

    public static bool TryParse(string patch, out IReadOnlyList<RelayPatchOperation> operations, out string? error)
    {
        operations = [];
        error = null;
        var normalized = patch.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd('\n');
        var lines = normalized.Split('\n');
        if (lines.Length < 2 || lines[0] != "*** Begin Patch" || lines[^1] != "*** End Patch")
        {
            error = "patch must start with *** Begin Patch and end with *** End Patch.";
            return false;
        }
        var beginCount = lines.Count(line => line == "*** Begin Patch");
        var endCount = lines.Count(line => line == "*** End Patch");
        if (beginCount != 1 || endCount != 1)
        {
            error = "patchText must contain exactly one *** Begin Patch and one *** End Patch envelope.";
            return false;
        }

        var result = new List<RelayPatchOperation>();
        for (var index = 1; index < lines.Length - 1;)
        {
            var line = lines[index];
            if (line.StartsWith("*** Add File: ", StringComparison.Ordinal))
            {
                var path = line["*** Add File: ".Length..].Trim();
                if (!IsSafePatchPath(path, out error)) return false;
                index++;
                var builder = new StringBuilder();
                while (index < lines.Length - 1 && !lines[index].StartsWith("*** ", StringComparison.Ordinal))
                {
                    if (!lines[index].StartsWith('+'))
                    {
                        error = $"Add file lines must start with '+': {path}";
                        return false;
                    }
                    builder.AppendLine(lines[index][1..]);
                    index++;
                }
                result.Add(new RelayPatchOperation(RelayPatchOperationKind.Add, path, null, TrimFinalNewline(builder.ToString())));
                continue;
            }

            if (line.StartsWith("*** Delete File: ", StringComparison.Ordinal))
            {
                var path = line["*** Delete File: ".Length..].Trim();
                if (!IsSafePatchPath(path, out error)) return false;
                result.Add(new RelayPatchOperation(RelayPatchOperationKind.Delete, path, null, null));
                index++;
                continue;
            }

            if (line.StartsWith("*** Update File: ", StringComparison.Ordinal))
            {
                var path = line["*** Update File: ".Length..].Trim();
                if (!IsSafePatchPath(path, out error)) return false;
                index++;
                if (index < lines.Length - 1 && lines[index].StartsWith("*** Move to: ", StringComparison.Ordinal))
                {
                    error = "patch move operations are not supported yet.";
                    return false;
                }

                var operationCountBeforeUpdate = result.Count;
                var oldText = new StringBuilder();
                var newText = new StringBuilder();
                var sawChange = false;
                void FlushUpdateHunk()
                {
                    if (!sawChange)
                    {
                        oldText.Clear();
                        newText.Clear();
                        return;
                    }
                    result.Add(new RelayPatchOperation(
                        RelayPatchOperationKind.Update,
                        path,
                        TrimFinalNewline(oldText.ToString()),
                        TrimFinalNewline(newText.ToString())));
                    oldText.Clear();
                    newText.Clear();
                    sawChange = false;
                }

                while (index < lines.Length - 1 && !lines[index].StartsWith("*** ", StringComparison.Ordinal))
                {
                    var current = lines[index];
                    if (current.StartsWith("@@", StringComparison.Ordinal))
                    {
                        FlushUpdateHunk();
                        index++;
                        continue;
                    }
                    if (current.Length == 0)
                    {
                        error = $"Patch line is missing a prefix in {path}.";
                        return false;
                    }

                    switch (current[0])
                    {
                        case ' ':
                            oldText.AppendLine(current[1..]);
                            newText.AppendLine(current[1..]);
                            break;
                        case '-':
                            oldText.AppendLine(current[1..]);
                            sawChange = true;
                            break;
                        case '+':
                            newText.AppendLine(current[1..]);
                            sawChange = true;
                            break;
                        default:
                            error = $"Unsupported patch line prefix '{current[0]}' in {path}.";
                            return false;
                    }
                    index++;
                }
                FlushUpdateHunk();
                if (result.Count == operationCountBeforeUpdate)
                {
                    error = $"Update file has no changed lines: {path}";
                    return false;
                }
                continue;
            }

            error = $"Unsupported patch hunk: {line}";
            return false;
        }

        operations = result;
        return true;
    }

    private static string NormalizePatchEnvelope(string patch)
    {
        var lines = patch.Trim().Split('\n');
        var beginCount = lines.Count(line => line == "*** Begin Patch");
        var endCount = lines.Count(line => line == "*** End Patch");
        if (beginCount <= 1 && endCount <= 1)
        {
            return string.Join('\n', lines);
        }

        var outside = false;
        var body = new List<string>();
        var inside = false;
        foreach (var line in lines)
        {
            if (line == "*** Begin Patch")
            {
                inside = true;
                continue;
            }

            if (line == "*** End Patch")
            {
                inside = false;
                continue;
            }

            if (inside)
            {
                body.Add(line);
            }
            else if (!string.IsNullOrWhiteSpace(line))
            {
                outside = true;
            }
        }

        if (outside || body.Count == 0)
        {
            return string.Join('\n', lines);
        }

        return "*** Begin Patch\n" + string.Join('\n', body) + "\n*** End Patch";
    }

    private static bool IsSafePatchPath(string path, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(path) || path.IndexOf('\0') >= 0)
        {
            error = "patch path is invalid.";
            return false;
        }
        if (path.StartsWith('/') || path.StartsWith('\\') || Path.IsPathRooted(path))
        {
            error = "patch paths must be relative to the workspace.";
            return false;
        }
        return true;
    }

    private static bool IsMarkdownPatchPath(string path) =>
        path.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ||
        path.EndsWith(".markdown", StringComparison.OrdinalIgnoreCase);

    private static string TrimFinalNewline(string value) =>
        value.EndsWith('\n') ? value[..^1] : value;
}

public sealed record RelayToolCall(string Id, string Tool, JsonObject Args);

public sealed record RelayToolProvider(
    string Name,
    Func<string, JsonObject, ToolValidation> Validate,
    Func<RelayToolCall, string> Describe,
    Func<string, RelayToolCall, CancellationToken, Task<ToolObservation>> Execute,
    Func<RelayToolCall, bool> RequiresApproval);

public sealed record ToolObservation(string ToolCallId, string Tool, bool Success, string Summary, object? Data)
{
    public string SchemaVersion => "RelayToolObservation.v1";
    public string Status => Success ? "success" : "failed";
    public IReadOnlyList<string> ArtifactIds => ToolObservationArtifacts.Extract(Data);
    public IReadOnlyList<string> Warnings => [];
    public bool Retryable => !Success;
    public string? DataHash => Data is null
        ? null
        : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(Data, JsonOptions.Compact))))[..12].ToLowerInvariant();

    public static ToolObservation Ok(string id, string tool, string summary, object? data) => new(id, tool, true, summary, data);
    public static ToolObservation Fail(string id, string tool, string summary, object? data = null) => new(id, tool, false, summary, data);
}

public static class ToolObservationArtifacts
{
    public static IReadOnlyList<string> Extract(object? data)
    {
        var artifacts = new SortedSet<string>(StringComparer.Ordinal);
        ExtractValue(data, artifacts);
        return artifacts.ToArray();
    }

    private static void ExtractValue(object? value, ISet<string> artifacts)
    {
        switch (value)
        {
            case null:
                return;
            case string text:
                AddIfPathLike(text, artifacts);
                return;
            case JsonElement element:
                ExtractJsonElement(element, artifacts);
                return;
            case JsonObject obj:
                foreach (var (_, child) in obj) ExtractValue(child, artifacts);
                return;
            case JsonArray array:
                foreach (var child in array) ExtractValue(child, artifacts);
                return;
        }

        var type = value.GetType();
        if (type.IsPrimitive || value is decimal or DateTime or DateTimeOffset)
        {
            return;
        }

        if (value is System.Collections.IEnumerable enumerable && value is not string)
        {
            foreach (var item in enumerable) ExtractValue(item, artifacts);
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, JsonOptions.Compact));
            ExtractJsonElement(document.RootElement, artifacts);
        }
        catch
        {
            // Artifact extraction is best-effort and must not change tool results.
        }
    }

    private static void ExtractJsonElement(JsonElement element, ISet<string> artifacts)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                AddIfPathLike(element.GetString(), artifacts);
                break;
            case JsonValueKind.Array:
                foreach (var child in element.EnumerateArray()) ExtractJsonElement(child, artifacts);
                break;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject()) ExtractJsonElement(property.Value, artifacts);
                break;
        }
    }

    private static void AddIfPathLike(string? text, ISet<string> artifacts)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 600 || text.Contains('\n') || text.Contains('\r')) return;
        var normalized = text.Replace('\\', '/');
        if (normalized.Contains('/') || Regex.IsMatch(normalized, @"^[A-Za-z]:/"))
        {
            artifacts.Add(normalized);
        }
    }
}

public sealed record ToolValidation(bool Ok, string? Error)
{
    public static ToolValidation Pass() => new(true, null);
    public static ToolValidation Fail(string error) => new(false, error);
}

public sealed record ProcessResult(bool Success, string Output);

public sealed record LineProcessResult(bool Success, IReadOnlyList<string> Lines, string Output, bool Truncated);

public sealed record RelayAgentPlan(string Action, string? Tool, JsonObject? Args, string? Answer)
{
    public static RelayAgentPlan Parse(string text)
    {
        var trimmed = ExtractJsonObject(text);
        JsonObject node;
        try
        {
            node = JsonNode.Parse(trimmed)?.AsObject() ?? throw new InvalidOperationException("Copilot did not return a JSON object.");
        }
        catch when (TryParseLenientWrite(text, out var lenient))
        {
            return lenient!;
        }

        var action = node["action"]?.GetValue<string>() ?? "";
        return new RelayAgentPlan(
            action,
            node["tool"]?.GetValue<string>(),
            node["args"] as JsonObject,
            node["answer"]?.GetValue<string>());
    }

    private static string ExtractJsonObject(string text)
    {
        var start = text.IndexOf('{');
        if (start < 0)
        {
            if (TryParseLenientWrite(text, out var _)) return text;
            throw new InvalidOperationException("No JSON object found in Copilot response.");
        }

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var index = start; index < text.Length; index++)
        {
            var c = text[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                    continue;
                }
                if (c == '\\')
                {
                    escaped = true;
                    continue;
                }
                if (c == '"')
                {
                    inString = false;
                }
                continue;
            }

            if (c == '"')
            {
                inString = true;
                continue;
            }
            if (c == '{')
            {
                depth++;
                continue;
            }
            if (c == '}')
            {
                depth--;
                if (depth == 0) return text[start..(index + 1)];
                if (depth < 0) break;
            }
        }

        if (TryParseLenientWrite(text, out var _)) return text;
        throw new InvalidOperationException("No complete JSON object found in Copilot response.");
    }

    private static bool TryParseLenientWrite(string text, out RelayAgentPlan? plan)
    {
        plan = null;
        if (!Regex.IsMatch(text, @"""action""\s*:\s*""tool""", RegexOptions.IgnoreCase) ||
            !Regex.IsMatch(text, @"""tool""\s*:\s*""write""", RegexOptions.IgnoreCase))
        {
            return false;
        }

        var pathMatch = Regex.Match(text, @"""(?:file_path|path)""\s*:\s*""(?<path>(?:\\.|[^""\\])*)""");
        if (!pathMatch.Success) return false;

        var contentMatch = Regex.Match(text, @"""content""\s*:\s*""", RegexOptions.Singleline);
        if (!contentMatch.Success) return false;

        var contentStart = contentMatch.Index + contentMatch.Length;
        var contentEnd = text.LastIndexOf("\"}}", StringComparison.Ordinal);
        if (contentEnd <= contentStart)
        {
            contentEnd = text.LastIndexOf("\"}\n}", StringComparison.Ordinal);
        }
        if (contentEnd <= contentStart) return false;

        var args = new JsonObject
        {
            ["file_path"] = DecodeJsonishString(pathMatch.Groups["path"].Value),
            ["content"] = DecodeJsonishString(text[contentStart..contentEnd]),
        };
        plan = new RelayAgentPlan("tool", "write", args, null);
        return true;
    }

    private static string DecodeJsonishString(string text) =>
        text
            .Replace("\\r\\n", "\n", StringComparison.Ordinal)
            .Replace("\\n", "\n", StringComparison.Ordinal)
            .Replace("\\r", "\n", StringComparison.Ordinal)
            .Replace("\\t", "\t", StringComparison.Ordinal)
            .Replace("\\\"", "\"", StringComparison.Ordinal)
            .Replace("\\\\", "\\", StringComparison.Ordinal);
}
