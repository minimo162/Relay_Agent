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
}
