using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

public sealed class RelayAgentFrameworkRunner
{
    private const int MaxSteps = 6;
    private const string AllowedTools = "rg_files, rg_search, read, officecli, edit, write, workspace_status, diff, run_command, ask_user";
    private const string AgentInstructions = """
        You are Relay Agent's Microsoft Agent Framework planner.
        M365 Copilot provides reasoning. Relay validates and executes local tools.
        Return only the JSON object requested by each Relay prompt.
        Do not claim local execution yourself.
        """;
    private readonly ChatClientAgent _agent;
    private readonly ChatClientAgentRunOptions _runOptions = new(new ChatOptions
    {
        ModelId = "m365-copilot",
    });
    private readonly RelayToolExecutor _tools;

    public RelayAgentFrameworkRunner(IChatClient chatClient, RelayToolExecutor tools)
    {
        _agent = new ChatClientAgent(
            chatClient,
            "relay-agent",
            "Relay Agent",
            AgentInstructions,
            new List<AITool>(),
            null,
            null);
        _tools = tools;
    }

    public async Task<AgentRunResult> RunAsync(
        RunRequest request,
        string runId,
        Func<RunEvent, CancellationToken, ValueTask>? onEvent,
        CancellationToken cancellationToken)
    {
        var events = new List<RunEvent>();
        var observations = new List<ToolObservation>();

        async ValueTask Emit(RunEvent runEvent)
        {
            events.Add(runEvent);
            if (onEvent is not null)
            {
                await onEvent(runEvent, cancellationToken);
            }
        }

        var session = await _agent.CreateSessionAsync(cancellationToken);
        await Emit(RunEvent.Status(
            "Microsoft Agent Framework セッションを開始しました",
            "Copilot turns are routed through ChatClientAgent; Relay still validates and executes local tools."));

        for (var step = 1; step <= MaxSteps; step++)
        {
            await Emit(RunEvent.CopilotTurnStarted("Copilot が次の手順を選択しています", $"step {step}/{MaxSteps}"));
            var planText = await RunCopilotTurnAsync(BuildStepPrompt(request, observations), session, cancellationToken);
            RelayAgentPlan plan;
            try
            {
                plan = RelayAgentPlan.Parse(planText);
                await Emit(RunEvent.CopilotTurnCompleted("Copilot の計画を受け取りました", plan.Action));
            }
            catch (Exception parseError)
            {
                await Emit(RunEvent.Status("Copilot のJSON形式を修復しています", parseError.Message));
                var repairText = await RunCopilotTurnAsync(
                    BuildPlanRepairPrompt(request, observations, planText, parseError.Message),
                    session,
                    cancellationToken);
                try
                {
                    plan = RelayAgentPlan.Parse(repairText);
                    await Emit(RunEvent.CopilotTurnCompleted("Copilot の計画を修復しました", plan.Action));
                }
                catch (Exception repairError)
                {
                    await Emit(RunEvent.Error("Copilot の計画を検証できません", $"repair failed: {repairError.Message}"));
                    return new AgentRunResult("failed", events, null);
                }
            }

            if (plan.Action == "final")
            {
                if (IsPlaceholderFinalAnswer(plan.Answer))
                {
                    await Emit(RunEvent.Error("Copilot の最終回答を検証できません", "placeholder final answer was returned instead of the user's requested answer."));
                    return new AgentRunResult("failed", events, null);
                }
                await Emit(RunEvent.Completed("完了しました", plan.Answer ?? ""));
                return new AgentRunResult("completed", events, null);
            }

            if (plan.Action != "tool" || string.IsNullOrWhiteSpace(plan.Tool))
            {
                await Emit(RunEvent.Error("Copilot の計画を検証できません", "action は final または tool である必要があります。"));
                return new AgentRunResult("failed", events, null);
            }

            var toolCall = new RelayToolCall($"tool-{step:00}", plan.Tool, plan.Args ?? new JsonObject());
            var validation = _tools.Validate(request.Workspace, toolCall);
            if (!validation.Ok)
            {
                await Emit(RunEvent.Error("ツール引数を検証できません", validation.Error));
                return new AgentRunResult("failed", events, null);
            }

            if (_tools.RequiresApproval(toolCall))
            {
                var approval = PendingApproval.FromToolCall(runId, toolCall);
                await Emit(RunEvent.Approval("実行前に確認してください", _tools.Describe(toolCall)));
                return new AgentRunResult("approval_required", events, approval);
            }

            await Emit(RunEvent.ToolCallStarted(toolCall.Tool, _tools.Describe(toolCall)));
            var observation = await _tools.ExecuteAsync(request.Workspace, toolCall, cancellationToken);
            observations.Add(observation);
            await Emit(observation.Success
                ? RunEvent.ToolCallCompleted($"{toolCall.Tool} completed", observation.Summary)
                : RunEvent.Error($"{toolCall.Tool} failed", observation.Summary));

            if (!observation.Success)
            {
                return new AgentRunResult("failed", events, null);
            }
        }

        await Emit(RunEvent.Error("手順上限に達しました", $"最大 {MaxSteps} step で停止しました。"));
        return new AgentRunResult("failed", events, null);
    }

