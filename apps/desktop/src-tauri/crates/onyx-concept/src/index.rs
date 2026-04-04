use rusqlite::{params, Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;

use crate::document::Document;

type Result<T> = std::result::Result<T, crate::Error>;

/// FTS5 ベースのナレッジインデックス
#[derive(Clone)]
pub struct KnowledgeIndex {
    db_path: String,
    conn: Arc<tokio::sync::Mutex<Connection>>,
}

impl KnowledgeIndex {
    /// データベースを開く（なければ作成 + スキーマ初期化）
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let db_path = path.as_ref().to_string_lossy().to_string();
        let conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| crate::Error::IndexError(e.to_string()))?;

        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| crate::Error::IndexError(e.to_string()))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| crate::Error::IndexError(e.to_string()))?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                doc_id TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                metadata TEXT,
                content_hash TEXT NOT NULL DEFAULT '',
                indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(source, doc_id)
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                title, content,
                content=documents,
                content_rowid=id,
                tokenize='unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
                INSERT INTO documents_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
                INSERT INTO documents_fts(documents_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
                INSERT INTO documents_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
            "#,
        )
        .map_err(|e| crate::Error::IndexError(e.to_string()))?;

        Ok(Self {
            db_path,
            conn: Arc::new(tokio::sync::Mutex::new(conn)),
        })
    }

    /// ドキュメントをインデックスに追加（upsert: ハッシュ差分ありのみ更新）
    pub async fn insert(&self, doc: &Document) -> Result<()> {
        let content = doc.content.clone();
        let title = doc.title.clone().unwrap_or_default();
        let source = doc.source.clone();
        let doc_id = doc.doc_id.clone();
        let metadata = doc.metadata.clone().unwrap_or_default();
        let hash = content_hash(&content);
        let conn_handle = self.conn.clone();

        tokio::task::spawn_blocking(move || {
            let mut conn = conn_handle.blocking_lock();

            let existing_hash: Option<String> = conn
                .query_row(
                    "SELECT content_hash FROM documents WHERE source = ?1 AND doc_id = ?2",
                    params![source.clone(), doc_id.clone()],
                    |row| row.get(0),
                )
                .ok();

            if existing_hash.as_deref() == Some(&hash) {
                return Ok::<_, crate::Error>(());
            }

            let tx = conn
                .transaction()
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            tx.execute(
                r#"
                INSERT INTO documents (source, doc_id, title, content, metadata, content_hash)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(source, doc_id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    metadata = excluded.metadata,
                    content_hash = excluded.content_hash,
                    indexed_at = CURRENT_TIMESTAMP
                "#,
                params![source, doc_id, title, content, metadata, hash],
            )
            .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            tx.commit()
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            Ok::<_, crate::Error>(())
        })
        .await
        .map_err(|e| crate::Error::IndexError(format!("tokio join error: {e}")))?
    }

    /// FTS5 で keyword 検索
    pub async fn search(&self, query: &str, top_k: usize) -> Result<Vec<Document>> {
        let query = query.to_string();
        let conn_handle = self.conn.clone();

        tokio::task::spawn_blocking(move || {
            let conn = conn_handle.blocking_lock();

            let fts_query = escape_fts_query(&query);

            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT d.id, d.source, d.doc_id, d.title, d.content, d.metadata,
                           documents_fts.rank as score
                    FROM documents d
                    JOIN documents_fts ON documents_fts.rowid = d.id
                    WHERE documents_fts MATCH ?1
                    ORDER BY documents_fts.rank
                    LIMIT ?2
                    "#,
                )
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            let rows = stmt
                .query_map(params![fts_query, top_k as i64], |row| {
                    Ok(Document {
                        id: row.get(0)?,
                        source: row.get(1)?,
                        doc_id: row.get(2)?,
                        title: row.get(3)?,
                        content: row.get(4)?,
                        metadata: row.get(5)?,
                        score: row.get(6)?,
                    })
                })
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(|e| crate::Error::IndexError(e.to_string()))
        })
        .await
        .map_err(|e| crate::Error::IndexError(format!("tokio join error: {e}")))?
    }

    /// インデックスの統計情報を取得
    pub async fn stats(&self) -> Result<IndexStats> {
        let conn_handle = self.conn.clone();

        tokio::task::spawn_blocking(move || {
            let conn = conn_handle.blocking_lock();

            let doc_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            let source_count: i64 = conn
                .query_row("SELECT COUNT(DISTINCT source) FROM documents", [], |row| {
                    row.get(0)
                })
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            let mut sources = std::collections::HashMap::new();
            let mut stmt = conn
                .prepare("SELECT source, COUNT(*) FROM documents GROUP BY source")
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            let rows = stmt
                .query_map([], |row| {
                    let source: String = row.get(0)?;
                    let count: i64 = row.get(1)?;
                    Ok((source, count))
                })
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            for row in rows {
                if let Ok((source, count)) = row {
                    sources.insert(source, count);
                }
            }

            Ok(IndexStats {
                doc_count: doc_count as usize,
                source_count: source_count as usize,
                sources,
            })
        })
        .await
        .map_err(|e| crate::Error::IndexError(format!("tokio join error: {e}")))?
    }

    /// ドキュメントを削除
    pub async fn delete(&self, source: &str, doc_id: &str) -> Result<bool> {
        let source = source.to_string();
        let doc_id = doc_id.to_string();
        let conn_handle = self.conn.clone();

        tokio::task::spawn_blocking(move || {
            let conn = conn_handle.blocking_lock();
            let affected: usize = conn
                .execute(
                    "DELETE FROM documents WHERE source = ?1 AND doc_id = ?2",
                    params![source, doc_id],
                )
                .map_err(|e| crate::Error::IndexError(e.to_string()))?;

            Ok(affected > 0)
        })
        .await
        .map_err(|e| crate::Error::IndexError(format!("tokio join error: {e}")))?
    }
}

/// インデックスの統計情報
#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexStats {
    pub doc_count: usize,
    pub source_count: usize,
    pub sources: std::collections::HashMap<String, i64>,
}

/// コンテンツのSHA256ハッシュ（変更検出用）
fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// FTS5 クエリ文字列のエスケープ
fn escape_fts_query(query: &str) -> String {
    let escaped = query
        .replace('"', "\"\"")
        .replace(':', "\\:")
        .replace('(', "\\(")
        .replace(')', "\\)");

    format!("\"{escaped}\"")
}
