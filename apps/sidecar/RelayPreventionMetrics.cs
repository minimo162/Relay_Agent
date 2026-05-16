using System.Text.Json.Nodes;
using System.Threading;

public sealed record RelayPreventionMetricsSnapshot(
    long GuardRepairs,
    long ProtocolRejections,
    long HiddenToolViolations,
    long InvalidFinalAttempts,
    long InvalidAskUserAttempts)
{
    public JsonObject ToJson()
    {
        return new JsonObject
        {
            ["schemaVersion"] = "RelayPreventionMetrics.v1",
            ["guardRepairs"] = GuardRepairs,
            ["protocolRejections"] = ProtocolRejections,
            ["hiddenToolViolations"] = HiddenToolViolations,
            ["invalidFinalAttempts"] = InvalidFinalAttempts,
            ["invalidAskUserAttempts"] = InvalidAskUserAttempts,
        };
    }
}

public static class RelayPreventionMetrics
{
    private static long guardRepairs;
    private static long protocolRejections;
    private static long hiddenToolViolations;
    private static long invalidFinalAttempts;
    private static long invalidAskUserAttempts;

    public static void RecordGuardRepair(string _)
    {
        Interlocked.Increment(ref guardRepairs);
    }

    public static void RecordProtocolRejection(string _)
    {
        Interlocked.Increment(ref protocolRejections);
    }

    public static void RecordHiddenToolViolation(string _)
    {
        Interlocked.Increment(ref hiddenToolViolations);
    }

    public static void RecordInvalidFinalAttempt(string _)
    {
        Interlocked.Increment(ref invalidFinalAttempts);
    }

    public static void RecordInvalidAskUserAttempt(string _)
    {
        Interlocked.Increment(ref invalidAskUserAttempts);
    }

    public static RelayPreventionMetricsSnapshot Snapshot() =>
        new(
            Interlocked.Read(ref guardRepairs),
            Interlocked.Read(ref protocolRejections),
            Interlocked.Read(ref hiddenToolViolations),
            Interlocked.Read(ref invalidFinalAttempts),
            Interlocked.Read(ref invalidAskUserAttempts));
}

