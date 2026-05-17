using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

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
        RelayAdmissibleActionEnvelope envelope,
        string? proposedAnswer = null)
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

        if (state.RequiresReadEvidenceBeforeFinal &&
            availableTools.Contains("read") &&
            TryFindEvidenceReadPath(proposedAnswer, state, out var evidencePath))
        {
            return RelayProtocolDecision.Replace(new RelayToolDirective(
                "read",
                new JsonObject
                {
                    ["file_path"] = evidencePath,
                    ["limit"] = 12000,
                },
                "evidence_read_before_final"));
        }

        if (state.RequiresLocalToolBeforeFinal || !envelope.CanFinalize)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before required local tool execution. intent={state.Intent}; state={state.StateId}.");
        }

        return RelayProtocolDecision.Allow();
    }

    private static bool TryFindEvidenceReadPath(string? proposedAnswer, RelayTurnState state, out string path)
    {
        path = "";
        if (TryExtractPath(proposedAnswer, out path))
        {
            return true;
        }

        foreach (var detail in state.CompletedToolDetails)
        {
            if (!detail.StartsWith("grep:", StringComparison.Ordinal) ||
                !detail.EndsWith(":success", StringComparison.Ordinal))
            {
                continue;
            }

            var value = detail["grep:".Length..^":success".Length];
            if (TryExtractPath(value, out path))
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryExtractPath(string? text, out string path)
    {
        path = "";
        if (string.IsNullOrWhiteSpace(text)) return false;
        var match = Regex.Match(
            text,
            @"(?<path>(?:[A-Za-z]:)?[\p{L}\p{N}._/\-\\()[\]（）【】 ]+?\.(?:md|txt|csv|json|html|css|js|ts|tsx|jsx|py|rs|cs|xlsx|xlsm|xls|docx|pptx|pdf))",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success) return false;
        path = match.Groups["path"].Value.Trim(' ', '。', '、', ',', ';', ':', '"', '\'', '`');
        return !string.IsNullOrWhiteSpace(path);
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
