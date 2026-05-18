using Microsoft.AspNetCore.Http;
using System.Text.Json;

public sealed record SidecarIdleExitOptions(
    bool Enabled,
    TimeSpan IdleExitAfter,
    TimeSpan StartupGrace,
    TimeSpan HeartbeatTtl)
{
    public static SidecarIdleExitOptions FromEnvironment()
    {
        var disabled = string.Equals(Environment.GetEnvironmentVariable("RELAY_DISABLE_IDLE_EXIT"), "1", StringComparison.Ordinal);
        var enabled = !disabled && string.Equals(Environment.GetEnvironmentVariable("RELAY_ENABLE_IDLE_EXIT"), "1", StringComparison.Ordinal);
        return new SidecarIdleExitOptions(
            Enabled: enabled,
            IdleExitAfter: ReadDuration("RELAY_IDLE_EXIT_MS", TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(30)),
            StartupGrace: ReadDuration("RELAY_IDLE_STARTUP_GRACE_MS", TimeSpan.FromMinutes(3), TimeSpan.Zero, TimeSpan.FromMinutes(30)),
            HeartbeatTtl: ReadDuration("RELAY_IDLE_HEARTBEAT_TTL_MS", TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(5), TimeSpan.FromMinutes(5)));
    }

    private static TimeSpan ReadDuration(string name, TimeSpan fallback, TimeSpan minimum, TimeSpan maximum)
    {
        if (!int.TryParse(Environment.GetEnvironmentVariable(name), out var milliseconds))
        {
            return fallback;
        }

        var bounded = Math.Clamp(milliseconds, (int)minimum.TotalMilliseconds, (int)maximum.TotalMilliseconds);
        return TimeSpan.FromMilliseconds(bounded);
    }
}

public sealed record WorkbenchSessionRequest(string? ClientId);

public sealed record WorkbenchSessionResponse(
    string SchemaVersion,
    bool IdleExitEnabled,
    string? ClientId,
    int ActiveClients,
    int ActiveRequests,
    int IdleExitAfterMs,
    int StartupGraceMs,
    int HeartbeatTtlMs);

public sealed class SidecarLifecycle : IAsyncDisposable
{
    private const string SchemaVersion = "RelaySidecarSessionStatus.v1";
    private readonly object _gate = new();
    private readonly Dictionary<string, DateTimeOffset> _clients = new(StringComparer.Ordinal);
    private readonly IHostApplicationLifetime _lifetime;
    private readonly SidecarIdleExitOptions _options;
    private readonly CancellationTokenSource _stop = new();
    private readonly DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
    private DateTimeOffset _lastRequestAt = DateTimeOffset.UtcNow;
    private int _activeRequests;
    private bool _stopRequested;
    private Task? _monitorTask;

    public SidecarLifecycle(IHostApplicationLifetime lifetime, SidecarIdleExitOptions options)
    {
        _lifetime = lifetime;
        _options = options;
    }

    public void Start()
    {
        if (!_options.Enabled) return;
        _monitorTask = Task.Run(MonitorAsync);
    }

    public IDisposable TrackRequest(PathString path)
    {
        if (!_options.Enabled || IsLifecyclePath(path))
        {
            return NoopDisposable.Instance;
        }

        lock (_gate)
        {
            _activeRequests += 1;
            _lastRequestAt = DateTimeOffset.UtcNow;
        }

        return new RequestLease(this);
    }

    public WorkbenchSessionResponse Heartbeat(string clientId)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_gate)
        {
            _clients[clientId] = now;
            _lastRequestAt = now;
            PruneStaleClients(now);
            return SnapshotLocked(clientId);
        }
    }

    public WorkbenchSessionResponse Close(string clientId)
    {
        var now = DateTimeOffset.UtcNow;
        lock (_gate)
        {
            _clients.Remove(clientId);
            _lastRequestAt = now;
            PruneStaleClients(now);
            return SnapshotLocked(clientId);
        }
    }

    public WorkbenchSessionResponse Status()
    {
        lock (_gate)
        {
            PruneStaleClients(DateTimeOffset.UtcNow);
            return SnapshotLocked(null);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        if (_monitorTask is not null)
        {
            try
            {
                await _monitorTask;
            }
            catch (OperationCanceledException)
            {
                // Expected during normal shutdown.
            }
        }
        _stop.Dispose();
    }

    private async Task MonitorAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(1), _stop.Token);
            if (!ShouldExit(DateTimeOffset.UtcNow)) continue;

            Console.WriteLine(JsonSerializer.Serialize(new
            {
                relay = "idle-exit",
                activeClients = 0,
                idleExitAfterMs = (int)_options.IdleExitAfter.TotalMilliseconds,
            }, JsonOptions.Compact));
            _lifetime.StopApplication();
            return;
        }
    }

    private bool ShouldExit(DateTimeOffset now)
    {
        lock (_gate)
        {
            if (_stopRequested) return false;
            if (now - _startedAt < _options.StartupGrace) return false;
            PruneStaleClients(now);
            if (_clients.Count > 0) return false;
            if (_activeRequests > 0) return false;
            if (now - _lastRequestAt < _options.IdleExitAfter) return false;
            _stopRequested = true;
            return true;
        }
    }

    private void FinishRequest()
    {
        lock (_gate)
        {
            _activeRequests = Math.Max(0, _activeRequests - 1);
            _lastRequestAt = DateTimeOffset.UtcNow;
        }
    }

    private void PruneStaleClients(DateTimeOffset now)
    {
        var stale = _clients
            .Where(pair => now - pair.Value > _options.HeartbeatTtl)
            .Select(pair => pair.Key)
            .ToArray();
        foreach (var clientId in stale)
        {
            _clients.Remove(clientId);
        }
    }

    private WorkbenchSessionResponse SnapshotLocked(string? clientId) =>
        new(
            SchemaVersion: SchemaVersion,
            IdleExitEnabled: _options.Enabled,
            ClientId: clientId,
            ActiveClients: _clients.Count,
            ActiveRequests: _activeRequests,
            IdleExitAfterMs: (int)_options.IdleExitAfter.TotalMilliseconds,
            StartupGraceMs: (int)_options.StartupGrace.TotalMilliseconds,
            HeartbeatTtlMs: (int)_options.HeartbeatTtl.TotalMilliseconds);

    private static bool IsLifecyclePath(PathString path) =>
        path.StartsWithSegments("/api/session", StringComparison.OrdinalIgnoreCase);

    private sealed class RequestLease(SidecarLifecycle owner) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                owner.FinishRequest();
            }
        }
    }

    private sealed class NoopDisposable : IDisposable
    {
        public static readonly NoopDisposable Instance = new();
        public void Dispose()
        {
        }
    }
}
