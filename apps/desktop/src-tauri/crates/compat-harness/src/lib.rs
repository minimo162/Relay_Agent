//! Hard-cut compatibility fixture checks.
//!
//! The old Relay-owned runtime parity harness has been removed. This crate now
//! only keeps the vendored [`mock_parity_scenarios.json`](fixtures/mock_parity_scenarios.json)
//! manifest readable until the remaining docs that reference the historical
//! claw-code comparison are archived or rewritten.

#[cfg(test)]
mod mock_parity_manifest {
    use serde_json::Value;

    const FIXTURE: &str = include_str!("../fixtures/mock_parity_scenarios.json");

    /// Must match [ultraworkers/claw-code](https://github.com/ultraworkers/claw-code) `rust/mock_parity_scenarios.json` array order.
    const EXPECTED_SCENARIO_NAMES: &[&str] = &[
        "streaming_text",
        "read_roundtrip",
        "grep_chunk_assembly",
        "write_allowed",
        "write_denied",
        "multi_tool_turn_roundtrip",
        "bash_stdout_roundtrip",
        "bash_permission_prompt_approved",
        "bash_permission_prompt_denied",
        "plugin_tool_roundtrip",
        "auto_compact_triggered",
        "token_cost_reporting",
    ];

    #[test]
    fn mock_parity_scenario_manifest_matches_claw_canonical_order() {
        let entries: Vec<Value> = serde_json::from_str(FIXTURE).expect("fixture JSON");
        let names: Vec<String> = entries
            .iter()
            .map(|e| {
                e.get("name")
                    .and_then(Value::as_str)
                    .expect("scenario name")
                    .to_string()
            })
            .collect();
        let expected: Vec<String> = EXPECTED_SCENARIO_NAMES
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        assert_eq!(
            names, expected,
            "update fixtures/mock_parity_scenarios.json and EXPECTED_SCENARIO_NAMES from claw-code rust/mock_parity_scenarios.json"
        );
    }
}
