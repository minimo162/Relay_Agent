using System.Text.Json.Nodes;

public sealed record RelayToolDirective(string Tool, JsonObject Args, string Reason);

public static class RelayInitialToolPolicy
{
    public static bool TryCreateInitialToolCall(
        RelayTurnState state,
        ISet<string> availableTools,
        out RelayToolDirective directive)
    {
        directive = default!;
        if (!state.RequiresLocalToolBeforeFinal)
        {
            return false;
        }

        return state.Intent switch
        {
            RelayLocalIntent.FileRead when CanUse("read", availableTools) && !string.IsNullOrWhiteSpace(state.ExactFilePath) =>
                Return("read", new JsonObject
                {
                    ["file_path"] = state.ExactFilePath,
                    ["limit"] = 12000,
                }, "exact_file_read_before_final", out directive),

            RelayLocalIntent.OfficeInspect when CanUse("officecli", availableTools) && !string.IsNullOrWhiteSpace(state.ExactFilePath) =>
                Return("officecli", new JsonObject
                {
                    ["filePath"] = state.ExactFilePath,
                    ["operation"] = "view",
                    ["mode"] = "outline",
                }, "office_outline_before_final", out directive),

            RelayLocalIntent.OfficeMutate when CanUse("officecli", availableTools) && !string.IsNullOrWhiteSpace(state.ExactFilePath) =>
                Return("officecli", new JsonObject
                {
                    ["filePath"] = state.ExactFilePath,
                    ["operation"] = "view",
                    ["mode"] = "outline",
                }, "office_inspection_before_mutation", out directive),

            RelayLocalIntent.OfficeInspect or RelayLocalIntent.OfficeMutate when CanUse("officecli", availableTools) =>
                Return("officecli", new JsonObject
                {
                    ["operation"] = "capabilities",
                }, "office_capabilities_before_planning", out directive),

            RelayLocalIntent.CodeWork when CanUse("read", availableTools) && !string.IsNullOrWhiteSpace(state.ExactFilePath) =>
                Return("read", new JsonObject
                {
                    ["file_path"] = state.ExactFilePath,
                    ["limit"] = 12000,
                }, "exact_code_file_read_before_planning", out directive),

            RelayLocalIntent.CodeWork when CanUse("workspace_status", availableTools) =>
                Return("workspace_status", new JsonObject
                {
                    ["limit"] = 5000,
                }, "workspace_status_before_code_work", out directive),

            RelayLocalIntent.Verification when CanUse("workspace_status", availableTools) =>
                Return("workspace_status", new JsonObject
                {
                    ["limit"] = 5000,
                }, "workspace_status_before_verification", out directive),

            RelayLocalIntent.FileSearch or RelayLocalIntent.UnknownLocalWork when CanUse("glob", availableTools) =>
                Return("glob", new JsonObject
                {
                    ["pattern"] = BuildSearchPattern(state.OriginalUserRequest),
                    ["limit"] = 200,
                }, "bounded_file_discovery_before_final", out directive),

            _ when CanUse("glob", availableTools) =>
                Return("glob", new JsonObject
                {
                    ["pattern"] = "**/*",
                    ["limit"] = 200,
                }, "fallback_bounded_discovery_before_final", out directive),

            _ => false,
        };
    }

    private static bool CanUse(string tool, ISet<string> availableTools) =>
        availableTools.Contains(tool);

    private static bool Return(string tool, JsonObject args, string reason, out RelayToolDirective directive)
    {
        directive = new RelayToolDirective(tool, args, reason);
        return true;
    }

    private static string BuildSearchPattern(string request)
    {
        var keyword = ExtractPrimarySearchKeyword(request);
        return string.IsNullOrWhiteSpace(keyword)
            ? "**/*"
            : $"**/*{keyword}*";
    }

    private static string ExtractPrimarySearchKeyword(string request)
    {
        var text = request ?? "";
        foreach (var token in new[] { "ファイル", "フォルダ", "資料", "検索", "探して", "探し", "見つけ", "関する", "について", "を", "に", "の", "から", "この" })
        {
            text = text.Replace(token, " ", StringComparison.OrdinalIgnoreCase);
        }
        var candidates = text
            .Split([' ', '\t', '\r', '\n', '　', '。', '、', ',', ';', ':', '/', '\\'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(token => token.Length >= 2)
            .Where(token => !token.Contains(':'))
            .Where(token => !token.Contains('*'))
            .ToArray();
        return candidates.Length == 0 ? "" : candidates[0];
    }
}
