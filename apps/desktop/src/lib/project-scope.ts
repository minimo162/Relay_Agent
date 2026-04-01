export type ProjectScopeAction = {
  tool: string;
  args: Record<string, unknown>;
};

function normalizeScopedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isWithinProjectScope(filePath: string, rootFolder: string): boolean {
  const normalizedFile = normalizeScopedPath(filePath);
  const normalizedRoot = normalizeScopedPath(rootFolder);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

export function extractActionFilePaths(action: ProjectScopeAction): string[] {
  const candidates = [
    action.args.path,
    action.args.sourcePath,
    action.args.destPath,
    action.args.outputPath
  ];

  return candidates.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
}

export function validateProjectScopeActions(
  actions: ProjectScopeAction[],
  rootFolder: string
): string[] {
  const normalizedRoot = rootFolder.trim();
  if (!normalizedRoot) {
    return [];
  }

  const violations: string[] = [];

  for (const action of actions) {
    for (const filePath of extractActionFilePaths(action)) {
      if (isWithinProjectScope(filePath, normalizedRoot) || violations.includes(filePath)) {
        continue;
      }

      violations.push(filePath);
    }
  }

  return violations;
}
