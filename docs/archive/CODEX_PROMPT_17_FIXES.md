# Codex プロンプト 17-FIX — ToolRegistry & MCP クライアント 修正（Tasks 155–159 フォロー）

## 背景

CODEX_PROMPT_17 の実装レビューで以下の問題が見つかった。
本プロンプトでこれらを修正する。

---

## Fix 1: 同期 `invoke()` 内の `block_on()` によるデッドロックリスク

### 問題

`tool_registry.rs` の `invoke()` は同期関数だが、MCP ツール呼び出し時に
`tauri::async_runtime::block_on()` を使用している:

```rust
// 現状（危険）
ToolHandler::Mcp { server, tool_name } => tauri::async_runtime::block_on(
    McpClient::new(server.clone()).call_tool(tool_name, args),
),
```

Tauri の async_runtime（tokio）のコンテキスト内でこれを呼ぶと
ネストした block_on になりデッドロックが発生する。

### 修正

**`tool_registry.rs`**: MCP ビルトインハンドラーを削除し、
レジストリの `invoke()` は builtin ツールのみを処理するよう限定する。

```rust
pub fn invoke(&self, tool_id: &str, args: &Value) -> Result<Value, String> {
    let entry = self.tools.get(tool_id)
        .ok_or_else(|| format!("unknown tool: {}", tool_id))?;

    if !entry.registration.enabled {
        return Err(format!("tool '{}' is disabled", tool_id));
    }

    match &entry.handler {
        ToolHandler::Builtin(h) => h.execute(args),
        ToolHandler::Mcp { .. } => {
            // MCP ツールは async コマンド経由で呼び出す必要がある
            Err(format!(
                "MCP tool '{}' must be invoked via invoke_mcp_tool command",
                tool_id
            ))
        }
    }
}
```

`invoke_mcp_tool` Tauri コマンドは既に `async fn` なので、そちらで直接
`McpClient::call_tool().await` を呼ぶ現状の実装（`execution.rs`）を維持する。

---

## Fix 2: `invoke_mcp_tool` の enabled チェック欠落

### 問題

`execution.rs` の `invoke_mcp_tool` コマンドがツールの `enabled` フラグを
確認せず実行する。

### 修正

**`execution.rs`** の `invoke_mcp_tool` に enabled チェックを追加:

```rust
pub async fn invoke_mcp_tool(
    storage: State<'_, Mutex<AppStorage>>,
    request: InvokeMcpToolRequest,
) -> Result<InvokeMcpToolResponse, String> {
    let (registration, server_url, transport, tool_name) = {
        let storage = storage.lock().unwrap();
        let reg = storage
            .tool_registry
            .get(&request.tool_id)
            .ok_or_else(|| format!("unknown tool: {}", request.tool_id))?;

        // ★ enabled チェックを追加
        if !reg.enabled {
            return Err(format!("tool '{}' is disabled", request.tool_id));
        }

        let server_url = reg.mcp_server_url.clone()
            .ok_or_else(|| format!("tool '{}' is not an MCP tool (no server URL)", request.tool_id))?;
        let transport = reg.mcp_transport.unwrap_or(McpTransport::Sse);
        // tool_name は tool_id の最後のセグメント
        let tool_name = parse_mcp_tool_name(&request.tool_id)?;
        (reg.clone(), server_url, transport, tool_name)
    };

    let client = McpClient::new(McpServerConfig {
        url: server_url,
        name: String::new(),
        transport,
    });

    let result = client.call_tool(&tool_name, &request.args).await?;

    Ok(InvokeMcpToolResponse {
        tool_id: request.tool_id,
        result,
        source: ToolSource::Mcp,
    })
}
```

---

## Fix 3: MCP tool_id パース失敗時のサイレントデフォルト

### 問題

`execution.rs` のツール名抽出で形式違反の `tool_id` を渡されたとき
エラーにならず誤った名前で MCP リクエストを送る。

### 修正

**`execution.rs`** に `parse_mcp_tool_name` ヘルパーを追加し、
形式違反を明示的エラーにする:

```rust
/// tool_id の形式: "mcp.{server_name}.{tool_name}"
/// tool_name 部分（最後のセグメント）を返す。
/// 形式が不正な場合はエラー。
fn parse_mcp_tool_name(tool_id: &str) -> Result<String, String> {
    let parts: Vec<&str> = tool_id.splitn(3, '.').collect();
    if parts.len() != 3 || parts[0] != "mcp" {
        return Err(format!(
            "invalid MCP tool_id '{}': expected format 'mcp.{{server}}.{{tool}}'",
            tool_id
        ));
    }
    Ok(parts[2].to_string())
}
```

`invoke_mcp_tool` 内でこのヘルパーを使用する（Fix 2 の修正コードに統合済み）。

---

## Fix 4: TypeScript 側の MCP フィールドバリデーション欠落

