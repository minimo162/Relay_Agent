import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Microsoft Authenticator の「番号照合」: ブラウザに表示される2桁を読み取る。
 * 表示形式はテナント/言語で変わるため、既知の DOM とヒューリスティックの両方を使う。
 */
export async function readMicrosoftAuthenticatorMatchNumber(
  page: Page,
): Promise<string | null> {
  const url = page.url();
  if (!/login\.(microsoftonline|live)\.com|account\.live\.com|signup\.live\.com/i.test(url)) {
    return null;
  }

  return page.evaluate(() => {
    const byId = (id: string): string | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      const t = el.textContent?.trim().replace(/\s+/g, "") ?? "";
      if (/^\d{2}$/.test(t)) return t;
      const m = el.innerText?.match(/\b(\d{2})\b/);
      return m?.[1] && /^\d{2}$/.test(m[1]) ? m[1] : null;
    };

    for (const id of [
      "idSpan_SAOTCS_ProofConfirmation",
      "idRichContext_DisplaySign",
      "idDiv_SAOTCS_Title",
      "idSpan_SAOTCAS_Description",
    ]) {
      const v = byId(id);
      if (v) return v;
    }

    const body = document.body.innerText ?? "";
    const inContext =
      /Authenticator|Microsoft Authenticator|approve|sign-?in request|照合|番号|number|一致|enter the same number|同じ番号/i.test(
        body,
      );
    if (!inContext) return null;

    for (const sel of [
      '[role="heading"]',
      ".text-title",
      ".row.title",
      "div[data-bind]",
      "span",
      "div",
    ]) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.textContent ?? "").trim().replace(/\s+/g, "");
        if (!/^\d{2}$/.test(t)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize || "0");
        if (fs >= 20 || el.tagName === "H1" || el.tagName === "H2") return t;
      }
    }

    const lineMatch = body.match(/(?:^|\n)\s*(\d{2})\s*(?:\n|$)/m);
    return lineMatch?.[1] ?? null;
  });
}

let lastAnnounced: string | null = null;

/** ターミナルとファイルに2桁を出す（承認アプリに入力してもらう）。 */
export async function announceMicrosoftAuthenticatorMatchNumber(
  code: string,
  outDir: string,
): Promise<void> {
  if (lastAnnounced === code) return;
  lastAnnounced = code;

  await fs.promises.mkdir(outDir, { recursive: true });
  const custom = process.env.E2E_MATCH_NUMBER_OUT?.trim();
  const filePath = custom
    ? path.resolve(process.cwd(), custom)
    : path.join(outDir, "e2e-microsoft-authenticator-number.txt");

  await fs.promises.writeFile(filePath, `${code}\n`, "utf8");

  const banner = [
    "",
    "=".repeat(64),
    `[E2E] Microsoft Authenticator の通知で次の「2桁の番号」を入力して承認してください:  ${code}`,
    `[E2E] 上記をファイルにも保存しました: ${filePath}`,
    "=".repeat(64),
    "",
  ].join("\n");
  console.log(banner);
}
