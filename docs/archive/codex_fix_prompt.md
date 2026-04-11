# Relay Agent — Copilot Live E2E 不具合修正プロンプト

作成日: 2026-04-02
対象: Windows 側 Codex
参照: `docs/E2E_COPILOT_LIVE_REPORT.md` の Fail 9 件

---

## 修正の原則

- 各修正は最小限の変更で行う
- 既存テストを壊さない（`cargo test` 104 tests / `pnpm typecheck` が引き続きパスすること）
- 修正後に `pnpm -C apps/desktop check` がエラーなしであること
- 新しいファイルは作成しない（既存ファイルの修正のみ）

---

## Fix 1: パイプライン・バッチの実行エラーが握りつぶされている（E-1, F-1）

### 原因

`pipeline.rs:210-212` と `batch.rs:172-174` で、バックグラウンドタスクのエラーが `let _` で捨てられている。
UI にエラーが伝わらないため「実行開始」が何も起きないように見える。

### 修正箇所 1-A: `apps/desktop/src-tauri/src/pipeline.rs`

`pipeline_run` 関数内（現在 210-212 行付近）:

```rust
// 修正前
tauri::async_runtime::spawn(async move {
    let _ = run_pipeline(app, &pipeline_id).await;
});
```

↓ 以下に書き換え:

```rust
tauri::async_runtime::spawn(async move {
    if let Err(e) = run_pipeline(app.clone(), &pipeline_id).await {
        let _ = app.emit("pipeline:step_update", serde_json::json!({
            "pipelineId": pipeline_id,
            "error": e.to_string()
        }));
    }
});
```

### 修正箇所 1-B: `apps/desktop/src-tauri/src/batch.rs`

`batch_run` 関数内（現在 172-174 行付近）:

```rust
// 修正前
tauri::async_runtime::spawn(async move {
    let _ = run_batch(app, &batch_id).await;
});
```

↓ 以下に書き換え:

```rust
tauri::async_runtime::spawn(async move {
    if let Err(e) = run_batch(app.clone(), &batch_id).await {
        let _ = app.emit("batch:target_update", serde_json::json!({
            "batchId": batch_id,
            "error": e.to_string()
        }));
    }
});
```

### 追加確認

`run_pipeline()` と `run_batch()` の中で、入力ファイルが見つからない場合の早期 return パスが `Ok(())` を返しているか確認する。
`mark_pipeline_failed()` / `mark_batch_target_failed()` を呼んだ直後に `pipeline:step_update` / `batch:target_update` イベントを emit していることを確認する。
既に emit しているなら修正不要だが、emit していない箇所があれば追加する。

---

## Fix 2: ガイドモードで `fast` ポリシーの自動承認が無視されている（H-3）

### 原因

`apps/desktop/src/routes/+page.svelte:3627-3643` で、`preview.autoApproved` のチェックが `uiMode === "delegation"` の場合のみ行われている。
ガイドモード（非デリゲーション）ではこの分岐に入らないため、`fast` ポリシーでも常に手動承認を待つ。

### 修正箇所: `apps/desktop/src/routes/+page.svelte`

`handleCopilotStage()` 関数内（現在 3626 行付近、`guidedStage = "review-save"` 直後）:

```typescript
// 修正前
guidedStage = "review-save";

if (uiMode === "delegation") {
  if (preview.autoApproved) {
    delegationStore.resumeExecution();
    pushDelegationEvent("write_approved", "現在の承認ポリシーで自動承認されました。", {
      detail: `${preview.approvalPolicy} / ${preview.highestRisk}`,
      badgeLabel: "自動承認済み"
    });
    await handleReviewSaveStage();
    return;
  } else {
    delegationStore.requestApproval();
    // ...
  }
}
```

↓ delegation ブロックの **前に** ガイドモード用の自動承認チェックを追加する:

```typescript
guidedStage = "review-save";

// ガイドモードでもポリシーベースの自動承認を適用
if (uiMode !== "delegation" && preview.autoApproved) {
  await handleReviewSaveStage();
  return;
}

if (uiMode === "delegation") {
  // ... 既存コードはそのまま ...
}
```

---

## Fix 3: 承認ポリシーが再起動後にリセットされる（H-4）

### 原因

