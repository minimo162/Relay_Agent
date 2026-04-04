use serde::Serialize;

/// インデックスに登録されたドキュメントの単位
#[derive(Debug, Clone, Serialize)]
pub struct Document {
    /// 一意のID（SQLite rowid）
    pub id: Option<i64>,
    /// データソース名（例: "local_files", "github", "web"）
    pub source: String,
    /// ソース内での識別子（例: ファイルパス）
    pub doc_id: String,
    /// ドキュメントのタイトル
    pub title: Option<String>,
    /// ドキュメントの本文
    pub content: String,
    /// メタデータ（JSON文字列）
    pub metadata: Option<String>,
    /// 検索スコア（FTS5 bm25 結果）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

impl Document {
    pub fn new(
        source: impl Into<String>,
        doc_id: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            id: None,
            source: source.into(),
            doc_id: doc_id.into(),
            title: None,
            content: content.into(),
            metadata: None,
            score: None,
        }
    }

    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn with_metadata(mut self, metadata: impl Into<String>) -> Self {
        self.metadata = Some(metadata.into());
        self
    }

    pub fn with_score(mut self, score: f64) -> Self {
        self.score = Some(score);
        self
    }

    /// UI表示用に内容を省略したスニペットを返す
    pub fn snippet(&self, max_len: usize) -> String {
        if self.content.len() <= max_len {
            self.content.clone()
        } else {
            let s = &self.content[..max_len];
            format!("{}...", s.trim_end())
        }
    }
}
