using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

public sealed class RelayAgentRunner(ICopilotTransport copilot, RelayToolExecutor tools)
{
    private const int MaxSteps = 6;

    public async Task<AgentRunResult> RunAsync(RunRequest request, string runId, CancellationToken cancellationToken)
    {
        var events = new List<RunEvent>();
        var observations = new List<ToolObservation>();

        for (var step = 1; step <= MaxSteps; step++)
        {
            events.Add(RunEvent.Status("Copilot が次の手順を選択しています", $"step {step}/{MaxSteps}"));
            var planText = await copilot.SendAsync(BuildStepPrompt(request, observations), cancellationToken);
            var plan = RelayAgentPlan.Parse(planText);

            if (plan.Action == "final")
            {
                events.Add(RunEvent.Final("完了しました", plan.Answer ?? ""));
                return new AgentRunResult("completed", events, null);
            }

            if (plan.Action != "tool" || string.IsNullOrWhiteSpace(plan.Tool))
            {
                events.Add(RunEvent.Error("Copilot の計画を検証できません", "action は final または tool である必要があります。"));
                return new AgentRunResult("failed", events, null);
            }

            var toolCall = new RelayToolCall($"tool-{step:00}", plan.Tool, plan.Args ?? new JsonObject());
            var validation = tools.Validate(request.Workspace, toolCall);
            if (!validation.Ok)
            {
                events.Add(RunEvent.Error("ツール引数を検証できません", validation.Error));
                return new AgentRunResult("failed", events, null);
            }

            if (tools.RequiresApproval(toolCall))
            {
                var approval = PendingApproval.FromToolCall(runId, toolCall);
                events.Add(RunEvent.Approval("実行前に確認してください", tools.Describe(toolCall)));
                return new AgentRunResult("approval_required", events, approval);
            }

            events.Add(RunEvent.Tool(toolCall.Tool, tools.Describe(toolCall)));
            var observation = await tools.ExecuteAsync(request.Workspace, toolCall, cancellationToken);
            observations.Add(observation);
            events.Add(observation.Success
                ? RunEvent.Tool($"{toolCall.Tool} completed", observation.Summary)
                : RunEvent.Error($"{toolCall.Tool} failed", observation.Summary));

            if (!observation.Success)
            {
                return new AgentRunResult("failed", events, null);
            }
        }

        events.Add(RunEvent.Error("手順上限に達しました", $"最大 {MaxSteps} step で停止しました。"));
        return new AgentRunResult("failed", events, null);
    }

    public async Task<AgentRunResult> ApproveAsync(RunRecord run, CancellationToken cancellationToken)
    {
        if (run.PendingApproval is null)
        {
            return new AgentRunResult("failed", [RunEvent.Error("承認待ちではありません", "実行できる保留中の操作がありません。")], null);
        }

        var toolCall = run.PendingApproval.ToolCall;
        var events = new List<RunEvent>
        {
            RunEvent.Status("承認済みの操作を実行しています", tools.Describe(toolCall)),
        };
        var observation = await tools.ExecuteAsync(run.Request.Workspace, toolCall, cancellationToken, approvalGranted: true);
        events.Add(observation.Success
            ? RunEvent.Tool($"{toolCall.Tool} completed", observation.Summary)
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
        events.Add(RunEvent.Final("完了しました", final));
        return new AgentRunResult("completed", events, null);
    }

    private static string BuildStepPrompt(RunRequest request, IReadOnlyList<ToolObservation> observations) =>
        string.Join("\n", [
            "RELAY AGENT STEP PLANNER",
            "Mode: choose exactly one next action for Relay.",
            "Return exactly one JSON object and nothing else.",
            """Schema for final: {"action":"final","answer":"Japanese answer"}""",
            """Schema for tool: {"action":"tool","tool":"rg_files|rg_search|read|officecli|edit|write|ask_user","args":{}}""",
            "Rules:",
            "- Relay executes tools locally. You do not execute or claim execution.",
            "- Use rg_files or rg_search before read unless the exact file path is already known.",
            "- Use read for exact files only.",
            "- Use officecli for Office inspection or mutation. Mutations require approval.",
            "- Use edit/write only for workspace-scoped file changes. They require approval.",
            "- If enough observations exist, return final.",
            "- Never request shell/bash/powershell.",
            $"WORKSPACE: {request.Workspace}",
            "USER REQUEST:",
            request.Instruction,
            "OBSERVATIONS JSON:",
            JsonSerializer.Serialize(observations, JsonOptions.Default),
            "Return the next JSON object now.",
        ]);
}

public sealed class RelayToolExecutor(string dataDirectory)
{
    private static readonly HashSet<string> ReadTools = ["rg_files", "rg_search", "read", "ask_user"];
    private static readonly HashSet<string> WriteTools = ["officecli", "edit", "write"];

    public bool RequiresApproval(RelayToolCall call) =>
        call.Tool == "officecli"
            ? !string.Equals(GetString(call.Args, "operation") ?? "view", "view", StringComparison.OrdinalIgnoreCase)
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
                "ask_user" => ToolObservation.Ok(call.Id, call.Tool, GetString(call.Args, "question") ?? "追加情報が必要です。", null),
                _ => ToolObservation.Fail(call.Id, call.Tool, $"Unknown tool: {call.Tool}"),
            };
        }
        catch (Exception ex)
        {
            return ToolObservation.Fail(call.Id, call.Tool, ex.Message);
        }
    }

    private static async Task<ToolObservation> RgFilesAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var contains = GetString(call.Args, "contains");
        var glob = GetString(call.Args, "glob");
        var limit = GetInt(call.Args, "limit") ?? 50;
        var args = new List<string> { "--files" };
        if (!string.IsNullOrWhiteSpace(glob)) args.AddRange(["-g", glob]);
        var result = await RunProcessAsync("rg", args, workspace, cancellationToken);
        if (!result.Success) return ToolObservation.Fail(call.Id, call.Tool, result.Output);

        var lines = result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(line => string.IsNullOrWhiteSpace(contains) || line.Contains(contains, StringComparison.OrdinalIgnoreCase))
            .Take(Math.Clamp(limit, 1, 200))
            .ToArray();
        return ToolObservation.Ok(call.Id, call.Tool, $"{lines.Length} file candidates", lines);
    }

    private static async Task<ToolObservation> RgSearchAsync(string workspace, RelayToolCall call, CancellationToken cancellationToken)
    {
        var pattern = GetString(call.Args, "pattern") ?? "";
        var glob = GetString(call.Args, "glob");
        var limit = GetInt(call.Args, "limit") ?? 80;
        var args = new List<string> { "--line-number", "--color", "never", "--fixed-strings", pattern };
        if (!string.IsNullOrWhiteSpace(glob)) args.InsertRange(0, ["-g", glob]);
        var result = await RunProcessAsync("rg", args, workspace, cancellationToken, allowExitOne: true);
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
        var result = await RunProcessAsync("officecli", args, workspace, cancellationToken);
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

    private static string? GetString(JsonObject args, string key) =>
        args.TryGetPropertyValue(key, out var value) ? value?.GetValue<string>() : null;

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
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = fileName,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);
        process.Start();
        var stdout = await process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = await process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var success = process.ExitCode == 0 || (allowExitOne && process.ExitCode == 1);
        return new ProcessResult(success, string.Join("\n", [stdout, stderr]).Trim());
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
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start) throw new InvalidOperationException("No JSON object found in Copilot response.");
        return text[start..(end + 1)];
    }
}
