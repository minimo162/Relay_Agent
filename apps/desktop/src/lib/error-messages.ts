export type FriendlyError = {
  message: string;
  hint?: string;
  icon: string;
};

const ERROR_MAP: Array<{ pattern: RegExp; result: FriendlyError }> = [
  {
    pattern: /ECONNREFUSED.*922[0-9]|CDP_UNAVAILABLE/i,
    result: {
      icon: "🔌",
      message: "Edge が CDP モードで起動していません。",
      hint: "設定モーダルの CDP ガイドを開いて、Edge を 9222 ポートで起動してください。"
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
