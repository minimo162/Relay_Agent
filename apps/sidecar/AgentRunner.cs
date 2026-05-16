using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class RelayAgentRunner(ICopilotTransport copilot, RelayToolExecutor tools)
{
    private const int MaxSteps = 6;
    private const string AllowedTools = "rg_files, rg_search, read, officecli, edit, write, workspace_status, diff, run_command, ask_user";

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

        for (var step = 1; step <= MaxSteps; step++)
        {
            await Emit(RunEvent.CopilotTurnStarted("Copilot が次の手順を選択しています", $"step {step}/{MaxSteps}"));
            var planText = await copilot.SendAsync(BuildStepPrompt(request, observations), cancellationToken);
            RelayAgentPlan plan;
            try
            {
                plan = RelayAgentPlan.Parse(planText);
                await Emit(RunEvent.CopilotTurnCompleted("Copilot の計画を受け取りました", plan.Action));
            }
            catch (Exception parseError)
            {
                await Emit(RunEvent.Status("Copilot のJSON形式を修復しています", parseError.Message));
                var repairText = await copilot.SendAsync(BuildPlanRepairPrompt(request, observations, planText, parseError.Message), cancellationToken);
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
            var validation = tools.Validate(request.Workspace, toolCall);
            if (!validation.Ok)
            {
                await Emit(RunEvent.Error("ツール引数を検証できません", validation.Error));
                return new AgentRunResult("failed", events, null);
            }

            if (tools.RequiresApproval(toolCall))
            {
                var approval = PendingApproval.FromToolCall(runId, toolCall);
                await Emit(RunEvent.Approval("実行前に確認してください", tools.Describe(toolCall)));
                return new AgentRunResult("approval_required", events, approval);
            }

            await Emit(RunEvent.ToolCallStarted(toolCall.Tool, tools.Describe(toolCall)));
            var observation = await tools.ExecuteAsync(request.Workspace, toolCall, cancellationToken);
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
        await Emit(RunEvent.ApprovalResolved("承認しました", tools.Describe(toolCall)));
        await Emit(RunEvent.ToolCallStarted("承認済みの操作を実行しています", tools.Describe(toolCall)));
        var observation = await tools.ExecuteAsync(run.Request.Workspace, toolCall, cancellationToken, approvalGranted: true);
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
        var final = await copilot.SendAsync(finalPrompt, cancellationToken);
        await Emit(RunEvent.Completed("完了しました", final));
        return new AgentRunResult("completed", events, null);
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
            "- Use read for exact files only.",
            "- Use officecli for Office inspection or mutation. Mutations require approval.",
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
            ? !string.Equals(GetString(call.Args, "operation") ?? "view", "view", StringComparison.OrdinalIgnoreCase)
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
            "officecli" => ValidateWorkspacePath(workspace, call.Args, mustExist: true, key: "filePath"),
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
            "officecli" => $"file={GetString(call.Args, "filePath")}, operation={GetString(call.Args, "operation") ?? GetString(call.Args, "command") ?? "inspect"}",
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
        var glob = GetString(call.Args, "glob");
        var limit = GetInt(call.Args, "limit") ?? 50;
        var args = new List<string> { "--files" };
        if (!string.IsNullOrWhiteSpace(glob)) args.AddRange(["-g", glob]);
        var result = await RunProcessAsync(rg.ExecutablePath, args, workspace, cancellationToken);
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        var lines = result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(line => string.IsNullOrWhiteSpace(contains) || line.Contains(contains, StringComparison.OrdinalIgnoreCase))
            .Take(Math.Clamp(limit, 1, 200))
            .ToArray();
        return ToolObservation.Ok(call.Id, call.Tool, $"{lines.Length} file candidates", lines);
    }

    private async Task<ToolObservation> RgSearchAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var rg = toolResolver.ResolveRipgrep();
        if (!rg.Available || string.IsNullOrWhiteSpace(rg.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, rg.Detail);
        }

        var pattern = GetString(call.Args, "pattern") ?? "";
        var glob = GetString(call.Args, "glob");
        var limit = GetInt(call.Args, "limit") ?? 80;
        var args = new List<string> { "--line-number", "--color", "never", "--fixed-strings" };
        if (!string.IsNullOrWhiteSpace(glob)) args.AddRange(["-g", glob]);
        args.AddRange(["--", pattern]);
        var result = await RunProcessAsync(rg.ExecutablePath, args, workspace, cancellationToken, allowExitOne: true);
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);
        var lines = result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(Math.Clamp(limit, 1, 200))
            .ToArray();
        return ToolObservation.Ok(call.Id, call.Tool, $"{lines.Length} content matches", lines);
    }

    private static async Task<ToolObservation> ReadAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var path = ResolveWorkspacePath(workspace, GetString(call.Args, "path") ?? "");
        var info = new FileInfo(path);
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
        var officeCli = toolResolver.ResolveOfficeCli();
        if (!officeCli.Available || string.IsNullOrWhiteSpace(officeCli.ExecutablePath))
        {
            return ToolObservation.Fail(call.Id, call.Tool, $"OfficeCLI is not available: {officeCli.Detail}");
        }

        var filePath = ResolveWorkspacePath(workspace, GetString(call.Args, "filePath") ?? "");
        var operation = GetString(call.Args, "operation") ?? "view";
        var command = GetString(call.Args, "command") ?? "outline";
        string? backupPath = null;
        if (!string.Equals(operation, "view", StringComparison.OrdinalIgnoreCase))
        {
            backupPath = await CreateBackupAsync(filePath, cancellationToken);
        }
        var args = operation == "view"
            ? new List<string> { "view", filePath, command, "--json" }
            : [operation, filePath, command, "--json"];
        var result = await RunProcessAsync(officeCli.ExecutablePath, args, workspace, cancellationToken);
        return result.Success
            ? ToolObservation.Ok(call.Id, call.Tool, backupPath is null ? "OfficeCLI completed" : $"OfficeCLI completed; backup={backupPath}", Truncate(result.Output, 12000))
            : ToolObservation.Fail(call.Id, call.Tool, result.Output);
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

    private static async Task<ProcessResult> RunProcessAsync(
        string fileName,
        IReadOnlyList<string> args,
        string workingDirectory,
        CancellationToken cancellationToken,
        bool allowExitOne = false)
    {
        return await RelayProcess.RunAsync(fileName, args, workingDirectory, cancellationToken, allowExitOne);
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
