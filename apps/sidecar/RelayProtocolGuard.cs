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
    public static RelayProtocolDecision ValidateFinal(RelayTurnState state, ISet<string> availableTools)
    {
        if (state.RequiresMutationBeforeFinal)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before a required mutation tool succeeded for {state.PendingOutputFile}.");
        }

        if (RelayInitialToolPolicy.TryCreateInitialToolCall(state, availableTools, out var directive))
        {
            return RelayProtocolDecision.Replace(directive);
        }

        if (state.RequiresLocalToolBeforeFinal)
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
        ISet<string> availableTools)
    {
        if (toolName == "ask_user" &&
            !state.CanAskUser &&
            RelayInitialToolPolicy.TryCreateInitialToolCall(state, availableTools, out var directive))
        {
            return RelayProtocolDecision.Replace(directive);
        }

        if (toolName == "ask_user" && !state.CanAskUser)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot requested ask_user even though the objective and workspace are known. intent={state.Intent}; state={state.StateId}.");
        }

        if (!availableTools.Contains(toolName))
        {
            return RelayProtocolDecision.Reject($"Copilot requested an unavailable tool: {toolName}");
        }

        return RelayProtocolDecision.Allow();
    }
}
