use std::{collections::HashMap, path::PathBuf};

use claw_core::{Message, SessionConfig, SessionState};
use uuid::Uuid;

use crate::models::{
    CreateSessionRequest, InboxFile, Session, SessionDetail, SessionStatus, StartTurnRequest,
    StartTurnResponse, Turn, TurnStatus,
};

pub(crate) struct PersistedSessionView<'a> {
    pub(crate) sessions: &'a HashMap<String, Session>,
    pub(crate) turns: &'a HashMap<String, Turn>,
    pub(crate) messages: &'a [Message],
}

#[derive(Default)]
pub(crate) struct SessionStore {
    sessions: HashMap<String, Session>,
    turns: HashMap<String, Turn>,
    core_sessions: HashMap<String, SessionState>,
}

impl SessionStore {
    pub(crate) fn from_maps(
        sessions: HashMap<String, Session>,
        turns: HashMap<String, Turn>,
        session_messages: HashMap<String, Vec<Message>>,
    ) -> Self {
        let mut core_sessions = HashMap::new();
        for session in sessions.values() {
            let messages = session_messages
                .get(&session.id)
                .cloned()
                .unwrap_or_default();
            let core_session = build_core_session(session, messages);
            core_sessions.insert(session.id.clone(), core_session);
        }

        Self {
            sessions,
            turns,
            core_sessions,
        }
    }

    pub(crate) fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub(crate) fn contains_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    pub(crate) fn create_session(
        &mut self,
        request: CreateSessionRequest,
        now: String,
    ) -> Result<Session, String> {
        let title = require_text("title", request.title)?;
        let objective = require_text("objective", request.objective)?;
        let primary_workbook_path = request
            .primary_workbook_path
            .map(|path| require_text("primaryWorkbookPath", path))
            .transpose()?;

        let session = Session {
            id: Uuid::new_v4().to_string(),
            title,
            objective,
            status: SessionStatus::Draft,
            primary_workbook_path,
            inbox_files: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
            latest_turn_id: None,
            turn_ids: Vec::new(),
        };

        self.sessions.insert(session.id.clone(), session.clone());
        self.core_sessions
            .insert(session.id.clone(), build_core_session(&session, Vec::new()));
        Ok(session)
    }

    pub(crate) fn list_sessions(&self) -> Vec<Session> {
        let mut sessions = self.sessions.values().cloned().collect::<Vec<_>>();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }

    pub(crate) fn read_session(&self, session_id: &str) -> Result<SessionDetail, String> {
        let session = self.read_session_model(session_id)?;

        let mut turns = session
            .turn_ids
            .iter()
            .filter_map(|turn_id| self.turns.get(turn_id).cloned())
            .collect::<Vec<_>>();
        turns.sort_by(|left, right| left.created_at.cmp(&right.created_at));

        Ok(SessionDetail { session, turns })
    }

