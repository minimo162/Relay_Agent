using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

public enum RelayLocalIntent
{
    GeneralChat,
    FileSearch,
    FileRead,
    FileMutation,
    OfficeInspect,
    OfficeMutate,
    CodeWork,
    Verification,
    UnknownLocalWork,
}

public sealed record RelayTurnState(
    string RunKey,
    string OriginalUserRequest,
    string? Workspace,
    RelayLocalIntent Intent,
    bool HasAnyToolResult,
    bool HasMutationToolCall,
    string? PendingOutputFile,
    string? ExactFilePath,
    string[] CompletedTools,
    string[] CompletedToolDetails,
    string StateId)
{
    public bool HasKnownObjective => !string.IsNullOrWhiteSpace(OriginalUserRequest);

    public bool HasPendingOutputFile => !string.IsNullOrWhiteSpace(PendingOutputFile);

    public bool RequiresMutationBeforeFinal => HasPendingOutputFile && !HasMutationToolCall;

    public bool RequiresLocalToolBeforeFinal =>
        RequiresLocalWork &&
        !HasAnyToolResult &&
        !RequiresMutationBeforeFinal;

    public bool RequiresLocalWork => Intent is not RelayLocalIntent.GeneralChat;

    public bool CanAskUser =>
        !HasKnownObjective ||
        string.IsNullOrWhiteSpace(Workspace) ||
        Intent is RelayLocalIntent.GeneralChat;

    public JsonObject ToDiagnosticJson()
    {
        var node = new JsonObject
        {
            ["runKey"] = RunKey,
            ["stateId"] = StateId,
            ["intent"] = Intent.ToString(),
            ["workspace"] = Workspace,
            ["hasKnownObjective"] = HasKnownObjective,
            ["hasAnyToolResult"] = HasAnyToolResult,
            ["hasMutationToolCall"] = HasMutationToolCall,
            ["requiresLocalToolBeforeFinal"] = RequiresLocalToolBeforeFinal,
            ["requiresMutationBeforeFinal"] = RequiresMutationBeforeFinal,
            ["pendingOutputFile"] = PendingOutputFile,
            ["exactFilePath"] = ExactFilePath,
        };
        node["completedTools"] = new JsonArray(CompletedTools.Select(tool => JsonValue.Create(tool)).ToArray());
        node["completedToolDetails"] = new JsonArray(CompletedToolDetails.Select(tool => JsonValue.Create(tool)).ToArray());
        return node;
    }
}

