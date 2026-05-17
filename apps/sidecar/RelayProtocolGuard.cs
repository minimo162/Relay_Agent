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

        if (toolName == "read" &&
            state.Intent is RelayLocalIntent.FileSearch or RelayLocalIntent.FileRead &&
            !IsReadTargetAdmissible(args, state) &&
            availableTools.Contains("grep"))
        {
            return RelayProtocolDecision.Replace(new RelayToolDirective(
                "grep",
                BuildReadAdmissionRecoveryGrep(args, state),
                "read_target_not_observed_or_existing"));
        }

        return RelayProtocolDecision.Allow();
    }

    private static bool IsReadTargetAdmissible(JsonObject args, RelayTurnState state)
    {
        var requested = GetString(args, "file_path") ?? GetString(args, "path");
        if (string.IsNullOrWhiteSpace(requested))
        {
            return true;
        }

        var normalizedRequested = NormalizePathForMatch(requested);
        if (!string.IsNullOrWhiteSpace(state.ExactFilePath) &&
            PathMatches(NormalizePathForMatch(state.ExactFilePath), normalizedRequested))
        {
            return true;
        }

        if (!string.IsNullOrWhiteSpace(state.Workspace))
        {
            try
            {
                var workspaceRoot = Path.GetFullPath(state.Workspace);
                var fullPath = Path.GetFullPath(Path.IsPathRooted(requested)
                    ? requested
                    : Path.Combine(workspaceRoot, requested));
                if (fullPath.StartsWith(workspaceRoot, StringComparison.OrdinalIgnoreCase) &&
                    File.Exists(fullPath))
                {
                    return true;
                }
            }
            catch
            {
                // Fall through to observed-path matching.
            }
        }

        foreach (var detail in state.CompletedToolDetails)
        {
            if (!detail.EndsWith(":success", StringComparison.Ordinal))
            {
                continue;
            }
            var firstColon = detail.IndexOf(':');
            var lastColon = detail.LastIndexOf(':');
            if (firstColon <= 0 || lastColon <= firstColon)
            {
                continue;
            }
            var observed = NormalizePathForMatch(detail[(firstColon + 1)..lastColon]);
            if (PathMatches(observed, normalizedRequested))
            {
                return true;
            }
        }

        return false;
    }

    private static JsonObject BuildReadAdmissionRecoveryGrep(JsonObject args, RelayTurnState state)
    {
        var requested = GetString(args, "file_path") ?? GetString(args, "path") ?? "";
        var source = $"{state.OriginalUserRequest}\n{requested}";
        var allTerms = new List<string>();
        var anyTerms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        if (Regex.IsMatch(source, @"(?:^|[^0-9])(?:4Q|Q4|4q|q4)(?:[^0-9]|$)", RegexOptions.CultureInvariant))
        {
            allTerms.Add("4Q");
        }
        var fyMatch = Regex.Match(source, @"FY\d{3}", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (fyMatch.Success)
        {
            allTerms.Add(fyMatch.Value.ToUpperInvariant());
        }

        AddIfRelevant(anyTerms, source, @"アフター|after|aftermarket", "アフター", "aftermarket", "after", "サービス", "補修", "部品", "パーツ", "parts", "service", "revenue", "sales", "売上");
        AddIfRelevant(anyTerms, source, @"部品|パーツ|parts|spare|service", "部品", "パーツ", "補修", "サービス", "parts", "service", "spare");
        AddIfRelevant(anyTerms, source, @"売上|sales|revenue", "売上", "sales", "revenue");
        if (anyTerms.Count == 0)
        {
            foreach (Match match in Regex.Matches(source, @"[\p{L}\p{N}]{2,}", RegexOptions.CultureInvariant))
            {
                anyTerms.Add(match.Value);
                if (anyTerms.Count >= 8) break;
            }
        }

        var node = new JsonObject
        {
            ["caseInsensitive"] = true,
            ["contextLines"] = 1,
            ["limit"] = 80,
        };
        if (allTerms.Count > 0)
        {
            node["allTerms"] = ToJsonArray(allTerms.Distinct(StringComparer.OrdinalIgnoreCase));
        }
        if (anyTerms.Count > 0)
        {
            node["anyTerms"] = ToJsonArray(anyTerms);
        }
        node["includeGlobs"] = ToJsonArray(["**/*.md", "**/*.txt", "**/*.csv"]);
        return node;
    }

    private static void AddIfRelevant(ISet<string> terms, string source, string pattern, params string[] values)
    {
        if (!Regex.IsMatch(source, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return;
        }
        foreach (var value in values)
        {
            terms.Add(value);
        }
    }

    private static JsonArray ToJsonArray(IEnumerable<string> values) =>
        new(values.Select(value => JsonValue.Create(value)).ToArray());

    private static string? GetString(JsonObject args, string key) =>
        args.TryGetPropertyValue(key, out var node) && node is not null
            ? node.GetValue<string?>()
            : null;

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
