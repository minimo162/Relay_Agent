use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// A registered MCP server entry stored in the runtime registry.
#[derive(Clone, Debug)]
pub struct McpServerEntry {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub status: String,
    pub connected: bool,
    pub tools: Vec<String>,
}

/// Thread-safe registry of MCP servers.
#[derive(Clone)]
pub struct McpRegistry {
    inner: Arc<Mutex<HashMap<String, McpServerEntry>>>,
}

impl McpRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Insert or replace a server in the registry.
    pub fn insert(&self, name: String, command: String, args: Vec<String>) -> McpServerEntry {
        let entry = McpServerEntry {
            name: name.clone(),
            command,
            args,
            status: "registered".to_string(),
            connected: false,
            tools: Vec::new(),
        };
        self.inner
            .lock()
            .expect("MCP registry lock poisoned")
            .insert(name, entry.clone());
        entry
    }

    /// Remove a server by name. Returns true if it existed.
    pub fn remove(&self, name: &str) -> bool {
        self.inner
            .lock()
            .expect("MCP registry lock poisoned")
            .remove(name)
            .is_some()
    }

    /// Get a copy of all registered servers, sorted by name.
    pub fn list(&self) -> Vec<McpServerEntry> {
        let mut servers: Vec<McpServerEntry> = self
            .inner
            .lock()
            .expect("MCP registry lock poisoned")
            .values()
            .cloned()
            .collect();
        servers.sort_by(|a, b| a.name.cmp(&b.name));
        servers
    }

    /// Get a single server by name.
    pub fn get(&self, name: &str) -> Option<McpServerEntry> {
        self.inner
            .lock()
            .expect("MCP registry lock poisoned")
            .get(name)
            .cloned()
    }
}

/// Global singleton MCP registry.
fn global_registry() -> &'static McpRegistry {
    static REG: OnceLock<McpRegistry> = OnceLock::new();
    REG.get_or_init(McpRegistry::new)
}

/// Retrieve the global MCP registry.
pub fn get_mcp_registry() -> McpRegistry {
    global_registry().clone()
}
