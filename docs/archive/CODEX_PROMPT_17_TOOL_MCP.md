# Codex プロンプト 17 — ツールレジストリ & MCP 統合（Tasks 155–159）

## 対象タスク

- **Task 155**: 設計 — ツールレジストリ & MCP クライアント アーキテクチャ
- **Task 156**: バックエンド — ツールレジストリ実装
- **Task 157**: バックエンド — MCP クライアント実装
- **Task 158**: フロントエンド — ツール管理 UI
- **Task 159**: ブラウザ自動化のツール化

## 概要

ビルトインツール（スプレッドシート、ファイル操作）と MCP 外部ツールを統一管理する
ツールレジストリを導入し、エージェントループから一貫した方法でツールを呼び出せるようにする。

**基本方針:**
- ToolRegistry trait でビルトイン / MCP ツールを統一抽象化
- 既存のハードコーディングされたツールディスパッチをレジストリ経由に段階的に移行
- MCP はオプション機能（MCP サーバー未登録でも従来通り動作）
- ブラウザ自動化も1つの「ツール」としてレジストリに登録

## 前提

### 既存ツールディスパッチ

現在 `storage.rs` の `execute_read_actions` / `run_execution` で
`match action.tool.as_str()` によるハードコーディングでツールをディスパッチしている:

```rust
// execute_read_actions 内:
match action.tool.as_str() {
    "workbook.inspect" => ...,
    "sheet.preview" => ...,
    "sheet.profile_columns" => ...,
    "session.diff_from_base" => ...,
    _ => Err("unknown read tool")
}
```

### 既存の ToolDescriptor

```typescript
// packages/contracts/src/relay.ts
toolDescriptorSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  phase: toolPhaseSchema,           // "read" | "write"
  requiresApproval: z.boolean()
})
```

### MCP プロトコル概要

MCP (Model Context Protocol) は JSON-RPC 2.0 ベース:
- `tools/list` → ツール一覧を取得
- `tools/call` → ツールを実行
- トランスポート: stdio（子プロセス）または SSE（HTTP）

---

## Task 155: 設計 — ツールレジストリ & MCP クライアント アーキテクチャ

### `docs/TOOL_REGISTRY_DESIGN.md` を作成

内容:
- ツールレジストリの設計（下記 trait / interface）
- MCP 統合フロー
- セキュリティモデル（MCP ツールは常に承認必須）
- ツールライフサイクル（登録 → 発見 → 呼び出し → 結果返却）

---

## Task 156: バックエンド — ツールレジストリ実装

### Contracts 拡張 — `packages/contracts/src/relay.ts` に追加

```typescript
export const toolRegistrationSchema = z.object({
  id: z.string().trim().min(1),
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  phase: toolPhaseSchema,
  requiresApproval: z.boolean(),
  source: z.enum(["builtin", "mcp"]).default("builtin"),
  parameterSchema: z.record(z.string(), z.unknown()).optional(),
  mcpServerUrl: z.string().optional()
});

export type ToolRegistration = z.infer<typeof toolRegistrationSchema>;
```

### Rust — 新規ファイル: `apps/desktop/src-tauri/src/tool_registry.rs`

```rust
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ToolSource {
    Builtin,
    Mcp,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRegistration {
    pub id: String,
    pub title: String,
    pub description: String,
    pub phase: crate::models::ToolPhase,
    pub requires_approval: bool,
    pub source: ToolSource,
    pub parameter_schema: Option<Value>,
    pub mcp_server_url: Option<String>,
}

pub type ToolExecutor = Box<dyn Fn(&Value) -> Result<Value, String> + Send + Sync>;

pub struct ToolRegistry {
    tools: HashMap<String, ToolRegistration>,
    executors: HashMap<String, ToolExecutor>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            executors: HashMap::new(),
        }
    }

    /// ビルトインツールを登録
    pub fn register(
        &mut self,
        registration: ToolRegistration,
        executor: ToolExecutor,
    ) {
        let id = registration.id.clone();
        self.tools.insert(id.clone(), registration);
        self.executors.insert(id, executor);
    }

    /// MCP ツールを登録（executor は MCP クライアント経由で動的生成）
    pub fn register_mcp_tool(&mut self, registration: ToolRegistration) {
        self.tools.insert(registration.id.clone(), registration);
        // executor は invoke 時に MCP クライアントを使用
    }

    /// ツール一覧
    pub fn list(&self) -> Vec<&ToolRegistration> {
        self.tools.values().collect()
    }

    /// 指定フェーズのツール一覧
    pub fn list_by_phase(&self, phase: crate::models::ToolPhase) -> Vec<&ToolRegistration> {
        self.tools.values()
            .filter(|t| t.phase == phase)
            .collect()
    }

    /// ツール実行
    pub fn invoke(&self, tool_id: &str, args: &Value) -> Result<Value, String> {
        let registration = self.tools.get(tool_id)
            .ok_or_else(|| format!("unknown tool: {}", tool_id))?;

        match registration.source {
            ToolSource::Builtin => {
                let executor = self.executors.get(tool_id)
                    .ok_or_else(|| format!("no executor registered for: {}", tool_id))?;
                executor(args)
            }
            ToolSource::Mcp => {
                Err("MCP tool invocation requires async MCP client — use invoke_mcp()".to_string())
            }
        }
    }

    /// ツール存在チェック
    pub fn has(&self, tool_id: &str) -> bool {
        self.tools.contains_key(tool_id)
    }

    /// ToolDescriptor 形式で取得（RelayPacket 生成用）
    pub fn to_descriptors(&self) -> Vec<crate::models::ToolDescriptor> {
        self.tools.values().map(|t| crate::models::ToolDescriptor {
            id: t.id.clone(),
            title: t.title.clone(),
            description: t.description.clone(),
            phase: t.phase,
            requires_approval: t.requires_approval,
        }).collect()
    }
}
```