    public async Task<AgentRunResult> ApproveAsync(
        RunRecord run,
        Func<RunEvent, CancellationToken, ValueTask>? onEvent,
        CancellationToken cancellationToken)
    {
        if (run.PendingApproval is null)
        {
            return new AgentRunResult("failed", [RunEvent.Error("承認待ちではありません", "実行できる保留中の操作がありません。")], null);
        }

        var events = new List<RunEvent>();

        async ValueTask Emit(RunEvent runEvent)
        {
            events.Add(runEvent);
            if (onEvent is not null)
            {
                await onEvent(runEvent, cancellationToken);
            }
        }

        var toolCall = run.PendingApproval.ToolCall;
        await Emit(RunEvent.ApprovalResolved("承認しました", _tools.Describe(toolCall)));
        await Emit(RunEvent.ToolCallStarted("承認済みの操作を実行しています", _tools.Describe(toolCall)));
        var observation = await _tools.ExecuteAsync(run.Request.Workspace, toolCall, cancellationToken, approvalGranted: true);
        await Emit(observation.Success
            ? RunEvent.ToolCallCompleted($"{toolCall.Tool} completed", observation.Summary)
            : RunEvent.Error($"{toolCall.Tool} failed", observation.Summary));

        if (!observation.Success)
        {
            return new AgentRunResult("failed", events, null);
        }

        var finalPrompt = string.Join("\n", [
            "RELAY AGENT FINALIZER",
            "Relay executed the approved local tool. Summarize the result in concise Japanese.",
            "Do not claim anything not present in the observation.",
            "USER REQUEST:",
            run.Request.Instruction,
            "OBSERVATION JSON:",
            JsonSerializer.Serialize(observation, JsonOptions.Default),
        ]);
        var session = await _agent.CreateSessionAsync(cancellationToken);
        await Emit(RunEvent.Status(
            "Microsoft Agent Framework セッションを再開しました",
            "Approved observation finalization is routed through ChatClientAgent."));
        var final = await RunCopilotTurnAsync(finalPrompt, session, cancellationToken);
        await Emit(RunEvent.Completed("完了しました", final));
        return new AgentRunResult("completed", events, null);
    }

    private async Task<string> RunCopilotTurnAsync(string prompt, AgentSession session, CancellationToken cancellationToken)
    {
        var response = await _agent.RunAsync(prompt, session, _runOptions, cancellationToken);
        return response.Text;
    }