### 問題

`tool-runtime.ts` の `invokeRegisteredTool()` は `source === "mcp"` を確認するが、
`mcpServerUrl` / `mcpTransport` の存在チェックなしに IPC 呼び出しへ進む。

### 修正

**`apps/desktop/src/lib/tool-runtime.ts`** に pre-flight バリデーションを追加:

```typescript
export async function invokeRegisteredTool(
  tool: ToolRegistration,
  args: Record<string, unknown>,
  runtime: ToolRuntime,
): Promise<unknown> {
  if (tool.source === "builtin") {
    if (tool.id === "browser.send_to_copilot") {
      const prompt = String(args["prompt"] ?? "");
      return runtime.sendToCopilot(prompt);
    }
    throw new Error(
      `Built-in tool '${tool.id}' does not expose a desktop runtime executor`,
    );
  }

  if (tool.source === "mcp") {
    // ★ MCP フィールドのプリフライトバリデーション
    if (!tool.mcpServerUrl) {
      throw new Error(
        `MCP tool '${tool.id}' is missing mcpServerUrl`,
      );
    }
    if (!tool.enabled) {
      throw new Error(`Tool '${tool.id}' is disabled`);
    }

    const response = await runtime.invokeMcpTool({
      toolId: tool.id,
      args,
    });
    return response.result;
  }

  throw new Error(`Unknown tool source '${(tool as ToolRegistration).source}'`);
}
```

---

## Fix 5: MCP ツール呼び出しのタイムアウト

### 問題

`tool-runtime.ts` の MCP ツール呼び出しにタイムアウトがなく、
応答しないサーバーに対して無期限ブロックする。

### 修正

**`apps/desktop/src/lib/tool-runtime.ts`** に `withTimeout` ユーティリティを追加:

```typescript
const MCP_TOOL_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}
```

`invokeRegisteredTool` の MCP 分岐でラップ:

```typescript
const response = await withTimeout(
  runtime.invokeMcpTool({ toolId: tool.id, args }),
  MCP_TOOL_TIMEOUT_MS,
  `MCP tool '${tool.id}'`,
);
```

---

## Fix 6: テストカバレッジ拡充

### 問題

`tool-runtime.test.ts` がエラーケースをほぼカバーしていない。

### 修正

**`apps/desktop/src/lib/tool-runtime.test.ts`** に以下テストを追加:

```typescript
describe("invokeRegisteredTool — error cases", () => {
  it("throws when MCP tool has no mcpServerUrl", async () => {
    const tool = makeMcpTool({ mcpServerUrl: undefined });
    await expect(invokeRegisteredTool(tool, {}, mockRuntime)).rejects.toThrow(
      "missing mcpServerUrl",
    );
  });

  it("throws when MCP tool is disabled", async () => {
    const tool = makeMcpTool({ enabled: false });
    await expect(invokeRegisteredTool(tool, {}, mockRuntime)).rejects.toThrow(
      "disabled",
    );
  });

  it("throws for unknown builtin tool id", async () => {
    const tool = makeBuiltinTool({ id: "unknown.tool" });
    await expect(invokeRegisteredTool(tool, {}, mockRuntime)).rejects.toThrow(
      "does not expose",
    );
  });

  it("propagates MCP invocation errors", async () => {
    const failRuntime: ToolRuntime = {
      ...mockRuntime,
      invokeMcpTool: vi.fn().mockRejectedValue(new Error("server error")),
    };
    const tool = makeMcpTool();
    await expect(invokeRegisteredTool(tool, {}, failRuntime)).rejects.toThrow(
      "server error",
    );
  });
});
```

ヘルパー関数:

```typescript
function makeMcpTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    id: "mcp.test.my_tool",
    title: "Test Tool",
    description: "test",
    phase: "write",
    requiresApproval: true,
    source: "mcp",
    enabled: true,
    mcpServerUrl: "http://localhost:3100/mcp",
    mcpTransport: "sse",
    ...overrides,
  };
}

function makeBuiltinTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    id: "browser.send_to_copilot",
    title: "Copilot",
    description: "test",
    phase: "read",
    requiresApproval: false,
    source: "builtin",
    enabled: true,
    ...overrides,
  };
}
```

---

## 検証チェックリスト

- [ ] `cargo build` がエラーなくパス
- [ ] `pnpm -C packages/contracts build` がパス
- [ ] `pnpm -C apps/desktop test` が全テストパス（新規テストを含む）
- [ ] 無効化ツールを `invoke_mcp_tool` で呼ぶと "disabled" エラーが返る
- [ ] 形式不正の `tool_id` を渡すと明示的エラーが返る
- [ ] `mcpServerUrl` なしのツールで `invokeRegisteredTool` が throw する
- [ ] 既存のビルトインツール（workbook.inspect 等）が引き続き動作する（リグレッションなし）
