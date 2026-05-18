using System.Text.Json;

public static class RelayPromptBuilder
{
    public static string BuildStatePrompt(RelayTurnState state, RelayAdmissibleActionEnvelope envelope)
    {
        var lines = new List<string>
        {
            "RELAY_TURN_STATE",
            state.ToDiagnosticJson().ToJsonString(JsonOptions.Compact),
            "",
            "RELAY_ADMISSIBLE_ACTION_ENVELOPE",
            envelope.ToDiagnosticJson().ToJsonString(JsonOptions.Compact),
            "",
            "Protocol rules for this turn:",
            "- Copilot may reason and choose among Relay tools, but Relay owns local execution state.",
            "- If requiresLocalToolBeforeFinal is true, action=final is invalid until a local tool result exists.",
            "- If requiresMutationBeforeFinal is true, action=final is invalid until a successful mutation tool result exists.",
            "- Choose only actions listed in RELAY_ADMISSIBLE_ACTION_ENVELOPE.allowedActions.",
            "- Tools not listed in RELAY_ADMISSIBLE_ACTION_ENVELOPE.visibleTools are invalid for this turn.",
            "- If the objective and workspace are known, ask_user is invalid unless a critical missing requirement blocks all safe local action.",
            "- If a protocol rule blocks your intended final answer, return action=tool instead.",
            "- For local search or evidence tasks, do not answer from grep snippets alone; before citing a candidate file as the answer, read that exact file path.",
            "- For PDF proofreading or two-PDF comparison, read every exact PDF needed before finalizing; cite only extracted text evidence and state text-layer/OCR limitations when extraction is incomplete.",
        };

        if (!string.IsNullOrWhiteSpace(state.OriginalUserRequest))
        {
            lines.Add("");
            lines.Add("RELAY_ORIGINAL_USER_REQUEST");
            lines.Add(state.OriginalUserRequest);
        }

        if (!string.IsNullOrWhiteSpace(state.PendingOutputFile))
        {
            lines.Add("");
            lines.Add("RELAY_PENDING_MUTATION");
            lines.Add($"Target output file: {state.PendingOutputFile}");
            lines.Add("This required output target still lacks a successful write/apply_patch/edit/office mutation.");
            if (state.HasMultipleOutputFiles)
            {
                lines.Add("The user named multiple output files; use apply_patch as one coherent project change set when it is visible.");
            }
        }

        if (!string.IsNullOrWhiteSpace(state.ProjectRoot))
        {
            lines.Add("");
            lines.Add("RELAY_PROJECT_CONTEXT");
            lines.Add($"Project root: {state.ProjectRoot}");
            lines.Add($"Resolve short project-relative paths such as src/app.js, docs/USAGE.md, package.json, and README.md under {state.ProjectRoot}/ unless the user gives a different explicit root or an absolute path.");
            lines.Add("Do not read or patch the bare project root as a file; inspect concrete files under the project root.");
        }

        if (state.CompletedTools.Length > 0)
        {
            lines.Add("");
            lines.Add("RELAY_COMPLETED_TOOLS " + string.Join(", ", state.CompletedTools));
        }

        if (state.CompletedToolDetails.Length > 0)
        {
            lines.Add("");
            lines.Add("RELAY_COMPLETED_TOOL_RESULTS");
            foreach (var detail in state.CompletedToolDetails)
            {
                lines.Add("- " + detail);
            }
            lines.Add("Do not repeat successful read/glob/grep calls unless the same target must be rechecked after a mutation.");
            lines.Add("Do not repeat successful write/edit/apply_patch/officecli_mutate calls to the same target unless a later tool result shows a concrete problem.");
            lines.Add("When the user-required output files already have successful mutation results and no verification is explicitly requested, prefer final instead of rewriting them.");
            lines.Add("If the user-named source files have already been read and the phase still needs a mutation, choose write/edit/apply_patch next instead of read/diff.");
        }

        return string.Join("\n", lines);
    }
}
