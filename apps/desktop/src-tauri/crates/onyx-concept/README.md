# Onyx Concept — Knowledge Index for Relay_Agent

Inner-source Onyx concepts: connector trait, local file ingestion,
hybrid FTS5 indexing, and context routing — no external services.

## Features

- **`trait DataSource`** — pluggable connector interface; add a source
  by implementing `ingest()` and `search()`.
- **`LocalFileConnector`** — indexes files under a directory by glob.
- **`KnowledgeIndex`** — SQLite FTS5 backed keyword search.
- **`ContextRouter`** — scores and ranks documents across all sources.

## Usage

```rust
use onyx_concept::{KnowledgeIndex, LocalFileConnector, ContextRouter};

let db = KnowledgeIndex::open("knowledge.db")?;

let connector = LocalFileConnector::new("/project", &["**/*.rs", "**/*.md", "**/*.tsx"]);
connector.ingest(&db).await?;

let results = db.search("session management", 5).await?;
println!("Found {} documents", results.len());
```

## Schema

```sql
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    metadata TEXT,
    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, doc_id)
);

CREATE VIRTUAL TABLE documents_fts USING fts5(
    title, content,
    content=documents,
    content_rowid=id,
    tokenize='unicode61'
);
```
