use crate::models::{
    BrowserAutomationSettings, RelayDoctorCheck, RelayDoctorReport, RelayDoctorStatus,
};
use chrono::Utc;
use serde_json::Value as JsonValue;

#[must_use]
pub fn report_from_checks(
    browser_settings: BrowserAutomationSettings,
    checks: Vec<RelayDoctorCheck>,
    doctor_hints: Vec<String>,
) -> RelayDoctorReport {
    RelayDoctorReport {
        status: aggregate_status(&checks),
        timestamp: Utc::now().to_rfc3339(),
        browser_settings,
        checks,
        doctor_hints,
    }
}

pub fn ok_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Ok,
        message: message.into(),
        details,
    }
}

pub fn warn_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Warn,
        message: message.into(),
        details,
    }
}

pub fn failed_check(
    id: &str,
    message: impl Into<String>,
    details: Option<JsonValue>,
) -> RelayDoctorCheck {
    RelayDoctorCheck {
        id: id.to_string(),
        status: RelayDoctorStatus::Fail,
        message: message.into(),
        details,
    }
}

#[must_use]
pub fn aggregate_status(checks: &[RelayDoctorCheck]) -> RelayDoctorStatus {
    if checks
        .iter()
        .any(|check| check.status == RelayDoctorStatus::Fail)
    {
        RelayDoctorStatus::Fail
    } else if checks
        .iter()
        .any(|check| check.status == RelayDoctorStatus::Warn)
    {
        RelayDoctorStatus::Warn
    } else {
        RelayDoctorStatus::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn browser_settings() -> BrowserAutomationSettings {
        BrowserAutomationSettings {
            cdp_port: 9360,
            auto_launch_edge: true,
            timeout_ms: 120_000,
        }
    }

    #[test]
    fn aggregate_status_prefers_fail_then_warn() {
        assert_eq!(
            aggregate_status(&[ok_check("one", "ok", None), warn_check("two", "warn", None),]),
            RelayDoctorStatus::Warn
        );
        assert_eq!(
            aggregate_status(&[
                ok_check("one", "ok", None),
                failed_check("two", "fail", None),
                warn_check("three", "warn", None),
            ]),
            RelayDoctorStatus::Fail
        );
    }

    #[test]
    fn doctor_report_serializes_expected_shape() {
        let report = report_from_checks(
            browser_settings(),
            vec![
                ok_check("workspace_config", "ok", None),
                warn_check(
                    "m365_sign_in",
                    "warn",
                    Some(json!({"url": "https://example.com"})),
                ),
            ],
            vec!["hint".to_string()],
        );
        let json = serde_json::to_value(report).expect("serialize report");
        assert_eq!(json.get("status").and_then(JsonValue::as_str), Some("warn"));
        assert!(json.get("timestamp").and_then(JsonValue::as_str).is_some());
        assert!(json
            .get("browserSettings")
            .and_then(|value| value.get("cdpPort"))
            .is_some());
        assert_eq!(
            json.get("checks")
                .and_then(JsonValue::as_array)
                .expect("checks array")
                .len(),
            2
        );
    }
}
