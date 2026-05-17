import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createAdversarialDciCorpus(workspace) {
  const files = {
    guide: "notes/aftermarket-glossary.md",
    companyDecoy: "companies/Mパーツ.md",
    priorPeriod: "archive/fy159/aftermarket-reference.md",
    generic: "notes/generic-sales.md",
    noEvidence: "notes/no-evidence.md",
    gold: "finance/q4/source-a.md",
    contextWindowGold: "finance/q4/context-window.md",
    csvGold: "finance/q4/parts-sales.csv",
  };

  mkdirSync(join(workspace, "notes"), { recursive: true });
  mkdirSync(join(workspace, "companies"), { recursive: true });
  mkdirSync(join(workspace, "archive", "fy159"), { recursive: true });
  mkdirSync(join(workspace, "finance", "q4"), { recursive: true });

  writeFileSync(join(workspace, files.guide), [
    "# 用語ガイド",
    "アフター系の数字は、サービス部品、補修部品、パーツ事業の実績という言い換えで再検索します。",
    "このガイド自体は根拠資料ではありません。",
  ].join("\n"), "utf8");
  writeFileSync(join(workspace, files.companyDecoy), [
    "# Mパーツ",
    "Mパーツは会社名です。会社プロフィールであり、部品売上の根拠ではありません。",
  ].join("\n"), "utf8");
  writeFileSync(join(workspace, files.priorPeriod), [
    "# FY159 reference",
    "過年度の補修部品売上メモ。FY159の参考資料であり今期根拠ではありません。",
  ].join("\n"), "utf8");
  writeFileSync(join(workspace, files.generic), "売上高の一般メモ。部品の文脈はありません。\n", "utf8");
  writeFileSync(join(workspace, files.noEvidence), "該当なし。候補確認用の空メモです。\n", "utf8");
  writeFileSync(join(workspace, files.gold), [
    "# FY160 4Q source memo",
    "アフター系の確定根拠: FY160 4Q 国内サービス部品、補修部品、パーツ事業の売上実績はこのファイルの集計表に基づく。",
    "確定版として、parts sales と service parts revenue の根拠行を保持する。",
  ].join("\n"), "utf8");
  writeFileSync(join(workspace, files.contextWindowGold), [
    "# Context window evidence",
    "FY160 4Q 国内サービス部品の確定根拠。",
    "関連する補修部品とパーツ事業も同じ表に含む。",
    "売上実績は月次集計から転記されています。",
  ].join("\n"), "utf8");
  writeFileSync(join(workspace, files.csvGold), [
    "period,segment,metric,value",
    "FY160-4Q,service parts,parts sales,12345",
  ].join("\n"), "utf8");

  return {
    files,
    goldPaths: [files.gold, files.contextWindowGold, files.csvGold],
    hardNegativePaths: [files.companyDecoy, files.priorPeriod, files.generic, files.guide, files.noEvidence],
  };
}
