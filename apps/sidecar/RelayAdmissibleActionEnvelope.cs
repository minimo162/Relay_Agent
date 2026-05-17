using System.Text.Json.Nodes;

public enum RelayActionPhase
{
    CanFinalize,
    NeedsObservation,
    NeedsExactRead,
    NeedsApproval,
    NeedsMutation,
    NeedsUserInput,
    Failed,
}

public sealed record RelayForbiddenAction(string Action, string Reason);

public sealed record RelayAdmissibleActionEnvelope(
    string SchemaVersion,
    RelayActionPhase Phase,
    string StateId,
    IReadOnlyList<string> AllowedActions,
    IReadOnlyList<RelayForbiddenAction> ForbiddenActions,
    IReadOnlyList<string> VisibleTools,
    IReadOnlyList<string> HiddenTools,
    IReadOnlyList<string> TerminalCriteria)
{
    public bool CanFinalize => AllowedActions.Contains("final", StringComparer.Ordinal);

    public bool AllowsTool(string toolName) => VisibleTools.Contains(toolName, StringComparer.Ordinal);

    public JsonObject ToDiagnosticJson()
    {
        var node = new JsonObject
        {
            ["schemaVersion"] = SchemaVersion,
            ["phase"] = Phase.ToString(),
            ["stateId"] = StateId,
        };
        node["allowedActions"] = ToJsonArray(AllowedActions);
        node["forbiddenActions"] = new JsonArray(ForbiddenActions
            .Select(item => new JsonObject
            {
                ["action"] = item.Action,
                ["reason"] = item.Reason,
            })
            .ToArray<JsonNode?>());
        node["visibleTools"] = ToJsonArray(VisibleTools);
        node["hiddenTools"] = ToJsonArray(HiddenTools);
        node["terminalCriteria"] = ToJsonArray(TerminalCriteria);
        return node;
    }

    private static JsonArray ToJsonArray(IEnumerable<string> values) =>
        new(values.Select(value => JsonValue.Create(value)).ToArray<JsonNode?>());
}

public static class RelayAdmissibleActionEnvelopeBuilder
{
    private static readonly string[] ObservationTools = ["glob", "grep", "read", "workspace_status"];
    private static readonly string[] ExactReadTools = ["read"];
    private static readonly string[] OfficeInspectTools = ["officecli", "read"];
    private static readonly string[] FileMutationTools = ["read", "glob", "grep", "edit", "write", "patch", "workspace_status", "diff"];
    private static readonly string[] OfficeMutationTools = ["officecli", "officecli_mutate", "read", "workspace_status", "diff"];
    private static readonly string[] CodeWorkTools = ["read", "glob", "grep", "edit", "write", "patch", "workspace_status", "diff"];
    private static readonly string[] VerificationTools = ["workspace_status", "diff", "bash", "read", "grep"];
    private static readonly string[] ContinuationTools = ["glob", "grep", "read", "officecli", "workspace_status", "diff"];

    public static RelayAdmissibleActionEnvelope Create(RelayTurnState state, ISet<string> registeredTools)
    {
        var phase = DeterminePhase(state, registeredTools);
        var visible = DetermineVisibleTools(state, phase, registeredTools);
        var allowed = visible.ToList();
        if (phase == RelayActionPhase.CanFinalize)
        {
            allowed.Add("final");
        }

        var hidden = registeredTools
            .Where(tool => !visible.Contains(tool, StringComparer.Ordinal))
            .OrderBy(tool => tool, StringComparer.Ordinal)
            .ToArray();

        return new RelayAdmissibleActionEnvelope(
            "RelayAdmissibleActionEnvelope.v1",
            phase,
            state.StateId,
            allowed,
            DetermineForbiddenActions(state, phase),
            visible,
            hidden,
            DetermineTerminalCriteria(state, phase));
    }

