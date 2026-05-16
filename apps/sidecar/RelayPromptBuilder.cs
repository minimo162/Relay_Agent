using System.Text.Json;

public static class RelayPromptBuilder
{
    public static string BuildStatePrompt(RelayTurnState state)
    {
        var lines = new List<string>
        {
            "RELAY_TURN_STATE",
            state.ToDiagnosticJson().ToJsonString(JsonOptions.Compact),
            "",
            "Protocol rules for this turn:",
            "- Copilot may reason and choose among Relay tools, but Relay owns local execution state.",
            "- If requiresLocalToolBeforeFinal is true, action=final is invalid until a local tool result exists.",
            "- If requiresMutationBeforeFinal is true, action=final is invalid until a successful mutation tool result exists.",
            "- If the objective and workspace are known, ask_user is invalid unless a critical missing requirement blocks all safe local action.",
            "- If a protocol rule blocks your intended final answer, return action=tool instead.",
        };

        if (!string.IsNullOrWhiteSpace(state.OriginalUserRequest))
        {
            lines.Add("");
            lines.Add("RELAY_ORIGINAL_USER_REQUEST");
            lines.Add(state.OriginalUserRequest);
        }

        if (!string.IsNullOrWhiteSpace(state.PendingOutputFile) && !state.HasMutationToolCall)
        {
            lines.Add("");
            lines.Add("RELAY_PENDING_MUTATION");
            lines.Add($"Target output file: {state.PendingOutputFile}");
            lines.Add("No write/apply_patch/edit/office mutation has succeeded yet.");
        }

        if (state.CompletedTools.Length > 0)
        {
            lines.Add("");
            lines.Add("RELAY_COMPLETED_TOOLS " + string.Join(", ", state.CompletedTools));
        }

        return string.Join("\n", lines);
    }
}
