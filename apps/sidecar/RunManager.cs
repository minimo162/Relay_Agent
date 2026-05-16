using System.Collections.Concurrent;
using System.Threading.Channels;

public sealed class RunManager(
    RunLedger ledger,
    ToolReadiness tools,
    RelayAgentFrameworkRunner agentRunner) : IDisposable
{
    private readonly ConcurrentDictionary<string, ActiveRun> _activeRuns = new();

    public async Task<RunRecord> StartAsync(RunRequest request, CancellationToken cancellationToken)
    {
        var run = RunRecord.Start(request);
        var state = new ActiveRun(run);
        if (!_activeRuns.TryAdd(run.RunId, state))
        {
            throw new InvalidOperationException($"Run id collision: {run.RunId}");
        }

        await AppendEventAsync(state, RunEvent.Status("受け付けました", "Relay がタスクを開始しました。"), cancellationToken);
        _ = Task.Run(() => ExecuteRunAsync(state), CancellationToken.None);
        return state.Snapshot();
    }

    public async Task<RunRecord?> GetAsync(string runId, CancellationToken cancellationToken)
    {
        if (_activeRuns.TryGetValue(runId, out var state))
        {
            return state.Snapshot();
        }
        return await ledger.LoadAsync(runId, cancellationToken);
    }

    public async Task<RunSubscription?> SubscribeAsync(string runId, CancellationToken cancellationToken)
    {
        if (_activeRuns.TryGetValue(runId, out var state))
        {
            return state.Subscribe();
        }

        var run = await ledger.LoadAsync(runId, cancellationToken);
        return run is null ? null : new RunSubscription(run, null, null);
    }

    public async Task<RunRecord?> ApproveAsync(string runId, CancellationToken cancellationToken)
    {
        if (_activeRuns.ContainsKey(runId))
        {
            return null;
        }

        var run = await ledger.LoadAsync(runId, cancellationToken);
        if (run is null || run.PendingApproval is null)
        {
            return run;
        }

        var state = new ActiveRun(run with
        {
            Status = "running",
            PendingApproval = run.PendingApproval,
            AgentSessionState = run.AgentSessionState,
            CompletedAt = null,
        });
        if (!_activeRuns.TryAdd(run.RunId, state))
        {
            return state.Snapshot();
        }

        await AppendEventAsync(state, RunEvent.Status("承認しました", "Relay が保留中の操作を実行します。"), cancellationToken);
        _ = Task.Run(() => ExecuteApprovalAsync(state), CancellationToken.None);
        return state.Snapshot();
    }

    public async Task<RunRecord?> RejectAsync(string runId, CancellationToken cancellationToken)
    {
        if (_activeRuns.TryGetValue(runId, out var active))
        {
            active.Cancel();
            return active.Snapshot();
        }

        var run = await ledger.LoadAsync(runId, cancellationToken);
        if (run is null) return null;
        if (run.PendingApproval is null) return run;

        var state = new ActiveRun(run);
        await AppendEventAsync(state, RunEvent.Status("実行しませんでした", "承認が取り消されました。"), cancellationToken);
        await CompleteAsync(state, "cancelled", null, null, CancellationToken.None, removeActive: false);
        return state.Snapshot();
    }

    public async Task<RunRecord?> CancelAsync(string runId, CancellationToken cancellationToken)
    {
        if (!_activeRuns.TryGetValue(runId, out var state))
        {
            return await ledger.LoadAsync(runId, cancellationToken);
        }

        await AppendEventAsync(state, RunEvent.Status("停止しています", "実行中の処理にキャンセルを送信しました。"), cancellationToken);
        state.Cancel();
        return state.Snapshot();
    }

    public void Dispose()
    {
        foreach (var state in _activeRuns.Values)
        {
            state.Cancel();
            state.CompleteSubscribers();
            state.Dispose();
        }
    }

    private async Task ExecuteRunAsync(ActiveRun state)
    {
        try
        {
            var request = state.Snapshot().Request;
            if (string.IsNullOrWhiteSpace(request.Instruction))
            {
                await AppendEventAsync(state, RunEvent.Error("指示が空です", "自然言語のタスクを入力してください。"), CancellationToken.None);
                await CompleteAsync(state, "failed", null, null, CancellationToken.None);
                return;
            }

            if (string.IsNullOrWhiteSpace(request.Workspace) || !Directory.Exists(request.Workspace))
            {
                await AppendEventAsync(state, RunEvent.Error("Workspace を確認できません", "存在するローカルフォルダを指定してください。"), CancellationToken.None);
                await CompleteAsync(state, "failed", null, null, CancellationToken.None);
                return;
            }

            await AppendEventAsync(state, RunEvent.Status(
                "準備状態を確認しています",
                "Copilot、ripgrep、workspace access を確認しています。OfficeCLI は Office 操作時だけ必要です。"), state.CancellationToken);

            var checks = await tools.CheckAllAsync(state.CancellationToken);
            foreach (var check in checks)
            {
                var requiredLabel = check.Required ? "required" : "optional";
                await AppendEventAsync(state, RunEvent.ToolCallCompleted(check.Name, check.Ready ? $"ready ({requiredLabel})" : $"{check.Detail} ({requiredLabel})"), state.CancellationToken);
            }

            var requiredFailures = checks.Where(check => check.Required && !check.Ready).ToArray();
            if (requiredFailures.Length > 0)
            {
                await AppendEventAsync(state, RunEvent.Error(
                    "必須ツールが未準備です",
                    string.Join("\n", requiredFailures.Select(check => $"{check.Name}: {check.Detail}"))), CancellationToken.None);
                await CompleteAsync(state, "failed", null, null, CancellationToken.None);
                return;
            }

            await AppendEventAsync(state, RunEvent.Status(
                "Copilot に計画を依頼します",
                "Relay はツール実行だけを担当し、Copilot の判断結果を検証します。"), state.CancellationToken);

            var result = await agentRunner.RunAsync(
                request,
                state.Snapshot().RunId,
                async (runEvent, token) => await AppendEventAsync(state, runEvent, token),
                state.CancellationToken);
            await CompleteAsync(state, result.Status, result.PendingApproval, result.AgentSessionState, CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            await AppendEventAsync(state, RunEvent.Status("停止しました", "ユーザー操作により実行を停止しました。"), CancellationToken.None);
            await CompleteAsync(state, "cancelled", null, null, CancellationToken.None);
        }
        catch (Exception ex)
        {
            await AppendEventAsync(state, RunEvent.Error("Copilot transport failed", ex.Message), CancellationToken.None);
            await CompleteAsync(state, "failed", null, null, CancellationToken.None);
        }
    }

    private async Task ExecuteApprovalAsync(ActiveRun state)
    {
        try
        {
            var result = await agentRunner.ApproveAsync(
                state.Snapshot(),
                async (runEvent, token) => await AppendEventAsync(state, runEvent, token),
                state.CancellationToken);
            await CompleteAsync(state, result.Status, result.PendingApproval, result.AgentSessionState, CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            await AppendEventAsync(state, RunEvent.Status("停止しました", "ユーザー操作により実行を停止しました。"), CancellationToken.None);
            await CompleteAsync(state, "cancelled", null, null, CancellationToken.None);
        }
        catch (Exception ex)
        {
            await AppendEventAsync(state, RunEvent.Error("承認後の実行に失敗しました", ex.Message), CancellationToken.None);
            await CompleteAsync(state, "failed", null, null, CancellationToken.None);
        }
    }

    private async ValueTask AppendEventAsync(ActiveRun state, RunEvent runEvent, CancellationToken cancellationToken)
    {
        Channel<RunEvent>[] subscribers;
        RunRecord run;
        lock (state.Gate)
        {
            var enveloped = runEvent with
            {
                RunId = state.Run.RunId,
                Sequence = state.Run.Events.Count + 1,
                Timestamp = DateTimeOffset.UtcNow,
            };
            state.Run = state.Run with
            {
                Events = state.Run.Events.Concat([enveloped]).ToArray(),
            };
            subscribers = state.Subscribers.ToArray();
            run = state.Run;
        }

        await ledger.AppendAsync(run, cancellationToken);
        foreach (var subscriber in subscribers)
        {
            subscriber.Writer.TryWrite(run.Events[^1]);
        }
    }

    private async Task CompleteAsync(
        ActiveRun state,
        string status,
        PendingApproval? pendingApproval,
        System.Text.Json.JsonElement? agentSessionState,
        CancellationToken cancellationToken,
        bool removeActive = true)
    {
        RunRecord run;
        lock (state.Gate)
        {
            state.Run = state.Run with
            {
                Status = status,
                CompletedAt = status is "completed" or "failed" or "cancelled" ? DateTimeOffset.UtcNow : null,
                PendingApproval = pendingApproval,
                AgentSessionState = status is "approval_required" ? agentSessionState : null,
            };
            run = state.Run;
        }

        await ledger.AppendAsync(run, cancellationToken);
        state.CompleteSubscribers();
        if (removeActive)
        {
            _activeRuns.TryRemove(run.RunId, out _);
        }
        state.Dispose();
    }
}

public sealed record RunSubscription(RunRecord Snapshot, ChannelReader<RunEvent>? LiveEvents, IDisposable? Lease);

internal sealed class ActiveRun(RunRecord run) : IDisposable
{
    public object Gate { get; } = new();
    public CancellationTokenSource CancellationTokenSource { get; } = new();
    public CancellationToken CancellationToken => CancellationTokenSource.Token;
    public List<Channel<RunEvent>> Subscribers { get; } = [];
    public RunRecord Run { get; set; } = run;

    public RunRecord Snapshot()
    {
        lock (Gate)
        {
            return Run;
        }
    }

    public RunSubscription Subscribe()
    {
        lock (Gate)
        {
            if (Run.Status is not "running")
            {
                return new RunSubscription(Run, null, null);
            }

            var channel = Channel.CreateUnbounded<RunEvent>();
            Subscribers.Add(channel);
            return new RunSubscription(Run, channel.Reader, new SubscriberLease(this, channel));
        }
    }

    public void Cancel() => CancellationTokenSource.Cancel();

    public void Dispose() => CancellationTokenSource.Dispose();

    public void CompleteSubscribers()
    {
        Channel<RunEvent>[] subscribers;
        lock (Gate)
        {
            subscribers = Subscribers.ToArray();
            Subscribers.Clear();
        }

        foreach (var subscriber in subscribers)
        {
            subscriber.Writer.TryComplete();
        }
    }

    private sealed class SubscriberLease(ActiveRun run, Channel<RunEvent> channel) : IDisposable
    {
        public void Dispose()
        {
            lock (run.Gate)
            {
                run.Subscribers.Remove(channel);
            }
            channel.Writer.TryComplete();
        }
    }
}
