# Opencode Alignment Improvement Plan

Date: 2026-04-23
Reference upstream: https://github.com/anomalyco/opencode.git
Scope: Agent loop / Copilot CDP bridge / repair pipeline

本書は、直近のライブセッション（M365 Copilot CDP 経由、session `session-67f4a2da-a92c-4899-9086-de6234aefafa`）で観測された "tool を呼ばず幻覚回答 → repair で同一 tool 呼び出しを繰り返す → 新規チャット化でツール結果が消失" という失敗パターンを、opencode の実装思想に寄せて解消するための改善計画である。

`PLANS.md` / `AGENTS.md` / `docs/IMPLEMENTATION.md` / `docs/CLAW_CODE_ALIGNMENT.md` の補助ドキュメントとして位置付け、本プラン単独でスコープを広げない。各フェーズ完了時は `docs/IMPLEMENTATION.md` に検証ログを追記する。

---

## 1. 観測された症状（2026-04-23 ライブログ）

request_chain と stage_label で整理した失敗連鎖：

| # | stage | request_chain | 主な事象 |
|---|---|---|---|
| 1 | `original` | `cdp-inline-2c2d7d1c…` | prompt 11,484 chars、grounding 891 / system 7,746 / user 69 chars。**tool 呼び出しゼロで 836 chars の具体ファイル名入り回答を生成**（`local_search_without_tools=true`）。 |
| 2 | `repair1` | `cdp-inline-93204b6a…` | `office_search` 呼び出し成功 → 320 candidates、27 results、6 errors、69.4 s |
| 3 | `repair1`（続き） | `cdp-inline-1c0db831…` | 直前と**同一入力**の `office_search` を再要求 → `runtime::synthesized no-op for duplicate tool call` で抑止 → ターン停止 |
| 4 | `original` (meta-nudge) | `cdp-inline-16bfb807…` | `relayNewChat=true` が投入され、既存セッションなのに `reason= ignored_relay_new_chat_for_existing_session` をログしつつ**新規チャットを起動**。その新チャット内で "検索結果は空、またはエラーのみ" と誤った結論。 |
| 5 | `repair3` | `cdp-inline-3e06ce36…` | さらに同一入力の `office_search` を生成。repair 段が 3/3 まで消費される。 |

post-turn 分類の要旨：
- `local_search_without_tools=true` が初回と meta-nudge 後で連発。
- `repeated_office_search_after_results=true`（`retry.rs:1740`）はトリガーされているが、**repair プロンプト側が入力を変化させられない**ため同じ call が再発射される。
- `relayNewChat` と "既存セッション継続" の挙動差で、ツール結果コンテキストが Copilot スレッド側で分岐する。

---

## 2. opencode との主な差分

opencode は `packages/opencode/src/agent/agent.ts` + `packages/opencode/src/session/{prompt,processor}.ts` + `packages/opencode/src/tool/*.ts` で、

- ツール定義 / 入力スキーマ / システムプロンプトがモジュール単位で自己完結
- `ai` SDK による provider-agnostic ストリームで、1 ターンのツール結果は**必ず同一メッセージ系列**で次プロンプトに含まれる
- doom-loop 検出は event stream を監視する簡潔な閾値（`DOOM_LOOP_THRESHOLD`）
- "new chat" のような会話ライフサイクル管理はなく、UI 側の session ID だけで接続

対して Relay_Agent は Copilot CDP にネイティブ依存しており、以下の 3 点が opencode 的挙動を阻害している。

### A. Copilot セッションと repair の二重管理

- `apps/desktop/src-tauri/binaries/copilot_server.js:1283-1285` で `relayNewChat` を "既存セッションでは無視" とログしながら、直後に `starting new chat...`（`copilot_server.js` describe 経路）へ進むケースがある。
- 結果、**LLM 側 assistant message に保持された tool_result は Relay の runtime メモリ上にはあるが、Copilot スレッド側の履歴からは失われる**。repair2/3 で "no results" と返ってくるのはこのため。
- opencode には "browser タブの state" 相当が無いため、この種の競合が発生しない。

### B. 同一入力 tool call の dedup が "変形して再試行" に繋がらない

- `apps/desktop/src-tauri/crates/runtime/src/conversation.rs:436` / `:457` の `synthesized no-op` は正しく抑止するが、repair プロンプト側（`apps/desktop/src-tauri/src/agent_loop/retry.rs:1740`, `:1880` 近傍の `build_office_search_tool_call` 系）が**prior tool result を入力として受け取らず**、ユーザ原文だけからパターンを再導出している。
- そのため `pattern="キャッシュフロー"`, `paths=["**"]`, `include_ext=…`, `max_results=30` が毎ターン完全一致し、dedup ヒットするだけで前進しない。
- opencode では grep/glob などの粒度の細かいツールを **モデル自身が結果を見て選び直す**ため、同じ入力が再生産される頻度が低い（かつ dedup も敢えて実装していない）。

