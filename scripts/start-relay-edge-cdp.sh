#!/usr/bin/env bash
# Relay Agent / copilot_server が接続する Microsoft Edge を、固定 CDP ポートで先に起動する。
# Rust 側は ~/RelayAgentEdgeProfile/DevToolsActivePort を読み既存 CDP を再利用する。
#
# 環境変数:
#   DISPLAY              既定 :1
#   RELAY_EDGE_CDP_PORT  既定 9333（agent_loop の既定と一致）
#   RELAY_EDGE_PROFILE   既定 ~/RelayAgentEdgeProfile
set -euo pipefail

DISPLAY="${DISPLAY:-:1}"
export DISPLAY
PORT="${RELAY_EDGE_CDP_PORT:-9333}"
PROFILE="${RELAY_EDGE_PROFILE:-$HOME/RelayAgentEdgeProfile}"
LOG="${RELAY_EDGE_LOG:-$HOME/.local/log/relay-edge-cdp.log}"

mkdir -p "$(dirname "$LOG")" "$PROFILE"

if ! xdpyinfo >/dev/null 2>&1; then
  echo "[start-relay-edge-cdp] DISPLAY=$DISPLAY に接続できません。先に Xvfb 等を起動してください。" >&2
  exit 1
fi

if curl -sS -m 1 "http://127.0.0.1:${PORT}/json/version" 2>/dev/null | grep -qi edg; then
  echo "[start-relay-edge-cdp] 既に CDP が http://127.0.0.1:${PORT} で応答しています"
  exit 0
fi

EDGE=""
for c in microsoft-edge-stable microsoft-edge; do
  if command -v "$c" >/dev/null 2>&1; then EDGE="$c"; break; fi
done
if [[ -z "$EDGE" ]]; then
  echo "[start-relay-edge-cdp] Microsoft Edge が見つかりません。" >&2
  exit 1
fi

echo "[start-relay-edge-cdp] Edge を起動します (CDP ${PORT}, profile ${PROFILE})…"
nohup "$EDGE" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins=* \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-gpu \
  --disable-gpu-compositing \
  --disable-restore-session-state \
  "https://m365.cloud.microsoft/chat/" \
  >>"$LOG" 2>&1 &

for _ in $(seq 1 45); do
  sleep 1
  if curl -sS -m 2 "http://127.0.0.1:${PORT}/json/version" 2>/dev/null | grep -qi edg; then
    echo "[start-relay-edge-cdp] 準備完了: http://127.0.0.1:${PORT}"
    exit 0
  fi
done

echo "[start-relay-edge-cdp] タイムアウト: ログを確認してください → $LOG" >&2
exit 1
