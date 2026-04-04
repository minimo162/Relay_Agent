use crate::document::Document;
use crate::index::KnowledgeIndex;

/// コンテキストルーター — 複数データソースにまたがって
/// クエリに関連するドキュメントを収集・ランキングする。
pub struct ContextRouter {
    index: KnowledgeIndex,
    default_top_k: usize,
}

impl ContextRouter {
    pub fn new(index: KnowledgeIndex) -> Self {
        Self {
            index,
            default_top_k: 5,
        }
    }

    pub fn with_top_k(mut self, k: usize) -> Self {
        self.default_top_k = k;
        self
    }

    /// クエリに対してインデックスから関連ドキュメントを取得
    pub async fn route(&self, query: &str) -> anyhow::Result<Vec<Document>> {
        self.route_with_limit(query, self.default_top_k).await
    }

    /// 件数指定付きでルート
    pub async fn route_with_limit(
        &self,
        query: &str,
        top_k: usize,
    ) -> anyhow::Result<Vec<Document>> {
        Ok(self.index.search(query, top_k).await?)
    }

    /// 検索結果をプロンプト用コンテキスト文字列に変換
    pub fn format_as_context(docs: &[Document], max_chars: usize) -> String {
        if docs.is_empty() {
            return "No relevant documents found.".to_string();
        }

        let mut ctx = String::from("## Knowledge Base Context\n\n");
        let mut remaining = max_chars.saturating_sub(ctx.len());

        for (i, doc) in docs.iter().enumerate() {
            let header = format!(
                "### Document {} (source: {}, doc: {})\n",
                i + 1,
                doc.source,
                doc.doc_id
            );
            if header.len() > remaining {
                break;
            }
            ctx.push_str(&header);
            remaining -= header.len();

            let snippet = doc.snippet(remaining.saturating_sub(2));
            ctx.push_str(&snippet);
            ctx.push_str("\n\n");
            remaining = remaining.saturating_sub(snippet.len() + 2);

            if remaining < 50 {
                break;
            }
        }

        ctx
    }

    /// インデックス統計を取得
    pub async fn stats(&self) -> anyhow::Result<crate::index::IndexStats> {
        Ok(self.index.stats().await?)
    }
}
