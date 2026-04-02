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
    gap: var(--sp-3);
  }

  .file-op-card {
    border: 1px solid var(--c-border-strong);
    border-radius: 12px;
    padding: var(--sp-4);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }

  .file-op-card:hover {
    border-color: var(--c-border-strong);
    box-shadow: var(--shadow-md);
  }

  .file-op-header {
    display: flex;
    gap: var(--sp-3);
    align-items: center;
  }

  .file-op-icon {
    min-width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--r-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--sz-xs);
    font-weight: 700;
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    border: 2px solid rgba(13,148,136,0.20);
    flex-shrink: 0;
  }

  .file-op-title {
    display: grid;
    gap: var(--sp-1);
  }

  .file-op-title strong {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
  }

  .file-op-tool {
    color: var(--c-text-3);
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
  }

  .file-op-details {
    margin: var(--sp-3) 0 0;
    padding-left: var(--sp-5);
    color: var(--c-text-2);
    font-size: var(--sz-sm);
    line-height: 1.5;
  }

  .file-op-details li {
    padding: var(--sp-1) 0;
  }

  .file-op-details li::marker {
    color: var(--c-text-3);
  }
</style>
