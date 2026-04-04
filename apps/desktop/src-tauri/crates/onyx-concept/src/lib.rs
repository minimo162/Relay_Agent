#![allow(
    clippy::pedantic,
    clippy::must_use_candidate,
    clippy::return_self_not_must_use,
    clippy::field_reassign_with_default,
    clippy::redundant_closure,
    clippy::empty_line_after_doc_comments,
    clippy::needless_raw_string_hashes,
    clippy::doc_markdown,
    clippy::cast_possible_wrap,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::unnecessary_fallible_conversions,
    clippy::manual_flatten,
    clippy::items_after_statements,
    clippy::result_large_err,
)]

//! Relay_Agent の内部的な \"Onyx Concept\" — ナレッジ横断検索の概念レイヤ。
//!
//! 外部サービス（Vespa/Docker）は使わず、既存の SQLite FTS5 を軸に
//! ローカルファイル → インデックス → コンテキスト注入 を完結させる。

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

pub use connector::{ConnectorConfig, DataSource, LocalFileConnector};
pub use document::Document;
pub use index::{IndexStats, KnowledgeIndex};
pub use router::ContextRouter;