### C. `Standard` / `Repair` flavor の prompt 構成が、前ターン tool_result を十分透過させていない

- `apps/desktop/src-tauri/src/agent_loop/prompt.rs` の `CdpPromptFlavor::{Standard,Repair}` で、Repair 時の `tool_result_chars=0, tool_result_count=0`（ログ 03:57:33 時点）のように、**前ターンの tool_result をプロンプトに載せない repair 経路が残っている**。
- 結果、meta-nudge の "original" で `relayNewChat` が立ち、Copilot 側で新チャット化 → 初期の grounding + system + ユーザテキストだけで判断 → 再び "tool を呼ばない / 幻覚" となる。
- opencode は `session/prompt.ts` で会話履歴を常に付与するため、同種の逸脱は構造的に発生しづらい。

---

## 3. 改善アクション（優先度順）

### P0. Repair 時に `relayNewChat` を強制 `false` にする

- 変更ファイル: `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs`（CDP リクエスト組立箇所）, `apps/desktop/src-tauri/binaries/copilot_server.js:1243`, `:1283`
- 変更内容:
  - `stage_label` が `repair1` / `repair2` / `repair3` または `repair_replay_attempt > 1` のときは、送信 payload で `relay_new_chat=false` を明示し、Node bridge は `relayNewChat` フラグそのものを参照しない（確実にスレッド継続）。
  - meta-nudge 由来の `original` 再投入時も、同一 `session_id` が既に Copilot スレッドを持っているなら `relay_new_chat=false`。
- 期待効果: ログ #4 の `ignored_relay_new_chat_for_existing_session` が出ない経路に一本化し、tool_result が見えない空チャット再実行を排除。
- 検証: `apps/desktop/src-tauri/src/agent_loop_smoke.rs` に、原→repair1→repair3 の連鎖で**新規チャット URL 遷移が発生しない**ことを assert する回帰テストを追加。

### P1. `office_search` repair を "入力変化必須" に縛る

- 変更ファイル: `apps/desktop/src-tauri/src/agent_loop/retry.rs`（`build_office_search_tool_call` 周辺、`:1740`–`:1900`）, `apps/desktop/src-tauri/crates/runtime/src/conversation.rs:436`–`:484`
- 変更内容:
  1. `build_office_search_tool_call` に直前 tool_result の要約（candidate_count / results / errors / files_truncated）を渡し、
     - `files_truncated=true` → `max_files` を 80 → 160、`max_results` を 30 → 50 へ
     - `results=0` かつ `errors>0` → `include_ext` を段階的に絞る / `paths` を親ディレクトリへ一段昇格
     - `results>0` かつ **モデルが空回答** → 次ターンは `office_search` ではなく `read_file`（上位 k 件）への切替えを prompt で明示
  2. conversation.rs の dedup 判定キーを `(tool_name, stable_canonical_input_signature)` から `(tool_name, pattern, paths_root)` へ緩和し、`max_files` / `max_results` 変更は "前進" とみなす（抑止しない）。
  3. dedup で抑止した場合は `suppression_reason` フィールドを runtime → retry に伝え、retry 側はそれを見て "次は別ツール or 別戦略" に分岐（opencode の tool-plan 切替に相当）。
- 期待効果: ログ #3, #5 の同一 call 再発射が構造的に起きなくなる。
- 検証: `orchestrator.rs` の既存 `repeated_office_search_after_results_escalates_to_summary_repair` テストを拡張し、"2 回目 office_search は入力が必ず変化している" ことを検査。

### P2. Repair prompt に前ターン tool_result を必ず同梱する

- 変更ファイル: `apps/desktop/src-tauri/src/agent_loop/prompt.rs`（`CdpPromptFlavor::Repair` の message 構築）, `apps/desktop/src-tauri/src/agent_loop/orchestrator.rs`（prompt 組立て関数）
- 変更内容:
  - Repair flavor で `tool_result_chars=0, tool_result_count=0` になる経路を廃し、**最新 tool_result（上限 4 KB、上位 N 件）を必ず含める**。長大なら `results_truncated=true` のメタ情報付きで要約を添付する（opencode の compaction 風）。
  - 現在 Standard でのみ grounding に統合されている catalog（`catalog_chars=2766`）は Repair でも共通化し、"ツール結果あり → 次アクション" を明示する system 命令を追加。
- 期待効果: meta-nudge 後に新チャット化しても、前ターン結果の視界が保たれるため "no results" 誤回答が消える。
- 検証: `agent_loop_smoke.rs` で repair1/3 送信 payload を caputre し、`tool_result_count >= 1` を assert。

### P3. 初回ターンの "tool 未呼び出し" を opencode の must-tool ルーティングで矯正

