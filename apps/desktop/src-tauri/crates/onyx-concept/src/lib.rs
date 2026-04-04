/// Relay_Agent の内部的な "Onyx Concept" — ナレッジ横断検索の概念レイヤ。
///
/// 外部サービス（Vespa/Docker）は使わず、既存の SQLite FTS5 を軸に
/// ローカルファイル → インデックス → コンテキスト注入 を完結させる。

mod connector;
mod document;
mod index;
mod router;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("index error: {0}")]
    IndexError(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

pub use connector::{ConnectorConfig, LocalFileConnector};
pub use document::Document;
pub use index::{IndexStats, KnowledgeIndex};
pub use router::ContextRouter;

pub use connector::DataSource;
