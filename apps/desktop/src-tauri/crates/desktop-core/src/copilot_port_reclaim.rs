use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthBody {
    pub status: String,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
}

pub fn should_reclaim_listener(
    body: &HealthBody,
    expected_instance_id: &str,
    relay_service_name: &str,
) -> bool {
    body.status == "ok"
        && body.service.as_deref() == Some(relay_service_name)
        && body.instance_id.as_deref() != Some(expected_instance_id)
}

#[cfg(test)]
mod tests {
    use super::{should_reclaim_listener, HealthBody};

    const RELAY_SERVICE_NAME: &str = "copilot_server";

    #[test]
    fn reclaim_requires_relay_service_and_mismatched_instance_id() {
        let relay_other_instance = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_SERVICE_NAME.into()),
            instance_id: Some("other-instance".into()),
        };
        assert!(should_reclaim_listener(
            &relay_other_instance,
            "expected-instance",
            RELAY_SERVICE_NAME,
        ));

        let same_instance = HealthBody {
            status: "ok".into(),
            service: Some(RELAY_SERVICE_NAME.into()),
            instance_id: Some("expected-instance".into()),
        };
        assert!(!should_reclaim_listener(
            &same_instance,
            "expected-instance",
            RELAY_SERVICE_NAME,
        ));

        let foreign_service = HealthBody {
            status: "ok".into(),
            service: Some("other_service".into()),
            instance_id: Some("other-instance".into()),
        };
        assert!(!should_reclaim_listener(
            &foreign_service,
            "expected-instance",
            RELAY_SERVICE_NAME,
        ));

        let missing_fingerprint = HealthBody {
            status: "ok".into(),
            service: None,
            instance_id: None,
        };
        assert!(!should_reclaim_listener(
            &missing_fingerprint,
            "expected-instance",
            RELAY_SERVICE_NAME,
        ));
    }
}
