<script lang="ts">
  type FileOpPreviewAction = {
    tool: string;
    args: Record<string, unknown>;
  };

  export let actions: FileOpPreviewAction[] = [];

  type FileOpSummary = {
    tool: string;
    label: string;
    icon: string;
    details: string[];
  };

  function asText(value: unknown): string {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }

    if (typeof value === "number") {
      return String(value);
    }

    return "未指定";
  }

  function summarize(action: FileOpPreviewAction): FileOpSummary {
    const args = action.args;

    switch (action.tool) {
      case "file.copy":
        return {
          tool: action.tool,
          label: "ファイルコピー",
          icon: "Copy",
          details: [
            `コピー元: ${asText(args.sourcePath)}`,
            `コピー先: ${asText(args.destPath)}`,
            args.overwrite ? "上書きあり" : "上書きなし"
          ]
        };
      case "file.move":
        return {
          tool: action.tool,
          label: "ファイル移動",
          icon: "Move",
          details: [
            `移動元: ${asText(args.sourcePath)}`,
            `移動先: ${asText(args.destPath)}`,
            args.overwrite ? "上書きあり" : "上書きなし"
          ]
        };
      case "file.delete":
        return {
          tool: action.tool,
          label: "ファイル削除",
          icon: "Delete",
          details: [
            `対象: ${asText(args.path)}`,
            args.toRecycleBin !== false ? "ゴミ箱へ移動" : "完全削除"
          ]
        };
      case "text.replace":
        return {
          tool: action.tool,
          label: "テキスト置換",
          icon: "Regex",
          details: [
            `対象: ${asText(args.path)}`,
            `パターン: ${asText(args.pattern)}`,
            `置換: ${asText(args.replacement)}`,
            args.createBackup !== false ? "バックアップ作成" : "バックアップなし"
          ]
        };
      default:
        return {
          tool: action.tool,
          label: action.tool,
          icon: "File",
          details: [JSON.stringify(args)]
        };
    }
  }
</script>

{#if actions.length > 0}
  <div class="file-op-list">
    {#each actions as action}
      {@const summary = summarize(action)}
      <article class="file-op-card">
        <div class="file-op-header">
          <span class="file-op-icon">{summary.icon}</span>
          <div class="file-op-title">
            <strong>{summary.label}</strong>
            <span class="file-op-tool">{summary.tool}</span>
          </div>
        </div>
        <ul class="file-op-details">
          {#each summary.details as detail}
            <li>{detail}</li>
          {/each}
        </ul>
      </article>
    {/each}
  </div>
{/if}

<style>
  .file-op-list {
    display: grid;
    gap: 0.75rem;
  }

  .file-op-card {
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    padding: 0.85rem;
    background: color-mix(in srgb, var(--ra-accent) 4%, var(--ra-surface));
  }

  .file-op-header {
    display: flex;
    gap: 0.65rem;
    align-items: center;
  }

  .file-op-icon {
    min-width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--ra-accent);
    background: color-mix(in srgb, var(--ra-accent) 12%, var(--ra-surface));
  }

  .file-op-title {
    display: grid;
    gap: 0.1rem;
  }

  .file-op-tool {
    color: var(--ra-text-muted);
    font-family: monospace;
    font-size: 0.76rem;
  }

  .file-op-details {
    margin: 0.75rem 0 0;
    padding-left: 1.2rem;
    color: var(--ra-text-muted);
    font-size: 0.88rem;
  }
</style>