    private static RelayActionPhase DeterminePhase(RelayTurnState state, ISet<string> registeredTools)
    {
        if (state.CanAskUser && !state.HasKnownObjective)
        {
            return registeredTools.Contains("ask_user") ? RelayActionPhase.NeedsUserInput : RelayActionPhase.Failed;
        }

        if (state.RequiresMutationBeforeFinal)
        {
            return RelayActionPhase.NeedsMutation;
        }

        if (state.Intent is RelayLocalIntent.FileMutation or RelayLocalIntent.OfficeMutate &&
            !state.HasMutationToolCall)
        {
            return RelayActionPhase.NeedsMutation;
        }

        if (state.Intent is RelayLocalIntent.FileRead or RelayLocalIntent.CodeWork &&
            !state.HasAnyToolResult &&
            !string.IsNullOrWhiteSpace(state.ExactFilePath))
        {
            return RelayActionPhase.NeedsExactRead;
        }

        if (state.RequiresLocalToolBeforeFinal)
        {
            return RelayActionPhase.NeedsObservation;
        }

        return RelayActionPhase.CanFinalize;
    }

    private static string[] DetermineVisibleTools(RelayTurnState state, RelayActionPhase phase, ISet<string> registeredTools)
    {
        var candidates = phase switch
        {
            RelayActionPhase.NeedsUserInput => new[] { "ask_user" },
            RelayActionPhase.NeedsExactRead => ExactReadTools,
            RelayActionPhase.NeedsMutation when state.Intent == RelayLocalIntent.OfficeMutate => OfficeMutationTools,
            RelayActionPhase.NeedsMutation when state.Intent == RelayLocalIntent.CodeWork => CodeWorkTools,
            RelayActionPhase.NeedsMutation => FileMutationTools,
            RelayActionPhase.NeedsObservation when state.Intent == RelayLocalIntent.OfficeInspect => OfficeInspectTools,
            RelayActionPhase.NeedsObservation when state.Intent == RelayLocalIntent.OfficeMutate => OfficeInspectTools,
            RelayActionPhase.NeedsObservation when state.Intent == RelayLocalIntent.FileMutation => FileMutationTools,
            RelayActionPhase.NeedsObservation when state.Intent == RelayLocalIntent.CodeWork => CodeWorkTools,
            RelayActionPhase.NeedsObservation when state.Intent == RelayLocalIntent.Verification => VerificationTools,
            RelayActionPhase.NeedsObservation => ObservationTools,
            RelayActionPhase.CanFinalize when state.Intent == RelayLocalIntent.Verification => VerificationTools,
            RelayActionPhase.CanFinalize => ContinuationTools,
            _ => [],
        };

        if (state.HasAnyToolResult && phase == RelayActionPhase.CanFinalize)
        {
            candidates = candidates.Concat(["edit", "write", "patch", "officecli_mutate"]).ToArray();
        }

        return candidates
            .Where(registeredTools.Contains)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static RelayForbiddenAction[] DetermineForbiddenActions(RelayTurnState state, RelayActionPhase phase)
    {
        var items = new List<RelayForbiddenAction>();
        if (phase != RelayActionPhase.CanFinalize)
        {
            items.Add(new("final", "Terminal criteria are not satisfied for this turn."));
        }
        if (phase != RelayActionPhase.NeedsUserInput)
        {
            items.Add(new("ask_user", "The user objective and safe local next action are known."));
        }
        if (state.Intent != RelayLocalIntent.Verification)
        {
            items.Add(new("bash", "Bounded command execution is reserved for explicit verification, build, test, lint, typecheck, or git tasks."));
        }
        return items.ToArray();
    }

    private static string[] DetermineTerminalCriteria(RelayTurnState state, RelayActionPhase phase)
    {
        if (phase == RelayActionPhase.CanFinalize)
        {
            return ["final_allowed"];
        }

        var criteria = new List<string>();
        if (state.RequiresLocalToolBeforeFinal)
        {
            criteria.Add("at_least_one_local_tool_result");
        }
        if (state.RequiresMutationBeforeFinal || phase == RelayActionPhase.NeedsMutation)
        {
            criteria.Add("successful_mutation_tool_result");
        }
        if (phase == RelayActionPhase.NeedsExactRead)
        {
            criteria.Add("exact_read_result");
        }
        if (phase == RelayActionPhase.NeedsUserInput)
        {
            criteria.Add("user_response");
        }
        return criteria.Count == 0 ? ["state_transition_required"] : criteria.ToArray();
    }
}
