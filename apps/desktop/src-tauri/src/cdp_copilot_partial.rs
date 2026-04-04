#![allow(clippy::result_large_err, clippy::items_after_statements)]

//! CDP-driven M365 Copilot client.
//!
//! Automatically launches a dedicated Edge instance on a free port,
//! keeping it separate from the user's personal browser.

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};
use tracing::info;
use tungstenite::Message;
