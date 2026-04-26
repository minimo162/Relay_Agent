use std::time::Duration;

use serde::Serialize;

const TOOL_RUNTIME_URL_ENV: &str = "RELAY_OPENCODE_TOOL_RUNTIME_URL";

#[derive(Debug, Clone, Serialize)]
pub struct OpencodeRuntimeSnapshot {
    pub url: Option<String>,
    pub running: bool,
    pub message: String,
}

pub fn execution_backend_name() -> String {
    "external-opencode".to_string()
}

pub fn external_runtime_url() -> Option<String> {
    std::env::var(TOOL_RUNTIME_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub async fn snapshot() -> OpencodeRuntimeSnapshot {
    let Some(url) = external_runtime_url() else {
        return OpencodeRuntimeSnapshot {
            url: None,
            running: false,
            message: format!("{TOOL_RUNTIME_URL_ENV} is not set; OpenCode/OpenWork execution is expected to run outside Relay"),
        };
    };

    let client = reqwest::Client::new();
    let path_url = format!("{}/path", url.trim_end_matches('/'));
    let mut last_error = None;

    for attempt in 0..3 {
        let result = client
            .get(&path_url)
            .timeout(Duration::from_secs(3))
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {
                return OpencodeRuntimeSnapshot {
                    url: Some(url),
                    running: true,
                    message: "External OpenCode/OpenWork runtime responded to /path".to_string(),
                };
            }
            Ok(response) => {
                return OpencodeRuntimeSnapshot {
                    url: Some(url),
                    running: false,
                    message: format!(
                        "External OpenCode/OpenWork runtime /path returned HTTP {}",
                        response.status()
                    ),
                };
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(75)).await;
                }
            }
        }
    }

    match last_error {
        Some(error) => OpencodeRuntimeSnapshot {
            url: Some(url),
            running: false,
            message: format!("External OpenCode/OpenWork runtime probe failed: {error}"),
        },
        None => OpencodeRuntimeSnapshot {
            url: Some(url),
            running: false,
            message: "External OpenCode/OpenWork runtime probe failed before sending a request"
                .to_string(),
        },
    }
}
