#!/usr/bin/env bash
# Relay Agent を Linux 上で M365 Copilot（Edge CDP）付きで開発起動する。
#
# 前提:
#   - Microsoft Edge for Linux（microsoft-edge-stable 等）
#   - pnpm install 済み
#   - 仮想/実ディスプレイ（Xvfb 等）— Copilot 用 Edge は GUI を必要とする
#
# 使い方:
#   ./scripts/relay-copilot-linux.sh
#
# 環境変数:
#   DISPLAY          既に X があればそのまま利用（例 :0, :1）
#   DISPLAY_NUM      未設定時に start-x11 を使う場合の表示番号（既定 :1）
#   RELAY_START_X11  仮想デスクトップ起動スクリプト（既定: $HOME/novnc-m365/start-x11-desktop.sh）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DISPLAY_NUM="${DISPLAY_NUM:-:1}"
START_X11="${RELAY_START_X11:-$HOME/novnc-m365/start-x11-desktop.sh}"

if [[ -z "${DISPLAY:-}" ]]; then
  if [[ -x "$START_X11" ]]; then
    echo "[relay-copilot-linux] DISPLAY なし → $START_X11 を実行します"
    "$START_X11"
    export DISPLAY="$DISPLAY_NUM"
  else
    echo "[relay-copilot-linux] エラー: DISPLAY が未設定です。" >&2
    echo "  実ディスプレイなら:  export DISPLAY=:0" >&2
    echo "  または Xvfb 用に RELAY_START_X11=/path/to/start-x11-desktop.sh を指定してください。" >&2
    exit 1
  fi
fi

if ! xdpyinfo >/dev/null 2>&1; then
  echo "[relay-copilot-linux] エラー: DISPLAY=$DISPLAY に接続できません（xdpyinfo 失敗）" >&2
  exit 1
fi

if ! command -v microsoft-edge-stable >/dev/null 2>&1 && ! command -v microsoft-edge >/dev/null 2>&1; then
  echo "[relay-copilot-linux] エラー: Microsoft Edge が見つかりません。" >&2
  echo "  https://www.microsoft.com/edge を参照して Linux 用 Edge を入れてください。" >&2
  exit 1
fi

PROFILE="$HOME/RelayAgentEdgeProfile"
echo "[relay-copilot-linux] DISPLAY=$DISPLAY"
echo "[relay-copilot-linux] Edge プロファイル（アプリ / copilot_server が使用）: $PROFILE"
echo "[relay-copilot-linux] 初回はこの Edge で M365 にサインインしてください（noVNC の Chromium とは別プロファイルです）。"

# Edge を先に立てておくと DevToolsActivePort 経由で Rust / Node が既存 CDP を再利用しやすい
if [[ "${RELAY_PRESTART_EDGE:-1}" == "1" ]]; then
  if [[ -x "$ROOT/scripts/start-relay-edge-cdp.sh" ]]; then
    "$ROOT/scripts/start-relay-edge-cdp.sh" || echo "[relay-copilot-linux] 警告: Edge 先起動に失敗しました（アプリ側の自動起動に任せます）" >&2
  fi
fi

cd "$ROOT/apps/desktop"
exec pnpm exec tauri dev
