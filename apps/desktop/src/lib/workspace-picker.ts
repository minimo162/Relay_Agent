import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function pickWorkspaceFolder(currentPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: currentPath.trim() || undefined,
  });
  return typeof selected === "string" ? selected : null;
}