- 変更ファイル: `apps/desktop/src-tauri/src/agent_loop/prompt.rs`, `apps/desktop/src-tauri/src/agent_loop/retry.rs`
- 変更内容:
  - `local_search_without_tools=true` が分類された時点で、**現在の meta-nudge 3 回制ではなく、"最初の repair は必ず tool 呼び出しテンプレート" にフォールバック**（opencode の tool-first build agent 相当）。
  - `prompt.rs` の Standard system prompt 末尾に、opencode の "Search before answering" 指令を追加（shared-drive root 探索や office_search の具体呼び出し例を 1 ブロック以内で）。長文にはせず、`system_chars` の増分は +500 程度に抑える。
- 期待効果: ログ #1 の "ユーザテキスト 69 chars に対して 11,484 chars の prompt を消費しつつ tool を呼ばない" 挙動を削減。
- 検証: 既存の agent_loop smoke テストに "first turn without tool call = classified as meta_stall" の assertion を追加。

### P4. `synthesized no-op` を LLM 側に透過させるサイクル抑止

- 変更ファイル: `apps/desktop/src-tauri/crates/runtime/src/conversation.rs:457` 近傍, `apps/desktop/src-tauri/src/agent_loop/retry.rs`
- 変更内容:
  - 抑止された tool call を、次プロンプトの user message に "Relay suppressed a duplicate call with input = {signature}; pick a different tool/input or finalize" と明示する注入を、Standard/Repair 両方で行う。
  - 連続 2 回以上 `repeated_office_search_after_results` が発火したら repair ループは**短絡して最終応答テンプレート**に遷移し、"ヒットしなかった側の原因仮説 + 次の推奨アクション" をユーザへ返す（doom-loop 抑止、opencode `DOOM_LOOP_THRESHOLD` 相当）。
- 期待効果: 3/3 まで repair を消費して "結果空" と誤回答するパスを閉じる。
- 検証: `cargo test -p runtime` に conversation dedup の注入メッセージ回帰テストを追加。

### P5. ツール定義の opencode 的モジュール化（将来、P0–P4 完了後）

- 変更ファイル: `apps/desktop/src-tauri/crates/tools/` 配下の再整理、`apps/desktop/src/lib/ipc.ts` スキーマ同期
- 変更内容:
  - opencode `packages/opencode/src/tool/{glob,grep,read,list}.ts` に相当する形で、`office_search` / `read_file` / `grep_search` / `list_dir` を "入力スキーマ + 説明 + 実行" で自己完結化。
  - retry.rs の特例分岐（`has_successful_office_search_tool_result` 系）を、tool 側の post-hook 差し替えで表現する。
- 期待効果: agent_loop 側の特殊ケースが減り、次世代エージェント（plan / explore など）を追加しやすい。
- 検証: `cargo check --workspace`、`pnpm check`、既存 compat-harness を green のまま維持。

---

## 4. フェーズ計画

| Phase | 対象 | 完了条件 | 見積 |
|---|---|---|---|
| 1 | P0 + P2 | smoke テストで repair 連鎖時に新チャットが発生せず、tool_result が repair prompt に含まれることを確認 | 1–2 日 |
| 2 | P1 | `build_office_search_tool_call` が prior result を受け取り、入力が必ず変化することを unit + smoke で証明 | 2–3 日 |
| 3 | P3 + P4 | first-turn tool-first 矯正と dedup シグナル透過を retry.rs に組込み、`meta_nudges_used` 上限 3 未満でも解決率が向上 | 2–3 日 |
| 4 | P5 | tools crate の opencode 的再編、agent_loop 側特例の縮小 | 5–7 日 |

各フェーズの Acceptance は以下を共通で満たすこと：

- `pnpm check`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --exclude relay-agent-desktop`
- `pnpm agent-loop:test`
- Windows smoke（`pnpm smoke:windows`）で 2026-04-23 再現シナリオ（"キャッシュフロー作成" タスク）を 1 turn + 1 repair で収束

---

## 5. 非対象 / ガードレール

- `relay_new_chat` そのものの削除はしない（UI からの明示的 "新規チャット" ボタンは P0 後も有効）。
- opencode 由来の provider-agnostic `ai` SDK 置換は本プランの対象外（Copilot CDP 経路を維持）。
- VBA 実行、未承認 shell、外部ネットワーク任意実行は依然禁止（`PLANS.md` の MVP Guardrails に準拠）。
- スコープ拡張時は `PLANS.md` を更新し、理由を `docs/IMPLEMENTATION.md` に記録する。

---

## 6. オープンな確認事項

- P1 の "dedup キー緩和" と P4 の "suppressed 注入" の組合せで、ユーザから見た総 tool 呼び出し回数が増え過ぎないか（`TURN_LOCAL_SEARCH_TOOL_LIMIT` との整合）。
- Repair flavor の catalog 同梱（P2）が Copilot 側の prompt 長上限 / `paste_elapsed_ms` に与える影響（現状 repair3 は 7,500 chars、Standard は 12,686 chars）。
- P3 の "must-tool" 指令を Japanese / English 両対応にするか、grounding 側のロケール分岐に寄せるか。

以上を `docs/IMPLEMENTATION.md` の "2026-04-23" ミルストンとして取り込み、Phase 1 から着手することを提案する。
