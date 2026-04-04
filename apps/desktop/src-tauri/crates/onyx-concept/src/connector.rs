use std::path::PathBuf;

use serde::Serialize;

use crate::document::Document;
use crate::index::KnowledgeIndex;

/// データソース接続用の設定構造体
#[derive(Debug, Clone, Serialize)]
pub struct ConnectorConfig {
    pub source_name: String,
    pub root_path: PathBuf,
    pub file_globs: Vec<String>,
    pub chunk_size_bytes: usize,
    pub skip_patterns: Vec<String>,
}

impl Default for ConnectorConfig {
    fn default() -> Self {
        Self {
            source_name: "local_files".into(),
            root_path: PathBuf::from("."),
            file_globs: vec![
                "**/*.rs".into(),
                "**/*.ts".into(),
                "**/*.tsx".into(),
                "**/*.md".into(),
                "**/*.txt".into(),
                "**/*.json".into(),
                "**/*.yaml".into(),
                "**/*.yml".into(),
                "**/*.toml".into(),
            ],
            chunk_size_bytes: 4_096,
            skip_patterns: vec![
                "**/node_modules/**".into(),
                "**/target/**".into(),
                "**/.git/**".into(),
                "**/dist/**".into(),
                "**/build/**".into(),
            ],
        }
    }
}

/// データソースのインターフェース
///
/// 実装を追加するだけで新しいソース（GitHub, Web, MCP等）を接続可能。
pub trait DataSource: Send + Sync {
    /// ソースの識別名（例: "local_files", "github_repo"）
    fn name(&self) -> &str;

    /// ドキュメントをインデックスに取り込む
    fn ingest<'a>(
        &'a self,
        index: &'a KnowledgeIndex,
    ) -> impl std::future::Future<Output = crate::Result<usize>> + Send + 'a;

    /// このソースに対して検索を実行
    fn search<'a>(
        &'a self,
        query: &'a str,
        top_k: usize,
        index: &'a KnowledgeIndex,
    ) -> impl std::future::Future<Output = crate::Result<Vec<Document>>> + Send + 'a;
}

/// ローカルファイルシステムをデータソースとして扱うコネクタ
pub struct LocalFileConnector {
    config: ConnectorConfig,
}

impl LocalFileConnector {
    pub fn new(root: impl Into<PathBuf>, globs: &[&str]) -> Self {
        let mut config = ConnectorConfig::default();
        config.root_path = root.into();
        config.file_globs = globs.iter().map(|s| s.to_string()).collect();
        Self { config }
    }

    pub fn with_config(config: ConnectorConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &ConnectorConfig {
        &self.config
    }
}

impl DataSource for LocalFileConnector {
    fn name(&self) -> &str {
        &self.config.source_name
    }

    async fn ingest(&self, index: &KnowledgeIndex) -> crate::Result<usize> {
        use tracing::{debug, info, warn};
        use walkdir::WalkDir;

        info!(
            source = self.name(),
            root = %self.config.root_path.display(),
            "Starting local file ingestion"
        );

        let mut count = 0usize;

        for entry in WalkDir::new(&self.config.root_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let path = e.path().to_string_lossy();
                !self
                    .config
                    .skip_patterns
                    .iter()
                    .any(|p| path.contains(p.trim_start_matches("**/").trim_end_matches("/**")))
            })
        {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!("WalkDir error: {e}");
                    continue;
                }
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();

            // 拡張子で判定
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let matched_ext = self.config.file_globs.iter().any(|g| g.ends_with(&format!(".{ext}")));
            if !matched_ext {
                continue;
            }

            // ファイルサイズのチェック（1MB超過はスキップ）
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 1_048_576 {
                    debug!(path = %path.display(), "Skipping large file (>1MB)");
                    continue;
                }
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => {
                    warn!(path = %path.display(), "Failed to read file: {e}");
                    continue;
                }
            };

            let chunk_size = self.config.chunk_size_bytes;
            let chunks = if content.len() <= chunk_size {
                vec![content]
            } else {
                chunk_text(&content, chunk_size)
            };

            for (i, chunk) in chunks.iter().enumerate() {
                let doc_id = if chunks.len() > 1 {
                    format!("{}#chunk{}", path.display(), i)
                } else {
                    path.display().to_string()
                };

                let title = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string());
                let doc = match title {
                    Some(t) => Document::new(self.name(), doc_id, chunk).with_title(t),
                    None => Document::new(self.name(), doc_id, chunk),
                };

                if let Err(e) = index.insert(&doc).await {
                    warn!(doc_id = %doc.doc_id, "Failed to index document: {e}");
                } else {
                    count += 1;
                }
            }
        }

        info!(source = self.name(), count, "Ingestion complete");
        Ok(count)
    }

    async fn search(
        &self,
        query: &str,
        top_k: usize,
        index: &KnowledgeIndex,
    ) -> crate::Result<Vec<Document>> {
        index.search(query, top_k).await
    }
}

/// テキストをチャンクに分割（UTF-8境界 + 改行/空白を優先）
fn chunk_text(content: &str, chunk_size: usize) -> Vec<String> {
    if content.len() <= chunk_size {
        return vec![content.to_string()];
    }

    let mut chunks = Vec::new();
    let bytes = content.as_bytes();
    let mut start = 0;

    while start < bytes.len() {
        let end = (start + chunk_size).min(bytes.len());
        if end >= bytes.len() {
            let chunk = std::str::from_utf8(&bytes[start..]).unwrap_or("").to_string();
            if !chunk.trim().is_empty() {
                chunks.push(chunk);
            }
            break;
        }

        // UTF-8 境界に合わせる
        let mut split = end;
        loop {
            if std::str::from_utf8(&bytes[start..split]).is_ok() {
                break;
            }
            split -= 1;
        }

        // 空白・改行境界まで後戻り
        let mut candidate = split;
        for i in (start..=candidate).rev() {
            if bytes[i] == b'\n' || bytes[i] == b' ' {
                candidate = i + 1;
                break;
            }
        }

        if candidate <= start {
            candidate = split;
        }

        let chunk = std::str::from_utf8(&bytes[start..candidate])
            .unwrap_or("")
            .to_string();

        if !chunk.trim().is_empty() {
            chunks.push(chunk);
        }

        start = candidate;
    }

    if chunks.is_empty() {
        chunks.push(content.to_string());
    }

    chunks
}