    pub(crate) fn read_session_model(&self, session_id: &str) -> Result<Session, String> {
        self.sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("session `{session_id}` was not found"))
    }

    pub(crate) fn replace_inbox_files(
        &mut self,
        session_id: &str,
        inbox_files: Vec<InboxFile>,
        now: String,
    ) -> Result<Session, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        session.inbox_files = inbox_files;
        session.updated_at = now;
        Ok(session.clone())
    }

    pub(crate) fn add_inbox_file(
        &mut self,
        session_id: &str,
        inbox_file: InboxFile,
        now: String,
    ) -> Result<Session, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        if let Some(existing) = session
            .inbox_files
            .iter_mut()
            .find(|entry| entry.path == inbox_file.path)
        {
            *existing = inbox_file;
        } else {
            session.inbox_files.push(inbox_file);
        }
        session
            .inbox_files
            .sort_by(|left, right| left.added_at.cmp(&right.added_at));
        session.updated_at = now;
        Ok(session.clone())
    }

    pub(crate) fn remove_inbox_file(
        &mut self,
        session_id: &str,
        path: &str,
        now: String,
    ) -> Result<Session, String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        session.inbox_files.retain(|entry| entry.path != path);
        session.updated_at = now;
        Ok(session.clone())
    }

    pub(crate) fn read_latest_turn_model(&self, session_id: &str) -> Result<Turn, String> {
        let session = self.read_session_model(session_id)?;
        let turn_id = session
            .latest_turn_id
            .clone()
            .or_else(|| session.turn_ids.last().cloned())
            .ok_or_else(|| format!("session `{session_id}` does not have any turns yet"))?;

        self.turns
            .get(&turn_id)
            .cloned()
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))
    }

    pub(crate) fn start_turn(
        &mut self,
        request: StartTurnRequest,
        now: String,
    ) -> Result<StartTurnResponse, String> {
        let title = require_text("title", request.title)?;
        let objective = require_text("objective", request.objective)?;

        let session = self
            .sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| format!("session `{}` was not found", request.session_id))?;

        let turn = Turn {
            id: Uuid::new_v4().to_string(),
            session_id: session.id.clone(),
            title,
            objective,
            mode: request.mode,
            status: TurnStatus::Draft,
            created_at: now.clone(),
            updated_at: now.clone(),
            item_ids: Vec::new(),
            validation_error_count: 0,
        };

        session.status = SessionStatus::Active;
        session.updated_at = now;
        session.latest_turn_id = Some(turn.id.clone());
        session.turn_ids.push(turn.id.clone());

        let session_snapshot = session.clone();
        self.turns.insert(turn.id.clone(), turn.clone());

        Ok(StartTurnResponse {
            session: session_snapshot,
            turn,
        })
    }

    pub(crate) fn get_session_and_turn(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Result<(Session, Turn), String> {
        let session = self.read_session_model(session_id)?;
        if !session.turn_ids.iter().any(|id| id == turn_id) {
            return Err(format!(
                "turn `{turn_id}` does not belong to session `{session_id}`"
            ));
        }

        let turn = self
            .turns
            .get(turn_id)
            .cloned()
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;

        Ok((session, turn))
    }

    pub(crate) fn update_turn_status(
        &mut self,
        turn_id: &str,
        status: TurnStatus,
        validation_error_count: u32,
        now: String,
    ) -> Result<Turn, String> {
        let turn = self
            .turns
            .get_mut(turn_id)
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;
        turn.status = status;
        turn.validation_error_count = validation_error_count;
        turn.updated_at = now;

        Ok(turn.clone())
    }

    pub(crate) fn sync_session_messages(
        &mut self,
        session_id: &str,
        messages: Vec<Message>,
    ) -> Result<(), String> {
        let session = self.read_session_model(session_id)?;
        let core_session = self
            .core_sessions
            .entry(session_id.to_string())
            .or_insert_with(|| build_core_session(&session, Vec::new()));
        core_session.messages = messages;
        Ok(())
    }

    pub(crate) fn read_session_messages(&self, session_id: &str) -> Result<Vec<Message>, String> {
        self.core_sessions
            .get(session_id)
            .map(|session| session.messages.clone())
            .ok_or_else(|| format!("session `{session_id}` was not found"))
    }

    pub(crate) fn persisted_session_view(
        &self,
        session_id: &str,
    ) -> Result<PersistedSessionView<'_>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("session `{session_id}` was not found"));
        }
        let messages = self
            .core_sessions
            .get(session_id)
            .map(|session| session.messages.as_slice())
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;

        Ok(PersistedSessionView {
            sessions: &self.sessions,
            turns: &self.turns,
            messages,
        })
    }

    pub(crate) fn push_turn_item(
        &mut self,
        turn_id: &str,
        artifact_id: String,
    ) -> Result<(), String> {
        let turn = self
            .turns
            .get_mut(turn_id)
            .ok_or_else(|| format!("turn `{turn_id}` was not found"))?;
        turn.item_ids.push(artifact_id);
        Ok(())
    }

    pub(crate) fn touch_session(&mut self, session_id: &str, now: String) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("session `{session_id}` was not found"))?;
        session.updated_at = now;
        Ok(())
    }
}

fn require_text(field: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }

    Ok(trimmed)
}

fn build_core_session(session: &Session, messages: Vec<Message>) -> SessionState {
    let cwd = session_cwd(session);
    let mut core_session = SessionState::new(SessionConfig::default(), cwd);
    core_session.id = session.id.clone();
    core_session.messages = messages;
    core_session
}

fn session_cwd(session: &Session) -> PathBuf {
    session
        .primary_workbook_path
        .as_deref()
        .map(PathBuf::from)
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(test)]
mod tests {
    use claw_core::Message;

    use super::SessionStore;
    use crate::models::{CreateSessionRequest, InboxFile, RelayMode, StartTurnRequest};

    #[test]
    fn sync_session_messages_roundtrips_through_core_state() {
        let mut store = SessionStore::default();
        let session = store
            .create_session(
                CreateSessionRequest {
                    title: "History sync".to_string(),
                    objective: "Keep core history aligned".to_string(),
                    primary_workbook_path: None,
                },
                "2025-01-01T00:00:00Z".to_string(),
            )
            .expect("session should be created");
        store
            .start_turn(
                StartTurnRequest {
                    session_id: session.id.clone(),
                    title: "Initial".to_string(),
                    objective: "Start".to_string(),
                    mode: RelayMode::Plan,
                },
                "2025-01-01T00:00:01Z".to_string(),
            )
            .expect("turn should be created");

        store
            .sync_session_messages(
                &session.id,
                vec![Message::user("hello"), Message::assistant_text("world")],
            )
            .expect("messages should sync");

        let messages = store
            .read_session_messages(&session.id)
            .expect("messages should be readable");
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn inbox_files_can_be_added_and_removed() {
        let mut store = SessionStore::default();
        let session = store
            .create_session(
                CreateSessionRequest {
                    title: "Inbox sync".to_string(),
                    objective: "Track shared files".to_string(),
                    primary_workbook_path: None,
                },
                "2025-01-01T00:00:00Z".to_string(),
            )
            .expect("session should be created");

        let updated = store
            .add_inbox_file(
                &session.id,
                InboxFile {
                    path: "/tmp/input.csv".to_string(),
                    size: 128,
                    added_at: "2025-01-01T00:00:01Z".to_string(),
                },
                "2025-01-01T00:00:01Z".to_string(),
            )
            .expect("inbox file should be added");
        assert_eq!(updated.inbox_files.len(), 1);

        let updated = store
            .remove_inbox_file(
                &session.id,
                "/tmp/input.csv",
                "2025-01-01T00:00:02Z".to_string(),
            )
            .expect("inbox file should be removed");
        assert!(updated.inbox_files.is_empty());
    }
}
