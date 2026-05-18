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

        if (ShouldRequireGrepRefinementBeforeFinal(state) && availableTools.Contains("grep"))
        {
            return RelayProtocolDecision.Replace(new RelayToolDirective(
                "grep",
                BuildReadAdmissionRecoveryGrep(new JsonObject(), state),
                "grep_refinement_before_final"));
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

        if (availableTools.Contains("read") &&
            ShouldRequireCitedEvidenceReadBeforeFinal(state) &&
            TryExtractPath(proposedAnswer, out var citedEvidencePath) &&
            !HasSuccessfulReadTarget(state, citedEvidencePath) &&
            !HasSuccessfulReadAfterGrep(state))
        {
            return RelayProtocolDecision.Replace(new RelayToolDirective(
                "read",
                new JsonObject
                {
                    ["file_path"] = citedEvidencePath,
                    ["limit"] = 12000,
                },
                    "cited_evidence_read_before_final"));
        }

        if (MentionsUnavailableLocalTool(proposedAnswer, availableTools))
        {
            RelayPreventionMetrics.RecordHiddenToolViolation("final_unavailable_tool_suggestion");
            return RelayProtocolDecision.Reject(
                "Copilot final answer recommended a local tool or retriever that is not in the visible Relay tool catalog.");
        }

        if (state.RequiresLocalToolBeforeFinal || !envelope.CanFinalize)
        {
            return RelayProtocolDecision.Reject(
                $"Copilot returned action=final before required local tool execution. intent={state.Intent}; state={state.StateId}.");
        }

        return RelayProtocolDecision.Allow();
    }

    private static bool ShouldRequireGrepRefinementBeforeFinal(RelayTurnState state)
    {
        if (!state.HasReadToolResult ||
            state.HasGrepToolResult ||
            !string.IsNullOrWhiteSpace(state.PendingOutputFile))
        {
            return false;
        }

        if (ContainsAny(
            state.OriginalUserRequest,
            "再検索", "言い換え", "用語", "曖昧", "refine", "synonym", "試行錯誤", "候補", "除外"))
        {
            return true;
        }

        return state.CompletedToolDetails.Any(detail =>
            detail.StartsWith("read:", StringComparison.Ordinal) &&
            ContainsAny(
                detail,
                "guide", "glossary", "用語", "辞書", "archive", "prior", "過年度", "参考",
                "generic", "一般", "no-evidence", "no_evidence", "該当なし", "対象外", "negative"));
    }

    private static bool ShouldRequireCitedEvidenceReadBeforeFinal(RelayTurnState state) =>
        string.IsNullOrWhiteSpace(state.PendingOutputFile) &&
        ContainsAny(
            state.OriginalUserRequest,
            "探", "検索", "根拠", "証拠", "確認", "find", "search", "evidence", "source");

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

    private static bool ContainsAny(string text, params string[] needles) =>
        needles.Any(needle => text.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);

    private static bool MentionsUnavailableLocalTool(string? proposedAnswer, ISet<string> availableTools)
    {
        if (string.IsNullOrWhiteSpace(proposedAnswer)) return false;
        if (availableTools.Any(tool => tool.Contains("retriever", StringComparison.OrdinalIgnoreCase))) return false;

        var text = proposedAnswer.Trim();
        return Regex.IsMatch(
            text,
            @"\b[A-Za-z0-9_-]*retriever\b|biling_retriever|vector\s+search|semantic\s+search|意味検索",
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

        if (toolName == "grep" && ShouldWidenGuideScopedGrep(args, state))
        {
            return RelayProtocolDecision.Replace(new RelayToolDirective(
                "grep",
                BuildWorkspaceWideGrep(args),
                "guide_scoped_grep_widened"));
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

    private static bool ShouldWidenGuideScopedGrep(JsonObject args, RelayTurnState state)
    {
        var requestedPath = GetString(args, "path");
        if (string.IsNullOrWhiteSpace(requestedPath)) return false;
        var normalizedRequested = NormalizePathForMatch(requestedPath);
        if (string.IsNullOrWhiteSpace(normalizedRequested) || normalizedRequested is "." or "/") return false;

        foreach (var detail in state.CompletedToolDetails)
        {
            if (!detail.StartsWith("read:", StringComparison.Ordinal) ||
                !detail.EndsWith(":success", StringComparison.Ordinal) ||
                !ContainsAny(detail, "guide", "glossary", "用語", "辞書"))
            {
                continue;
            }

            var target = NormalizePathForMatch(detail["read:".Length..^":success".Length]);
            if (target.StartsWith(normalizedRequested.TrimEnd('/') + "/", StringComparison.OrdinalIgnoreCase) ||
                target.Equals(normalizedRequested, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static JsonObject BuildWorkspaceWideGrep(JsonObject args)
    {
        var widened = new JsonObject();
        foreach (var item in args)
        {
            if (item.Key.Equals("path", StringComparison.OrdinalIgnoreCase)) continue;
            widened[item.Key] = item.Value?.DeepClone();
        }
        if (!widened.ContainsKey("contextLines")) widened["contextLines"] = 1;
        if (!widened.ContainsKey("contextWindowLines")) widened["contextWindowLines"] = 2;
        if (!widened.ContainsKey("limit")) widened["limit"] = 100;
        return widened;
    }

    private static JsonObject BuildReadAdmissionRecoveryGrep(JsonObject args, RelayTurnState state)
    {
        var requested = GetString(args, "file_path") ?? GetString(args, "path") ?? "";
        var source = $"{state.OriginalUserRequest}\n{requested}\n{string.Join('\n', state.CompletedToolDetails)}";
        var allTerms = new List<string>();
        var anyTerms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match match in Regex.Matches(source, @"(?:^|[^0-9])(?:(?<n>[1-4])Q|Q(?<n>[1-4]))(?:[^0-9]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            var quarter = match.Groups["n"].Value;
            if (!string.IsNullOrWhiteSpace(quarter))
            {
                allTerms.Add($"{quarter}Q");
            }
        }
        foreach (Match match in Regex.Matches(source, @"FY\d{2,4}", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            allTerms.Add(match.Value.ToUpperInvariant());
        }

        foreach (var term in ExtractRecoveryTerms(source))
        {
            if (!allTerms.Contains(term, StringComparer.OrdinalIgnoreCase))
            {
                anyTerms.Add(term);
            }
            if (anyTerms.Count >= 12) break;
        }
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
            ["contextWindowLines"] = 2,
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
        node["includeGlobs"] = ToJsonArray(["**/*.md", "**/*.txt", "**/*.csv", "**/*.json", "**/*.html"]);
        return node;
    }

    private static IEnumerable<string> ExtractRecoveryTerms(string source)
    {
        var terms = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in Regex.Matches(source, @"[A-Za-z][A-Za-z0-9_-]{1,}", RegexOptions.CultureInvariant))
        {
            foreach (var part in Regex.Split(match.Value, @"[_\-.]+"))
            {
                AddRecoveryTerm(terms, part);
            }
        }

        foreach (Match match in Regex.Matches(source, @"[\p{IsKatakana}ー]{2,}", RegexOptions.CultureInvariant))
        {
            AddRecoveryTerm(terms, match.Value);
        }

        foreach (var term in new[]
        {
            "アフター", "部品", "パーツ", "補修", "サービス", "売上", "収益", "実績", "確定", "根拠",
            "集計", "明細", "内訳", "資料", "数字", "会社名", "対象外", "過年度", "参考", "一般"
        })
        {
            if (source.Contains(term, StringComparison.OrdinalIgnoreCase))
            {
                AddRecoveryTerm(terms, term);
            }
        }

        return terms;
    }

    private static void AddRecoveryTerm(ISet<string> terms, string value)
    {
        var term = value.Trim();
        if (term.Length < 2 || term.Length > 40) return;
        if (Regex.IsMatch(term, @"^[0-9]+$", RegexOptions.CultureInvariant)) return;
        if (RecoveryStopWords.Contains(term)) return;
        terms.Add(term);
    }

    private static readonly HashSet<string> RecoveryStopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "file", "files", "folder", "path", "read", "grep", "glob", "search", "find", "the", "and", "for",
        "from", "with", "this", "that", "tool", "success", "failed", "candidate", "workspace", "relay",
        "ファイル", "フォルダ", "資料", "検索", "探して", "探し", "見つけ", "関する", "について", "この",
        "から", "ため", "ください", "ローカル"
    };

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