`+page.svelte` の `onMount` 内（3912 行付近）で、フロントエンドの localStorage から `approvalPolicy` をロードした後、`getApprovalPolicy()` でバックエンドのデフォルト値（`safe`）を取得し、それでフロントエンドの保存値を上書きしている可能性が高い。

### 修正箇所: `apps/desktop/src/routes/+page.svelte`

`onMount` 内（3912 行付近〜3924 行付近）:

```typescript
// 修正前
approvalPolicy = saveApprovalPolicy(loadApprovalPolicy());
// ...（他の初期化）
await getApprovalPolicy();    // ← バックエンドのデフォルト値で上書きしている可能性
await syncApprovalPolicy();
```

↓ `getApprovalPolicy()` を削除し、フロントエンド → バックエンド方向の同期のみ行う:

```typescript
// 修正後
approvalPolicy = saveApprovalPolicy(loadApprovalPolicy());
// ...（他の初期化）
// バックエンドへフロントエンドの保存値を同期（逆方向の読み取りは行わない）
await syncApprovalPolicy();
```

`getApprovalPolicy()` 呼び出しを削除する。フロントエンドの localStorage が信頼できるソースオブトゥルースである。

### 追加: `apps/desktop/src/lib/continuity.ts`

`normalizeApprovalPolicy()` 関数（743-745 行付近）にデバッグログを追加:

```typescript
// 修正前
function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  return value === "standard" || value === "fast" ? value : DEFAULT_APPROVAL_POLICY;
}

// 修正後
function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  if (value === "standard" || value === "fast") {
    return value;
  }
  if (value !== undefined && value !== null && value !== DEFAULT_APPROVAL_POLICY) {
    console.warn(`[continuity] unexpected approvalPolicy value: ${JSON.stringify(value)}, falling back to "${DEFAULT_APPROVAL_POLICY}"`);
  }
  return DEFAULT_APPROVAL_POLICY;
}
```

---

## Fix 4: PII 警告が Step 2 遷移時に表示されない（I-1）

### 原因

`+page.svelte:2612-2625` で `assessCopilotHandoff()` を呼んでいるが、結果の `status` / `headline` / `reasons` を UI に表示していない。

### 修正箇所: `apps/desktop/src/routes/+page.svelte`

#### 4-A: 状態変数を追加（ファイル上部のリアクティブ変数宣言付近）

```typescript
let handoffCaution: { headline: string; reasons: Array<{ text: string; source: string }> } | null = null;
```

#### 4-B: `handleSetupStage()` 内で結果を保存（`assessCopilotHandoff` 呼び出し付近、2612-2625 行）

```typescript
// 修正前
const handoff = await assessCopilotHandoff({ sessionId, turnId });
// ... handoff の結果を planningContext にだけ使用

// 修正後
const handoff = await assessCopilotHandoff({ sessionId, turnId });
if (handoff.status === "caution") {
  handoffCaution = { headline: handoff.headline, reasons: handoff.reasons };
} else {
  handoffCaution = null;
}
// ... 既存の planningContext 利用コードはそのまま
```

#### 4-C: Step 2 の UI に警告カードを追加（テンプレート内の Step 2 ヘッダー直後、4617-4625 行付近）

Step 2 セクション（`2. Copilot に聞く` のヘッダー直後）に以下を挿入:

```svelte
{#if handoffCaution}
  <div class="caution-card" role="alert">
    <span class="caution-icon">⚠️</span>
    <div class="caution-content">
      <div class="caution-headline">{handoffCaution.headline}</div>
      <ul class="caution-reasons">
        {#each handoffCaution.reasons as reason}
          <li>{reason.text}（{reason.source}）</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
```

#### 4-D: スタイルを追加（`<style>` ブロック内）

```css
.caution-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.85rem;
  border-radius: 12px;
  border: 1px solid #e2b15d;
  background: #fff9ef;
  margin-bottom: 0.75rem;
}

.caution-icon {
  font-size: 1.1rem;
  line-height: 1;
}

.caution-content {
  min-width: 0;
}

.caution-headline {
  font-weight: 600;
  margin-bottom: 0.35rem;
}

.caution-reasons {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--ra-text-muted);
  font-size: 0.85rem;
}
```