    private static string BuildStepPrompt(RunRequest request, IReadOnlyList<ToolObservation> observations) =>
        string.Join("\n", [
            "RELAY AGENT STEP PLANNER",
            "Mode: choose exactly one next action for Relay.",
            "Return exactly one JSON object and nothing else.",
            """For a final answer, return fields: action="final", answer=<your actual concise answer to the user>.""",
            """For a tool call, return fields: action="tool", tool=<one allowed tool name>, args=<JSON object>.""",
            $"Allowed tool names: {AllowedTools}.",
            "Rules:",
            "- Do not copy placeholder text from these instructions.",
            "- Never answer with placeholder text such as `Japanese answer`, `answer`, or `final answer`.",
            "- If the user's request can be satisfied without tools, return action=\"final\" with the real user-facing answer immediately.",
            "- If the user requested an exact phrase or exact JSON answer, put that exact requested content in `answer`.",
            "- Relay executes tools locally. You do not execute or claim execution.",
            "- Use rg_files or rg_search before read unless the exact file path is already known.",
            "- Use read for exact files only. read can extract bounded text from txt/md/csv/code plus docx/xlsx/xlsm/pptx/text-layer pdf.",
            "- Use officecli for Office inspection or mutation. Mutations require approval.",
            "- officecli args must be semantic, never raw argv. Shape: { filePath, operation, target?, mode?, selector?, elementType?, properties?, depth?, format?, verb?, element? }.",
            "- Useful officecli operations: capabilities, help, view, get, query, validate, dump, create, set, add, remove, move, copy, refresh, open, close, watch, unwatch, goto.",
            "- For Excel cell formatting use operation=\"set\", target=\"/Sheet1/A1\", properties={\"fill\":\"FF0000\"}.",
            "- For Office help/schema use operation=\"help\" with format/verb/element instead of guessing property names.",
            "- Use edit/write only for workspace-scoped file changes. They require approval.",
            "- Use workspace_status before code changes when repository state matters.",
            "- Use diff to review local changes before summarizing a code or text edit.",
            "- Use run_command only for bounded verification such as test, build, lint, typecheck, or git status/diff. It requires approval.",
            "- If enough observations exist, return final.",
            "- Never request shell/bash/powershell.",
            $"WORKSPACE: {request.Workspace}",
            "USER REQUEST:",
            request.Instruction,
            "OBSERVATIONS JSON:",
            JsonSerializer.Serialize(observations, JsonOptions.Default),
            "Return the next JSON object now.",
        ]);

    private static string BuildPlanRepairPrompt(
        RunRequest request,
        IReadOnlyList<ToolObservation> observations,
        string invalidResponse,
        string validationError) =>
        string.Join("\n", [
            "RELAY AGENT JSON REPAIR",
            "Mode: repair only. Do not answer the user and do not call tools.",
            "Return exactly one valid JSON object and nothing else.",
            """For a final answer, return fields: action="final", answer=<actual concise Japanese answer>.""",
            """For a tool call, return fields: action="tool", tool=<one allowed tool name>, args=<JSON object>.""",
            $"Allowed tool names: {AllowedTools}.",
            "Rules:",
            "- Preserve the intent of the invalid response.",
            "- Escape Windows backslashes correctly or prefer forward slashes inside JSON strings.",
            "- Do not include markdown, prose, code fences, or fields outside action/tool/args/answer.",
            $"- Validation error: {validationError}",
            $"WORKSPACE: {request.Workspace}",
            "USER REQUEST:",
            request.Instruction,
            "OBSERVATIONS JSON:",
            JsonSerializer.Serialize(observations, JsonOptions.Default),
            "INVALID RESPONSE:",
            invalidResponse,
            "Return the repaired JSON object now.",
        ]);

    private static bool IsPlaceholderFinalAnswer(string? answer)
    {
        var normalized = (answer ?? "").Trim().Trim('"').ToLowerInvariant();
        return normalized is "" or "answer" or "final answer" or "japanese answer" or "your actual concise answer to the user";
    }
}

public sealed class RelayToolExecutor(string dataDirectory, ToolResolver toolResolver)
{
    private static readonly HashSet<string> ReadTools = ["rg_files", "rg_search", "read", "workspace_status", "diff", "ask_user"];
    private static readonly HashSet<string> WriteTools = ["officecli", "edit", "write", "run_command"];
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

