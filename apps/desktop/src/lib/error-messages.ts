export type FriendlyError = {
  message: string;
  hint?: string;
  icon: string;
};

const ERROR_MAP: Array<{ pattern: RegExp; result: FriendlyError }> = [
  {
    pattern: /All CDP ports.*in use|9333.*9342.*使用中/i,
    result: {
      icon: "🔌",
      message: "ポート 9333-9342 がすべて使用中です。",
      hint: "他のアプリケーションを終了してから再試行してください。"
    }
  },
  {
    pattern: /Edge launched but CDP did not respond/i,
    result: {
      icon: "⏱",
      message: "Edge は起動しましたが CDP 接続が確立できませんでした。",
      hint: "少し待ってから再試行してください。"
    }
  },
  {
    pattern: /ENOENT.*msedge|msedge.*not found|Failed to launch Edge/i,
    result: {
      icon: "🌐",
      message: "Edge が見つかりません。",
      hint: "Microsoft Edge がインストールされているか確認してください。"
    }
  },
  {
    pattern: /ECONNREFUSED.*(922[0-9]|933[3-9]|934[0-2])|CDP_UNAVAILABLE/i,
    result: {
      icon: "🔌",
      message: "Edge の CDP 接続を確認できませんでした。",
      hint: "設定モーダルで自動起動を有効にするか、CDP ガイドのコマンドで Edge を起動してください。"
    }
  },
  {
    pattern: /timeout|timed.?out|RESPONSE_TIMEOUT/i,
    result: {
      icon: "⏱",
      message: "Copilot の応答待ちで時間がかかりすぎました。",
      hint: "Edge の接続状態を確認してから、もう一度お試しください。"
    }
  },
  {
    pattern: /maximum.?turns|max.*turns|最大ターン数/i,
    result: {
      icon: "🔄",
      message: "最大ターン数に達しました。",
      hint: "目的を少し具体的にするか、設定で最大ターン数を増やしてください。"
    }
  },
  {
    pattern: /validation.*error|zod.*error|schema|invalid_json|invalid_status/i,
    result: {
      icon: "⚠️",
      message: "Copilot の返答形式が想定と異なります。",
      hint: "もう一度試すか、手動モードで JSON を貼り付けてください。"
    }
  },
  {
    pattern: /cancelled|abort|キャンセル/i,
    result: {
      icon: "⏹",
      message: "処理をキャンセルしました。"
    }
  }
];

export function getFriendlyError(raw: string | Error): FriendlyError {
  const message =
    raw instanceof Error ? `${raw.message} ${raw.stack ?? ""}` : raw;

  for (const { pattern, result } of ERROR_MAP) {
    if (pattern.test(message)) {
      return result;
    }
  }

  return {
    icon: "⚠️",
    message: "エラーが発生しました。",
    hint: raw instanceof Error ? raw.message : raw
  };
}