---

## Fix 5: 自動送信タイムアウト時の UI フィードバック不安定（C-2）

### 原因

`copilot-browser.ts`（Node スクリプト）が短いタイムアウトの場合、CDP 接続段階でタイムアウトし `RESPONSE_TIMEOUT` ではなく CDP エラーを返す。
フロントエンドで CDP エラーとタイムアウトエラーのどちらが来ても統一的に処理する必要がある。

### 修正箇所: `apps/desktop/src/routes/+page.svelte`

`handleCopilotAutoSend()` 関数内の自動送信エラーハンドリング部分で、タイムアウト関連のエラーコードを統一的に処理する:

```typescript
// エラーハンドリング部分に以下のパターンを追加（既存の catch ブロック内）
} catch (error) {
  const err = toError(error);
  const msg = typeof err === "string" ? err : err.message ?? "";

  // タイムアウト系エラーを統一的にフォールバック案内へ
  if (msg.includes("RESPONSE_TIMEOUT") || msg.includes("CDP") || msg.includes("タイムアウト")) {
    validationFeedback = "Copilot の応答待機がタイムアウトしました。手動でコピー＆ペーストしてください。";
    isSendingToCopilot = false;
  } else {
    errorMsg = err;
  }
}
```

---

## Fix 6: セッション復元が再起動後に機能しない（J-2）

### 原因

パッケージアプリの再起動時に、バックエンドのストレージ初期化が完了する前にフロントエンドがセッション一覧を読み取ろうとしている可能性。
または、Fix 3 と同じ原因でバックエンドの初期値がフロントエンドの保存値を上書きしている。

### 修正箇所: `apps/desktop/src/routes/+page.svelte`

`onMount` 内で `startup()` コマンドの完了を待ってからセッション一覧を読む:

```typescript
// onMount 内で startup 完了後にセッション読み取りを行っているか確認する
const startupResult = await startup();  // バックエンド初期化完了を待つ
// startup 完了後にセッション・最近のファイル一覧を読む
```

これは調査的な修正のため、まず `console.log` で以下を確認すること:

1. `startup()` の戻り値（正常初期化されているか）
2. `readSessions()` の戻り値（空配列か、呼び出し自体が行われていないか）
3. `loadRecentFiles()` の戻り値（localStorage に保存されているか）

切り分け結果に基づいて修正を行い、`docs/E2E_COPILOT_LIVE_REPORT.md` の J-2 を更新する。

---

## 検証手順

すべての修正後、以下を順番に実行:

```powershell
# 1. Svelte チェック
pnpm -C apps/desktop check

# 2. Rust テスト
cargo test --manifest-path apps\desktop\src-tauri\Cargo.toml

# 3. TypeScript 型チェック
pnpm typecheck

# 4. ビルド確認
pnpm -C apps/desktop exec tauri build --no-bundle
```

さらに、修正した各シナリオを `docs/E2E_COPILOT_LIVE_REPORT.md` で再テストし、結果を更新する:

| Fix | 再テスト対象シナリオ |
|-----|---------------------|
| Fix 1 | E-1, F-1 |
| Fix 2 | H-3 |
| Fix 3 | H-4 |
| Fix 4 | I-1 |
| Fix 5 | C-2 |
| Fix 6 | J-2 |

---

## 修正完了チェックリスト

- [ ] Fix 1: `pipeline.rs` / `batch.rs` でバックグラウンドエラーを emit するよう修正
- [ ] Fix 2: `+page.svelte` でガイドモードの自動承認を有効化
- [ ] Fix 3: `+page.svelte` の `onMount` から `getApprovalPolicy()` を削除し永続化を修正
- [ ] Fix 4: `+page.svelte` に PII 警告カードを追加
- [ ] Fix 5: `+page.svelte` でタイムアウトエラーの統一処理を追加
- [ ] Fix 6: `+page.svelte` でセッション復元タイミングを調査・修正
- [ ] `pnpm -C apps/desktop check` がエラーなしであること
- [ ] `cargo test` が 104 テスト以上パスすること
- [ ] `pnpm typecheck` がエラーなしであること
- [ ] `docs/E2E_COPILOT_LIVE_REPORT.md` の該当シナリオが更新されていること