### ビルトインツールの登録 — 初期化時

`storage.rs` または新規 `tool_init.rs` で起動時にビルトインツールを登録:

```rust
pub fn register_builtin_tools(registry: &mut ToolRegistry) {
    // スプレッドシート read tools
    registry.register(
        ToolRegistration {
            id: "workbook.inspect".into(),
            title: "ワークブック検査".into(),
            description: "ワークブックのシート構成・列情報を取得".into(),
            phase: ToolPhase::Read,
            requires_approval: false,
            source: ToolSource::Builtin,
            parameter_schema: None,
            mcp_server_url: None,
        },
        Box::new(|args| {
            // 既存の workbook inspect ロジックを呼び出す
            crate::workbook_ops::execute_workbook_inspect(args)
        }),
    );

    // ... 他のビルトインツールも同様に登録
    // sheet.preview, sheet.profile_columns, session.diff_from_base
    // table.rename_columns, table.cast_columns, table.filter_rows, etc.
    // file.list, file.read_text, file.stat, file.copy, file.move, file.delete
    // text.search, text.replace, document.read_text
}
```

### `storage.rs` のディスパッチをレジストリ経由に移行

```rust
// Before:
match action.tool.as_str() {
    "workbook.inspect" => execute_workbook_inspect(&action.args),
    "sheet.preview" => execute_sheet_preview(&action.args, ...),
    _ => Err("unknown tool")
}

// After:
self.tool_registry.invoke(&action.tool, &action.args)
```

### Tauri コマンド

```rust
#[tauri::command]
pub fn list_tools(
    storage: State<'_, Mutex<AppStorage>>,
) -> Result<Vec<ToolRegistration>, String> {
    let storage = storage.lock().unwrap();
    Ok(storage.tool_registry.list().into_iter().cloned().collect())
}
```

### `lib.rs` に登録

```rust
mod tool_registry;

// invoke_handler に追加:
execution::list_tools,
```

---

## Task 157: バックエンド — MCP クライアント実装

### 新規ファイル: `apps/desktop/src-tauri/src/mcp_client.rs`

```rust
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub url: String,
    pub name: String,
    pub transport: McpTransport,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Sse,
    Stdio,
}

#[derive(Clone, Debug, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

pub struct McpClient {
    config: McpServerConfig,
    http_client: reqwest::Client,
}

impl McpClient {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            http_client: reqwest::Client::new(),
        }
    }

    /// ツール一覧を取得（tools/list）
    pub async fn list_tools(&self) -> Result<Vec<McpToolDefinition>, String> {
        let response = self.send_jsonrpc("tools/list", json!({})).await?;
        let tools: Vec<McpToolDefinition> = serde_json::from_value(
            response.get("tools").cloned().unwrap_or(json!([]))
        ).map_err(|e| format!("failed to parse tools: {}", e))?;
        Ok(tools)
    }

    /// ツール実行（tools/call）
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: &Value,
    ) -> Result<Value, String> {
        let params = json!({
            "name": tool_name,
            "arguments": arguments
        });
        self.send_jsonrpc("tools/call", params).await
    }

    async fn send_jsonrpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let response = self.http_client
            .post(&self.config.url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("MCP request failed: {}", e))?;

        let body: Value = response.json()
            .await
            .map_err(|e| format!("MCP response parse failed: {}", e))?;

        if let Some(error) = body.get("error") {
            return Err(format!("MCP error: {}", error));
        }

        Ok(body.get("result").cloned().unwrap_or(json!(null)))
    }
}
```

### Cargo.toml

```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
```

### MCP ツール発見 → レジストリ自動登録

```rust
pub async fn discover_and_register_mcp_tools(
    registry: &mut ToolRegistry,
    server_config: McpServerConfig,
) -> Result<Vec<String>, String> {
    let client = McpClient::new(server_config.clone());
    let tools = client.list_tools().await?;
    let mut registered_ids = Vec::new();

    for tool in tools {
        let tool_id = format!("mcp.{}.{}", server_config.name, tool.name);
        registry.register_mcp_tool(ToolRegistration {
            id: tool_id.clone(),
            title: tool.name.clone(),
            description: tool.description,
            phase: ToolPhase::Write,  // MCP ツールはデフォルトで write（承認必須）
            requires_approval: true,
            source: ToolSource::Mcp,
            parameter_schema: Some(tool.input_schema),
            mcp_server_url: Some(server_config.url.clone()),
        });
        registered_ids.push(tool_id);
    }

    Ok(registered_ids)
}
```