public static class RelayTurnStateFactory
{
    private static readonly Regex FilePathRegex = new(
        @"(?<file>(?:[A-Za-z]:)?[\p{L}\p{N}._/\-\\()[\]（）【】 ]+?\.(?:md|txt|html|json|csv|ts|tsx|js|jsx|py|rs|cs|css|csproj|sln|xlsx|xlsm|xls|docx|pptx|pdf))",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static RelayTurnState Create(
        string runKey,
        string originalUserRequest,
        string? workspace,
        bool hasAnyToolResult,
        bool hasMutationToolCall,
        string? pendingOutputFile,
        IEnumerable<string> completedTools,
        IEnumerable<string> completedToolDetails)
    {
        var exactFilePath = ExtractExactFilePath(originalUserRequest);
        var intent = ClassifyIntent(originalUserRequest, pendingOutputFile, exactFilePath);
        var completed = completedTools
            .Where(tool => !string.IsNullOrWhiteSpace(tool))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(tool => tool, StringComparer.Ordinal)
            .ToArray();
        var details = completedToolDetails
            .Where(detail => !string.IsNullOrWhiteSpace(detail))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(detail => detail, StringComparer.Ordinal)
            .ToArray();
        var stateSeed = string.Join("\u001f", [
            runKey,
            originalUserRequest,
            workspace ?? "",
            intent.ToString(),
            hasAnyToolResult.ToString(),
            hasMutationToolCall.ToString(),
            pendingOutputFile ?? "",
            exactFilePath ?? "",
            string.Join(",", completed),
            string.Join(",", details),
        ]);
        var stateId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(stateSeed)))[..12].ToLowerInvariant();
        return new RelayTurnState(
            runKey,
            originalUserRequest,
            workspace,
            intent,
            hasAnyToolResult,
            hasMutationToolCall,
            string.IsNullOrWhiteSpace(pendingOutputFile) ? null : pendingOutputFile,
            exactFilePath,
            completed,
            details,
            stateId);
    }

    private static RelayLocalIntent ClassifyIntent(string request, string? pendingOutputFile, string? exactFilePath)
    {
        var text = request ?? "";
        if (string.IsNullOrWhiteSpace(text))
        {
            return RelayLocalIntent.GeneralChat;
        }

        var hasOfficePath = Regex.IsMatch(exactFilePath ?? "", @"\.(xlsx|xlsm|xls|docx|pptx)$", RegexOptions.IgnoreCase);
        var officeMention = Regex.IsMatch(
            text,
            @"office|excel|word|powerpoint|ppt|xlsx|xlsm|docx|pptx|cell|sheet\d*|(?<![A-Za-z0-9_])(?-i:[A-Z]{1,3}[1-9][0-9]{0,6})(?![A-Za-z0-9_])|セル|シート|ワークブック|スライド|文書|表計算|officecli",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var mutationMention = Regex.IsMatch(
            text,
            @"編集|修正|変更|更新|作成|作って|書いて|保存|出力|生成|赤く|青く|色|塗|追加|削除|置換|差し替|入力|設定|反映|変え|にして|へして|rename|edit|update|modify|create|write|save|generate|delete|remove|replace|set|color",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var looksLikeCodeOrProject =
            LooksLikeCodeOrProjectRequest(text, exactFilePath) ||
            LooksLikeCodeOrProjectRequest(text, pendingOutputFile);
        if (mutationMention && looksLikeCodeOrProject && !hasOfficePath)
        {
            return RelayLocalIntent.CodeWork;
        }

        if (officeMention || hasOfficePath)
        {
            return mutationMention ? RelayLocalIntent.OfficeMutate : RelayLocalIntent.OfficeInspect;
        }

        if (mutationMention && !string.IsNullOrWhiteSpace(exactFilePath))
        {
            return LooksLikeCodeOrProjectRequest(text, exactFilePath)
                ? RelayLocalIntent.CodeWork
                : RelayLocalIntent.FileMutation;
        }

        if (!string.IsNullOrWhiteSpace(pendingOutputFile))
        {
            return looksLikeCodeOrProject
                ? RelayLocalIntent.CodeWork
                : RelayLocalIntent.FileMutation;
        }

        if (looksLikeCodeOrProject)
        {
            return RelayLocalIntent.CodeWork;
        }

        if (Regex.IsMatch(text, @"build|test|lint|typecheck|pnpm|npm|dotnet|cargo|pytest|git status|検証|テスト|ビルド", RegexOptions.IgnoreCase))
        {
            return RelayLocalIntent.Verification;
        }

        var localFileMention = Regex.IsMatch(
            text,
            @"ファイル|フォルダ|資料|検索|探し|探して|見つけ|読んで|確認|要約|workspace|file|folder|document|search|find|read|inspect|summarize",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (localFileMention)
        {
            return string.IsNullOrWhiteSpace(exactFilePath)
                ? RelayLocalIntent.FileSearch
                : RelayLocalIntent.FileRead;
        }

        return RelayLocalIntent.GeneralChat;
    }

    private static bool LooksLikeCodeOrProjectRequest(string request, string? path)
    {
        if (Regex.IsMatch(path ?? "", @"\.(md|html|json|ts|tsx|js|jsx|py|rs|cs|css|csproj|sln)$", RegexOptions.IgnoreCase))
        {
            return true;
        }

        return Regex.IsMatch(
            request,
            @"コード|実装|修正|バグ|README|html|css|javascript|typescript|python|rust|c#|dotnet|プロジェクト|アプリ|テトリス|code|implement|fix|bug|refactor|app|script",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static string? ExtractExactFilePath(string request)
    {
        if (string.IsNullOrWhiteSpace(request)) return null;
        var matches = FilePathRegex.Matches(request);
        if (matches.Count == 0) return null;
        return matches[^1].Groups["file"].Value.Trim(' ', '。', '、', ',', ';', ':', '"', '\'', '`');
    }
}
