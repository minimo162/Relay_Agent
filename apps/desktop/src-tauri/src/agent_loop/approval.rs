use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Runtime};

use runtime::{PermissionPromptDecision, PermissionPrompter, PermissionRequest};

use crate::agent_loop::events::{emit_status_event, AgentApprovalNeededEvent, E_APPROVAL_NEEDED};
use crate::agent_loop::state::{AgentSessionPhase, AgentStatusOptions, LoopEpochGuard};
use crate::registry::{PendingApproval, SessionRegistry, SessionRunState};

pub struct TauriApprovalPrompter<R: Runtime> {
    pub app: AppHandle<R>,
    pub session_id: String,
    pub registry: SessionRegistry,
}

impl<R: Runtime> PermissionPrompter for TauriApprovalPrompter<R> {
    #[allow(clippy::too_many_lines)]
    fn decide(&mut self, request: &PermissionRequest) -> PermissionPromptDecision {
        let loop_guard = LoopEpochGuard::new(&self.registry, &self.session_id);
        let cancelled = {
            match self.registry.get_session(&self.session_id, |entry| {
                entry.cancelled.load(Ordering::SeqCst) || entry.loop_epoch != loop_guard.epoch
            }) {
                Ok(Some(cancelled)) => cancelled,
                Ok(None) => true,
                Err(e) => {
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during permission check: {e}"
                    );
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            }
        };

        if cancelled {
            return PermissionPromptDecision::Deny {
                reason: "session was cancelled".into(),
            };
        }

        let session_allows_tool = match self.registry.get_handle(&self.session_id) {
            Ok(Some(handle)) => handle
                .is_tool_auto_allowed(&request.tool_name)
                .unwrap_or(false),
            Ok(None) => false,
            Err(e) => {
                tracing::error!("[RelayAgent] registry lock poisoned during auto-allow check: {e}");
                return PermissionPromptDecision::Deny {
                    reason: "registry lock poisoned".into(),
                };
            }
        };
        if session_allows_tool {
            return PermissionPromptDecision::Allow;
        }

        let approval_id = uuid::Uuid::new_v4().to_string();

        let approval_display = tools::approval_display_for_tool(&request.tool_name, &request.input);
        let mut description = approval_display.approval_title;
        if !approval_display.important_args.is_empty() {
            description = format!(
                "{description}\n{}",
                approval_display.important_args.join("\n")
            );
        }
        let target = approval_display.approval_target_hint;
        let input_obj = serde_json::from_str(&request.input).unwrap_or(serde_json::json!({}));

        let workspace_cwd_configured = match self.registry.get_session(&self.session_id, |entry| {
            entry
                .session_config
                .cwd
                .as_deref()
                .is_some_and(|s| !s.trim().is_empty())
        }) {
            Ok(Some(configured)) => configured,
            Ok(None) | Err(_) => false,
        };

        if let Err(e) = self.app.emit(
            E_APPROVAL_NEEDED,
            AgentApprovalNeededEvent {
                session_id: self.session_id.clone(),
                approval_id: approval_id.clone(),
                tool_name: request.tool_name.clone(),
                description,
                target,
                input: input_obj,
                workspace_cwd_configured,
            },
        ) {
            tracing::warn!("[RelayAgent] emit failed ({E_APPROVAL_NEEDED}): {e}");
        }

        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        {
            let Some(handle) = self.registry.get_handle(&self.session_id).ok().flatten() else {
                return PermissionPromptDecision::Deny {
                    reason: "session was removed".into(),
                };
            };
            match handle.read_state(|entry| entry.loop_epoch) {
                Ok(epoch) if epoch == loop_guard.epoch => {}
                Ok(_) => {
                    return PermissionPromptDecision::Deny {
                        reason: "session loop was replaced".into(),
                    };
                }
                Err(e) => {
                    tracing::error!(
                        "[RelayAgent] registry lock poisoned during approval registration: {e}"
                    );
                    return PermissionPromptDecision::Deny {
                        reason: "registry lock poisoned".into(),
                    };
                }
            }
            if let Err(e) = handle.write_state(|entry| {
                entry.run_state = SessionRunState::WaitingApproval;
            }) {
                tracing::error!("[RelayAgent] session state lock poisoned: {e}");
                return PermissionPromptDecision::Deny {
                    reason: "registry lock poisoned".into(),
                };
            }
            if let Err(e) = handle.insert_pending_approval(
                approval_id.clone(),
                PendingApproval {
                    tx,
                    tool_name: request.tool_name.clone(),
                },
            ) {
                tracing::error!("[RelayAgent] approvals lock poisoned: {e}");
                return PermissionPromptDecision::Deny {
                    reason: "registry lock poisoned".into(),
                };
            }
        }
        emit_status_event(
            &self.app,
            &loop_guard,
            AgentSessionPhase::WaitingApproval,
            AgentStatusOptions::default()
                .with_tool_name(request.tool_name.clone())
                .with_message("Waiting for tool approval"),
        );

        let decision = match rx.recv() {
            Ok(true) => PermissionPromptDecision::Allow,
            Ok(false) => PermissionPromptDecision::Deny {
                reason: "user rejected the tool execution".into(),
            },
            Err(_) => PermissionPromptDecision::Deny {
                reason: "approval channel was closed (session ended or was cancelled)".into(),
            },
        };

        let _ignore = self.registry.mutate_session(&self.session_id, |entry| {
            if entry.loop_epoch != loop_guard.epoch {
                return;
            }
            if entry.run_state != SessionRunState::Cancelling {
                entry.run_state = SessionRunState::Running;
                entry.running = true;
            }
            if let PermissionPromptDecision::Deny { reason } = &decision {
                entry.last_error_summary = Some(reason.clone());
            }
        });
        if loop_guard.is_current() {
            emit_status_event(
                &self.app,
                &loop_guard,
                AgentSessionPhase::Running,
                AgentStatusOptions::default().with_message("Approval resolved; continuing"),
            );
        }

        decision
    }
}