    public bool RequiresApproval(RelayToolCall call) =>
        call.Tool == "officecli"
            ? OfficeCliCapabilityRegistry.RequiresApproval(call.Args)
            : call.Tool == "run_command"
                ? true
            : WriteTools.Contains(call.Tool);

    public ToolValidation Validate(string workspace, RelayToolCall call)
    {
        if (!ReadTools.Contains(call.Tool) && !WriteTools.Contains(call.Tool))
        {
            return ToolValidation.Fail($"Unknown tool: {call.Tool}");
        }
        if (!Directory.Exists(workspace)) return ToolValidation.Fail("Workspace does not exist.");

        return call.Tool switch
        {
            "rg_files" => ToolValidation.Pass(),
            "rg_search" => string.IsNullOrWhiteSpace(GetString(call.Args, "pattern"))
                ? ToolValidation.Fail("rg_search requires pattern.")
                : ToolValidation.Pass(),
            "read" => ValidateWorkspacePath(workspace, call.Args, mustExist: true),
            "officecli" => OfficeCliCapabilityRegistry.TryCompile(workspace, call.Args, out _, out var officeError)
                ? ToolValidation.Pass()
                : ToolValidation.Fail(officeError ?? "Invalid officecli operation."),
            "edit" => ValidateWorkspacePath(workspace, call.Args, mustExist: true),
            "write" => ValidateWorkspacePath(workspace, call.Args, mustExist: false),
            "workspace_status" => ToolValidation.Pass(),
            "diff" => ValidateOptionalWorkspacePath(workspace, call.Args),
            "run_command" => ValidateRunCommand(workspace, call.Args),
            "ask_user" => ToolValidation.Pass(),
            _ => ToolValidation.Fail($"Unsupported tool: {call.Tool}"),
        };
    }

