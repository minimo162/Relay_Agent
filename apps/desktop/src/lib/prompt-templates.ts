export function buildProjectContext(
  customInstructions = "",
  memory: Array<{ key: string; value: string }> = []
): string {
  const sections: string[] = [];

  if (customInstructions.trim()) {
    sections.push("## プロジェクト指示", customInstructions.trim());
  }

  if (memory.length > 0) {
    sections.push(
      "## 学習済み設定",
      memory.map((entry) => `- ${entry.key}: ${entry.value}`).join("\n")
    );
  }

  return sections.join("\n");
}
