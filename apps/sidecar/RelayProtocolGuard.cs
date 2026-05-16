using System.Text.Json.Nodes;

public enum RelayProtocolDecisionKind
{
    Allow,
    ReplaceWithTool,
    Reject,
}

public sealed record RelayProtocolDecision(
    RelayProtocolDecisionKind Kind,
    RelayToolDirective? ToolDirective = null,
    string? Error = null)
{
    public static RelayProtocolDecision Allow() => new(RelayProtocolDecisionKind.Allow);
    public static RelayProtocolDecision Replace(RelayToolDirective directive) => new(RelayProtocolDecisionKind.ReplaceWithTool, directive);
    public static RelayProtocolDecision Reject(string error) => new(RelayProtocolDecisionKind.Reject, Error: error);
}

public static class RelayProtocolGuard
{
    public static RelayProtocolDecision ValidateFinal(
        RelayTurnState state,
        ISet<string> availableTools,
        RelayAdmissibleActionEnvelope envelope)
    {
        if (!envelope.CanFinalize)
        {
            RelayPreventionMetrics.RecordInvalidFinalAttempt(envelope.Phase.ToString());
        }

        if (state.RequiresMutationBeforeFinal)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before a required mutation tool succeeded for {state.PendingOutputFile}.");
        }

        if (RelayInitialToolPolicy.TryCreateInitialToolCall(state, envelope.VisibleTools.ToHashSet(StringComparer.Ordinal), out var directive))
        {
            return RelayProtocolDecision.Replace(directive);
        }

        if (state.RequiresLocalToolBeforeFinal || !envelope.CanFinalize)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before required local tool execution. intent={state.Intent}; state={state.StateId}.");
        }

        return RelayProtocolDecision.Allow();
    }

    public static RelayProtocolDecision ValidateTool(
        string toolName,
        JsonObject args,
        RelayTurnState state,
        ISet<string> availableTools,
        RelayAdmissibleActionEnvelope envelope)
    {
        if (!availableTools.Contains(toolName))
        {
            return RelayProtocolDecision.Reject($"Copilot requested an unavailable tool: {toolName}");
        }

        if (!envelope.AllowsTool(toolName))
        {
            RelayPreventionMetrics.RecordHiddenToolViolation(toolName);
            if (toolName == "ask_user")
            {
                RelayPreventionMetrics.RecordInvalidAskUserAttempt(state.StateId);
                if (RelayInitialToolPolicy.TryCreateInitialToolCall(state, envelope.VisibleTools.ToHashSet(StringComparer.Ordinal), out var directive))
                {
                    return RelayProtocolDecision.Replace(directive);
                }
            }

            return RelayProtocolDecision.Reject(
                $"Copilot requested tool '{toolName}' outside the admissible action envelope. phase={envelope.Phase}; state={state.StateId}.");
        }

        if (toolName == "ask_user" && !state.CanAskUser)
        {
            RelayPreventionMetrics.RecordInvalidAskUserAttempt(state.StateId);
            return RelayProtocolDecision.Reject(
                $"Copilot requested ask_user even though the objective and workspace are known. intent={state.Intent}; state={state.StateId}.");
        }

        return RelayProtocolDecision.Allow();
    }
}