    public string Describe(RelayToolCall call) =>
        call.Tool switch
        {
            "rg_files" => $"files contains={GetString(call.Args, "contains") ?? "*"}",
            "rg_search" => $"pattern={GetString(call.Args, "pattern")}",
            "read" => $"path={GetString(call.Args, "path")}",
            "officecli" => OfficeCliCapabilityRegistry.Describe(call.Args),
            "edit" => $"path={GetString(call.Args, "path")}",
            "write" => $"path={GetString(call.Args, "path")}",
            "workspace_status" => "inspect workspace and git status",
            "diff" => $"diff path={GetString(call.Args, "path") ?? "."}",
            "run_command" => $"verify command={string.Join(" ", GetStringArray(call.Args, "argv") ?? [])}",
            "ask_user" => GetString(call.Args, "question") ?? "追加情報が必要です。",
            _ => call.Tool,
        };

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
            return call.Tool switch
            {
                "rg_files" => await RgFilesAsync(workspace, call, cancellationToken),
                "rg_search" => await RgSearchAsync(workspace, call, cancellationToken),
                "read" => await ReadAsync(workspace, call, cancellationToken),
                "officecli" => await OfficeCliAsync(workspace, call, cancellationToken),
                "edit" => await EditAsync(workspace, call, cancellationToken),
                "write" => await WriteAsync(workspace, call, cancellationToken),
                "workspace_status" => await WorkspaceStatusAsync(workspace, call, cancellationToken),
                "diff" => await DiffAsync(workspace, call, cancellationToken),
                "run_command" => await RunCommandAsync(workspace, call, cancellationToken),
                "ask_user" => ToolObservation.Ok(call.Id, call.Tool, GetString(call.Args, "question") ?? "追加情報が必要です。", null),
                _ => ToolObservation.Fail(call.Id, call.Tool, $"Unknown tool: {call.Tool}"),
            };
        }
        catch (Exception ex)
        {
            return ToolObservation.Fail(call.Id, call.Tool, ex.Message);
        }
    }

    private async Task<ToolObservation> RgFilesAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var rg = toolResolver.ResolveRipgrep();
        if (!rg.Available || string.IsNullOrWhiteSpace(rg.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, rg.Detail);
        }

        var contains = GetString(call.Args, "contains");
        var limit = Math.Clamp(GetInt(call.Args, "limit") ?? 50, 1, 200);
        var args = new List<string> { "--files" };
        AddRipgrepFilters(args, call.Args);
        var result = await RunLineProcessAsync(
            rg.ExecutablePath,
            args,
            workspace,
            cancellationToken,
            maxLines: limit,
            includeLine: line => string.IsNullOrWhiteSpace(contains) || line.Contains(contains, StringComparison.OrdinalIgnoreCase),
            timeoutMs: Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 60000, 1000, 120000));
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        var summary = result.Truncated
            ? $"{result.Lines.Count} file candidates (truncated at limit)"
            : $"{result.Lines.Count} file candidates";
        return ToolObservation.Ok(call.Id, call.Tool, summary, result.Lines);
    }

    private async Task<ToolObservation> RgSearchAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var rg = toolResolver.ResolveRipgrep();
        if (!rg.Available || string.IsNullOrWhiteSpace(rg.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, rg.Detail);
        }

        var pattern = GetString(call.Args, "pattern") ?? "";
        var limit = Math.Clamp(GetInt(call.Args, "limit") ?? 80, 1, 200);
        var args = new List<string> { "--line-number", "--color", "never", "--fixed-strings" };
        AddRipgrepFilters(args, call.Args);
        args.AddRange(["--", pattern]);
        var result = await RunLineProcessAsync(
            rg.ExecutablePath,
            args,
            workspace,
            cancellationToken,
            maxLines: limit,
            includeLine: null,
            allowExitOne: true,
            timeoutMs: Math.Clamp(GetInt(call.Args, "timeoutMs") ?? 60000, 1000, 120000));
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        var summary = result.Truncated
            ? $"{result.Lines.Count} content matches (truncated at limit)"
            : $"{result.Lines.Count} content matches";
        return ToolObservation.Ok(call.Id, call.Tool, summary, result.Lines);
    }

    private static async Task<ToolObservation> ReadAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetString(call.Args, "path") ?? "");
        var info = new FileInfo(path);
        if (DocumentTextExtractor.IsSupported(path))
        {
            var document = await DocumentTextExtractor.ExtractAsync(path, maxChars: 12000, cancellationToken);
            var suffix = document.Truncated ? " (truncated)" : "";
            var warningSuffix = document.Warnings.Count > 0 ? $"; warnings={document.Warnings.Count}" : "";
            return ToolObservation.Ok(
                call.Id,
                call.Tool,
                $"{document.Kind} extracted, {document.Text.Length} chars read{suffix}{warningSuffix}",
                new
                {
                    kind = document.Kind,
                    text = document.Text,
                    truncated = document.Truncated,
                    warnings = document.Warnings,
                });
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
        return ToolObservation.Ok(call.Id, call.Tool, $"{Math.Min(text.Length, 8000)} chars read", text.Length > 8000 ? text[..8000] : text);
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
        var path = ResolveWorkspacePath(workspace, GetString(call.Args, "path") ?? "");
        var oldString = GetString(call.Args, "oldString") ?? "";
        var newString = GetString(call.Args, "newString") ?? "";
        if (oldString.Length == 0) return ToolObservation.Fail(call.Id, call.Tool, "oldString is required.");
        var text = await File.ReadAllTextAsync(path, cancellationToken);
        var count = CountOccurrences(text, oldString);
        if (count != 1) return ToolObservation.Fail(call.Id, call.Tool, $"oldString must match exactly once; matches={count}.");
        var backupPath = await CreateBackupAsync(path, cancellationToken);
        await File.WriteAllTextAsync(path, text.Replace(oldString, newString), cancellationToken);
        return ToolObservation.Ok(call.Id, call.Tool, $"1 replacement applied; backup={backupPath}", path);
    }

    private async Task<ToolObservation> WriteAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetString(call.Args, "path") ?? "");
        var content = GetString(call.Args, "content") ?? "";
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var backupPath = File.Exists(path) ? await CreateBackupAsync(path, cancellationToken) : null;
        await File.WriteAllTextAsync(path, content, cancellationToken);
        return ToolObservation.Ok(call.Id, call.Tool, backupPath is null ? "file written" : $"file written; backup={backupPath}", path);
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

    private static ToolValidation ValidateWorkspacePath(string workspace, JsonObject args, bool mustExist, string key = "path")
    {
        var path = GetString(args, key);
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
            return ToolValidation.Fail("run_command requires argv as a non-empty string array.");
        }

        var executable = Path.GetFileNameWithoutExtension(argv[0]).ToLowerInvariant();
        if (!AllowedCommands.Contains(executable))
        {
            return ToolValidation.Fail($"run_command executable is not allowed for verification: {argv[0]}");
        }

        var normalized = argv.Skip(1).Select(arg => arg.Trim().ToLowerInvariant()).ToArray();
        if (normalized.Any(arg => BlockedCommandTokens.Contains(arg)))
        {
            return ToolValidation.Fail("run_command contains a blocked mutation, network, or package-management token.");
        }

        if (executable == "git")
        {
            var subcommand = normalized.FirstOrDefault(arg => !arg.StartsWith('-'));
            if (string.IsNullOrWhiteSpace(subcommand) || !AllowedGitSubcommands.Contains(subcommand))
            {
                return ToolValidation.Fail("run_command git usage is limited to status, diff, show, log, branch, rev-parse, and ls-files.");
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

    private static string ResolveWorkspaceDirectory(string workspace, string path)
    {
        var full = ResolveWorkspacePath(workspace, path);
        if (!Directory.Exists(full)) throw new InvalidOperationException("cwd does not exist or is not a directory.");
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

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static void AddRipgrepFilters(List<string> args, JsonObject callArgs)
    {
        AddGlob(args, GetString(callArgs, "glob"));
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

public sealed record AgentRunResult(string Status, IReadOnlyList<RunEvent> Events, PendingApproval? PendingApproval);

public sealed record RelayToolCall(string Id, string Tool, JsonObject Args);

public sealed record ToolObservation(string ToolCallId, string Tool, bool Success, string Summary, object? Data)
{
    public static ToolObservation Ok(string id, string tool, string summary, object? data) => new(id, tool, true, summary, data);
    public static ToolObservation Fail(string id, string tool, string summary) => new(id, tool, false, summary, null);
}

public sealed record ToolValidation(bool Ok, string? Error)
{
    public static ToolValidation Pass() => new(true, null);
    public static ToolValidation Fail(string error) => new(false, error);
}

public sealed record ProcessResult(bool Success, string Output);

public sealed record LineProcessResult(bool Success, IReadOnlyList<string> Lines, string Output, bool Truncated);

public sealed record PendingApproval(string ApprovalId, string RunId, RelayToolCall ToolCall, DateTimeOffset CreatedAt)
{
    public static PendingApproval FromToolCall(string runId, RelayToolCall toolCall) =>
        new($"approval-{RandomNumberGenerator.GetHexString(6).ToLowerInvariant()}", runId, toolCall, DateTimeOffset.UtcNow);
}

public sealed record RelayAgentPlan(string Action, string? Tool, JsonObject? Args, string? Answer)
{
    public static RelayAgentPlan Parse(string text)
    {
        var trimmed = ExtractJsonObject(text);
        var node = JsonNode.Parse(trimmed)?.AsObject() ?? throw new InvalidOperationException("Copilot did not return a JSON object.");
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
        if (start < 0) throw new InvalidOperationException("No JSON object found in Copilot response.");

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

        throw new InvalidOperationException("No complete JSON object found in Copilot response.");
    }
}
