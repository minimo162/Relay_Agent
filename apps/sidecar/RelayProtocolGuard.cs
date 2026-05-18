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
            if (!HasSuccessfulReadTarget(state, evidencePath) && !HasSuccessfulReadAfterGrep(state))
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
        }

        if (MentionsUnavailableLocalTool(proposedAnswer, availableTools))
        {
            RelayPreventionMetrics.RecordHiddenToolViolation("final_unavailable_tool_suggestion");
            return RelayProtocolDecision.Reject(
                "Copilot final answer recommended a local tool or retriever that is not in the visible Relay tool catalog.");
        }

        if (state.RequiresContinuationAfterEmptyFilenameDiscovery)
        {
            return RelayProtocolDecision.Reject(
                "Copilot returned action=final after a zero-candidate filename glob. Continue with a visible generic follow-up tool such as grep, broader glob, or read before finalizing.");
        }

        if (state.RequiresLocalToolBeforeFinal || !envelope.CanFinalize)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before required local tool execution. intent={state.Intent}; state={state.StateId}.");
        }

        return RelayProtocolDecision.Allow();
    }

    private static bool HasSuccessfulReadTarget(RelayTurnState state, string path)
    {
        var normalizedPath = NormalizePathForMatch(path);
        return state.CompletedToolDetails.Any(detail =>
        {
            if (!detail.StartsWith("read:", StringComparison.Ordinal) ||
                !detail.EndsWith(":success", StringComparison.Ordinal))
            {
                return false;
            }

            var normalizedDetail = NormalizePathForMatch(detail);
            if (normalizedDetail.Contains(normalizedPath, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return PathMatches(NormalizePathForMatch(detail["read:".Length..^":success".Length]), normalizedPath);
        });
    }

    private static bool HasSuccessfulReadAfterGrep(RelayTurnState state)
    {
        var sawSuccessfulGrep = false;
        foreach (var detail in state.CompletedToolDetails)
        {
            if (detail.StartsWith("grep:", StringComparison.Ordinal) && detail.EndsWith(":success", StringComparison.Ordinal))
            {
                sawSuccessfulGrep = true;
            }
            else if (sawSuccessfulGrep &&
                detail.StartsWith("read:", StringComparison.Ordinal) &&
                detail.EndsWith(":success", StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    private static bool MentionsUnavailableLocalTool(string? proposedAnswer, ISet<string> availableTools)
    {
        if (string.IsNullOrWhiteSpace(proposedAnswer)) return false;
        if (availableTools.Any(tool => tool.Contains("retriever", StringComparison.OrdinalIgnoreCase))) return false;

        var text = proposedAnswer.Trim();
        return Regex.IsMatch(
            text,
            @"\b[A-Za-z0-9_-]*retriever\b|vector\s+search|semantic\s+search|意味検索",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
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

            var valueEnd = detail.Length - ":success".Length;
            if (valueEnd <= "grep:".Length)
            {
                continue;
            }

            var value = detail["grep:".Length..valueEnd];
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
        if (path.Contains(' ', StringComparison.Ordinal))
        {
            var compactPath = Regex.Matches(
                    path,
                    @"[^\s""'`,;:。、「」]+?\.(?:md|txt|csv|json|html|css|js|ts|tsx|jsx|py|rs|cs|xlsx|xlsm|xls|docx|pptx|pdf)",
                    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                .Select(candidate => candidate.Value.Trim(' ', '。', '、', ',', ';', ':', '"', '\'', '`'))
                .LastOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate));
            if (!string.IsNullOrWhiteSpace(compactPath))
            {
                path = compactPath;
            }
        }
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

    private static bool PathMatches(string observed, string requested) =>
        string.Equals(observed, requested, StringComparison.OrdinalIgnoreCase) ||
        observed.EndsWith("/" + requested, StringComparison.OrdinalIgnoreCase) ||
        requested.EndsWith("/" + observed, StringComparison.OrdinalIgnoreCase);

    private static string NormalizePathForMatch(string path) =>
        path.Trim()
            .Trim('"', '\'', '`')
            .Replace('\\', '/')
            .TrimStart('/')
            .TrimEnd('/');
}