### Tauri コマンド

```rust
#[tauri::command]
pub async fn connect_mcp_server(
    storage: State<'_, Mutex<AppStorage>>,
    config: McpServerConfig,
) -> Result<Vec<String>, String> {
    // MCP サーバーに接続してツールを発見・登録
    let mut storage = storage.lock().unwrap();
    discover_and_register_mcp_tools(&mut storage.tool_registry, config).await
}

#[tauri::command]
pub async fn invoke_mcp_tool(
    storage: State<'_, Mutex<AppStorage>>,
    tool_id: String,
    args: Value,
) -> Result<Value, String> {
    // tool_id から MCP サーバー URL を取得して呼び出し
    let storage = storage.lock().unwrap();
    let registration = storage.tool_registry.tools.get(&tool_id)
        .ok_or_else(|| format!("unknown tool: {}", tool_id))?;
    let server_url = registration.mcp_server_url.as_ref()
        .ok_or("not an MCP tool")?;

    let tool_name = tool_id.rsplit('.').next().unwrap_or(&tool_id);
    let client = McpClient::new(McpServerConfig {
        url: server_url.clone(),
        name: "".into(),
        transport: McpTransport::Sse,
    });

    client.call_tool(tool_name, &args).await
}
```

---

## Task 158: フロントエンド — ツール管理 UI

### `SettingsModal.svelte` に「ツール」タブ追加

```svelte
<!-- 設定モーダル内に新しいセクション追加 -->
<section class="settings-section">
  <h3>ツール管理</h3>

  <h4>ビルトインツール</h4>
  {#each builtinTools as tool}
    <label class="tool-toggle">
      <input type="checkbox" checked={tool.enabled}
        on:change={() => toggleTool(tool.id)} />
      <span class="tool-name">{tool.title}</span>
      <span class="tool-phase">{tool.phase}</span>
      <span class="tool-desc">{tool.description}</span>
    </label>
  {/each}

  <h4>MCP サーバー</h4>
  <div class="mcp-server-input">
    <input type="text" bind:value={mcpServerUrl} placeholder="http://localhost:3100/mcp" />
    <input type="text" bind:value={mcpServerName} placeholder="サーバー名" />
    <button type="button" on:click={connectMcpServer} disabled={connecting}>
      {connecting ? "接続中..." : "接続"}
    </button>
  </div>

  {#if mcpTools.length > 0}
    <h4>MCP ツール（{mcpTools.length}件）</h4>
    {#each mcpTools as tool}
      <div class="mcp-tool-card">
        <span class="tool-name">{tool.title}</span>
        <span class="tool-desc">{tool.description}</span>
        <span class="mcp-badge">MCP</span>
      </div>
    {/each}
  {/if}
</section>
```

---

## Task 159: ブラウザ自動化のツール化

### 既存の `copilot-browser.ts` をツールとして登録

```rust
// tool_init.rs に追加
registry.register(
    ToolRegistration {
        id: "browser.send_to_copilot".into(),
        title: "Copilot にプロンプト送信".into(),
        description: "Edge の M365 Copilot にプロンプトを送信し応答を取得".into(),
        phase: ToolPhase::Read,
        requires_approval: false,
        source: ToolSource::Builtin,
        parameter_schema: Some(json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string" }
            },
            "required": ["prompt"]
        })),
        mcp_server_url: None,
    },
    Box::new(|_args| {
        // ブラウザ操作は非同期のため、ここでは直接実行しない
        // フロントエンドの sendToCopilot を経由する
        Err("browser tools must be invoked via frontend runtime".to_string())
    }),
);
```

**注意:** ブラウザ自動化はフロントエンドの Playwright/CDP 経由で動作するため、
Rust バックエンドから直接実行はできない。ツールレジストリにはメタデータのみ登録し、
実行は `AgentLoopRuntime.sendToCopilot` 経由のまま維持する。

レジストリの目的は RelayPacket の `allowedReadTools` / `allowedWriteTools` 生成時に
利用可能なツール一覧を動的に取得することにある。

---

## 実装順序

1. **Task 155** — 設計ドキュメント
2. **Task 156** — ToolRegistry trait + ビルトインツール登録 + ディスパッチ移行
3. **Task 157** — MCP クライアント + ツール発見・登録
4. **Task 159** — ブラウザ自動化のメタデータ登録
5. **Task 158** — ツール管理 UI

## 検証チェックリスト

- [ ] `cargo build` がエラーなくパスすること
- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] ビルトインツールがレジストリ経由で実行されること
- [ ] `list_tools` コマンドで全ツール一覧が返ること
- [ ] MCP サーバー未登録でも従来通り動作すること（リグレッションなし）
- [ ] MCP サーバー接続時にツールが自動発見・登録されること
- [ ] MCP ツールが承認ゲート経由で実行されること
- [ ] ツール管理 UI でビルトインツールの有効/無効が切り替えられること
- [ ] RelayPacket 生成時にレジストリからツール一覧が取得されること
