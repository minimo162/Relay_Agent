use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use crate::pdf_liteparse;
use crate::tool_hard_denylist::reject_sensitive_file_path;

mod docx;
mod pptx;
mod xlsx;

pub const MAX_OFFICE_TEXT_BYTES: usize = 16 * 1024 * 1024;
const CACHE_SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocFormat {
    Docx,
    Xlsx,
    Pptx,
    Pdf,
}

impl DocFormat {
    fn from_extension(path: &Path) -> io::Result<Self> {
        match path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("docx") => Ok(Self::Docx),
            Some("xlsx") => Ok(Self::Xlsx),
            Some("pptx") => Ok(Self::Pptx),
            Some("pdf") => Ok(Self::Pdf),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unsupported Office search format; expected .docx, .xlsx, .pptx, or .pdf",
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Xlsx => "xlsx",
            Self::Pptx => "pptx",
            Self::Pdf => "pdf",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AnchoredText {
    pub anchor: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedDoc {
    pub source: PathBuf,
    pub format: DocFormat,
    pub anchors: Vec<AnchoredText>,
}

#[derive(Debug, Clone)]
struct Deadline {
    expires_at: Instant,
}

impl Deadline {
    fn from_now(duration: Duration) -> Self {
        Self {
            expires_at: Instant::now() + duration,
        }
    }

    fn check(&self) -> io::Result<()> {
        if Instant::now() >= self.expires_at {
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Office extraction deadline exceeded",
            ))
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct OfficeLimits {
    zip_max_entries: usize,
    zip_max_expanded_bytes: u64,
    zip_max_compression_ratio: u64,
    xml_max_depth: usize,
    xml_max_events: u64,
    docx_max_paragraphs: usize,
    xlsx_max_cells: usize,
    xlsx_archive_max_bytes: usize,
    xlsx_shared_strings_max_bytes: u64,
    xlsx_sheet_xml_max_bytes: u64,
    pptx_max_slides: usize,
}

impl OfficeLimits {
    fn from_env() -> Self {
        Self {
            zip_max_entries: env_usize("RELAY_OFFICE_ZIP_MAX_ENTRIES", 5_000, 1, 250_000),
            zip_max_expanded_bytes: env_u64(
                "RELAY_OFFICE_ZIP_MAX_EXPANDED_BYTES",
                256 * 1024 * 1024,
                1,
                4 * 1024 * 1024 * 1024,
            ),
            zip_max_compression_ratio: env_u64(
                "RELAY_OFFICE_ZIP_MAX_COMPRESSION_RATIO",
                200,
                1,
                1_000_000,
            ),
            xml_max_depth: env_usize("RELAY_OFFICE_XML_MAX_DEPTH", 256, 1, 16_384),
            xml_max_events: env_u64("RELAY_OFFICE_XML_MAX_EVENTS", 5_000_000, 1, 100_000_000),
            docx_max_paragraphs: env_usize(
                "RELAY_OFFICE_DOCX_MAX_PARAGRAPHS",
                200_000,
                1,
                10_000_000,
            ),
            xlsx_max_cells: env_usize("RELAY_OFFICE_XLSX_MAX_CELLS", 500_000, 1, 10_000_000),
            xlsx_archive_max_bytes: env_usize(
                "RELAY_OFFICE_XLSX_ARCHIVE_MAX_BYTES",
                256 * 1024 * 1024,
                1,
                2 * 1024 * 1024 * 1024,
            ),
            xlsx_shared_strings_max_bytes: env_u64(
                "RELAY_OFFICE_XLSX_SHARED_STRINGS_MAX_BYTES",
                64 * 1024 * 1024,
                1,
                2 * 1024 * 1024 * 1024,
            ),
            xlsx_sheet_xml_max_bytes: env_u64(
                "RELAY_OFFICE_XLSX_SHEET_XML_MAX_BYTES",
                128 * 1024 * 1024,
                1,
                2 * 1024 * 1024 * 1024,
            ),
            pptx_max_slides: env_usize("RELAY_OFFICE_PPTX_MAX_SLIDES", 2_000, 1, 100_000),
        }
    }
}

fn env_u64(name: &str, default: u64, min: u64, max: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

fn env_usize(name: &str, default: usize, min: usize, max: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(default)
}

fn parse_timeout() -> Duration {
    Duration::from_secs(env_u64("RELAY_OFFICE_PARSE_TIMEOUT_SECS", 120, 1, 3600))
}

fn max_concurrent_extractions() -> usize {
    let default = 4.min(num_cpus::get().saturating_sub(1).max(1));
    env_usize("RELAY_OFFICE_MAX_CONCURRENT_EXTRACTIONS", default, 1, 32)
}

fn global_semaphore() -> Arc<Semaphore> {
    static SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(max_concurrent_extractions())))
        .clone()
}

fn in_flight() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

struct InFlightReservation {
    key: String,
    active: bool,
}

impl InFlightReservation {
    fn reserve(key: String) -> io::Result<Self> {
        let mut slots = in_flight()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if slots.contains(&key) {
            return Err(io::Error::new(
                io::ErrorKind::ResourceBusy,
                "still cancelling or extracting previous Office extraction of this path",
            ));
        }
        slots.insert(key.clone());
        Ok(Self { key, active: true })
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for InFlightReservation {
    fn drop(&mut self) {
        if self.active {
            let mut slots = in_flight()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            slots.remove(&self.key);
        }
    }
}

pub fn extract_with_timeout(path: &Path) -> io::Result<ParsedDoc> {
    let canonical = fs::canonicalize(path)?;
    let path_hash = path_hash(&canonical);
    let mut reservation = InFlightReservation::reserve(path_hash.clone())?;
    let permit = global_semaphore().try_acquire_owned().map_err(|_| {
        io::Error::new(
            io::ErrorKind::ResourceBusy,
            "extraction concurrency cap reached; retry later",
        )
    })?;
    let timeout = parse_timeout();
    let (tx, rx) = mpsc::channel();
    let worker_key = path_hash.clone();
    let worker_path = canonical.clone();
    let deadline = Deadline::from_now(timeout);
    let handle = thread::spawn(move || {
        let result = extract_uncached(&worker_path, &deadline);
        let _ = tx.send(result);
        drop(permit);
        let mut slots = in_flight()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        slots.remove(&worker_key);
    });
    reservation.disarm();

    match rx.recv_timeout(timeout) {
        Ok(result) => {
            let _ = handle.join();
            result
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            thread::spawn(move || {
                let _ = handle.join();
            });
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!(
                    "Office parse exceeded RELAY_OFFICE_PARSE_TIMEOUT_SECS; path={}",
                    canonical.display()
                ),
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = handle.join();
            Err(io::Error::other("Office extraction worker disconnected"))
        }
    }
}

pub fn extract(path: &Path) -> io::Result<ParsedDoc> {
    load_or_extract(path)
}

fn extract_uncached(path: &Path, deadline: &Deadline) -> io::Result<ParsedDoc> {
    let format = DocFormat::from_extension(path)?;
    let limits = OfficeLimits::from_env();
    let anchors = match format {
        DocFormat::Docx => docx::extract(path, &limits, deadline)?,
        DocFormat::Xlsx => xlsx::extract(path, &limits, deadline)?,
        DocFormat::Pptx => pptx::extract(path, &limits, deadline)?,
        DocFormat::Pdf => {
            let text = pdf_liteparse::read_pdf_as_payload(path, None)?;
            vec![AnchoredText {
                anchor: String::from("doc"),
                text,
            }]
        }
    };
    validate_total_text_bytes(&anchors)?;
    Ok(ParsedDoc {
        source: path.to_path_buf(),
        format,
        anchors,
    })
}

fn validate_total_text_bytes(anchors: &[AnchoredText]) -> io::Result<()> {
    let total = anchors.iter().map(|anchor| anchor.text.len()).sum::<usize>();
    if total > MAX_OFFICE_TEXT_BYTES {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("anchor text exceeds MAX_OFFICE_TEXT_BYTES={MAX_OFFICE_TEXT_BYTES}"),
        ))
    } else {
        Ok(())
    }
}

pub fn read_docx_as_text(path: &Path) -> io::Result<String> {
    let parsed = load_or_extract(path)?;
    Ok(format!(
        "[DOCX text — zip+xml extraction; images/charts/SmartArt omitted; embedded tabs/newlines in values normalized]\n\n{}",
        serialize_docx(&parsed.anchors)
    ))
}

pub fn read_xlsx_as_text(path: &Path, sheets: Option<&str>) -> io::Result<String> {
    let parsed = load_or_extract(path)?;
    let requested = parse_csv_filter(sheets);
    validate_xlsx_sheets(&parsed.anchors, requested.as_ref())?;
    Ok(format!(
        "[XLSX text — calamine extraction; cell values with formatting best-effort; formulas fallback; embedded tabs/newlines in values normalized]\n\n{}",
        serialize_xlsx(&parsed.anchors, requested.as_ref())
    ))
}

pub fn read_pptx_as_text(path: &Path, slides: Option<&str>) -> io::Result<String> {
    let parsed = load_or_extract(path)?;
    let requested = parse_slide_filter(slides)?;
    validate_pptx_slides(&parsed.anchors, requested.as_ref())?;
    Ok(format!(
        "[PPTX text — zip+xml extraction; slides + notes; images/charts omitted; embedded tabs/newlines in values normalized]\n\n{}",
        serialize_pptx(&parsed.anchors, requested.as_ref())
    ))
}

fn normalize_line(text: &str) -> String {
    text.replace(['\t', '\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn serialize_docx(anchors: &[AnchoredText]) -> String {
    let mut out = Vec::new();
    let mut current_region = String::new();
    for anchor in anchors {
        let region = anchor
            .anchor
            .split_once(':')
            .map_or("", |(prefix, _)| {
                if prefix.starts_with("header") || prefix.starts_with("footer") {
                    prefix
                } else {
                    ""
                }
            });
        if !region.is_empty() && region != current_region {
            out.push(format!("--- {region} ---"));
            current_region = region.to_string();
        }
        let line = normalize_line(&anchor.text);
        if !line.is_empty() {
            out.push(line);
        }
    }
    out.join("\n")
}

fn serialize_xlsx(anchors: &[AnchoredText], sheets: Option<&BTreeSet<String>>) -> String {
    let mut out = Vec::new();
    let mut current_sheet = String::new();
    for anchor in anchors {
        let Some((sheet, _cell)) = anchor.anchor.split_once('!') else {
            continue;
        };
        if sheets.is_some_and(|set| !set.contains(sheet)) {
            continue;
        }
        if sheet != current_sheet {
            out.push(format!("--- sheet: {sheet} ---"));
            current_sheet = sheet.to_string();
        }
        let value = normalize_line(&anchor.text);
        if !value.is_empty() {
            out.push(format!("{}\t{}", anchor.anchor, value));
        }
    }
    out.join("\n")
}

fn serialize_pptx(anchors: &[AnchoredText], slides: Option<&BTreeSet<u32>>) -> String {
    let mut out = Vec::new();
    for anchor in anchors {
        let Some(slide) = slide_number_from_anchor(&anchor.anchor) else {
            continue;
        };
        if slides.is_some_and(|set| !set.contains(&slide)) {
            continue;
        }
        if anchor.anchor.ends_with(":notes") {
            out.push(format!("--- slide {slide} notes ---"));
        } else {
            out.push(format!("--- slide {slide} ---"));
        }
        for line in anchor.text.lines().map(normalize_line).filter(|s| !s.is_empty()) {
            out.push(line);
        }
    }
    out.join("\n")
}

fn parse_csv_filter(input: Option<&str>) -> Option<BTreeSet<String>> {
    input.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(ToString::to_string)
            .collect()
    })
}

fn parse_slide_filter(input: Option<&str>) -> io::Result<Option<BTreeSet<u32>>> {
    let Some(input) = input else {
        return Ok(None);
    };
    let mut set = BTreeSet::new();
    for part in input.split(',').map(str::trim).filter(|part| !part.is_empty()) {
        if let Some((start, end)) = part.split_once('-') {
            let start = start.trim().parse::<u32>().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range")
            })?;
            let end = end.trim().parse::<u32>().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range")
            })?;
            if start == 0 || end < start {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid slides range",
                ));
            }
            for slide in start..=end {
                set.insert(slide);
            }
        } else {
            let slide = part.parse::<u32>().map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range")
            })?;
            if slide == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "invalid slides range",
                ));
            }
            set.insert(slide);
        }
    }
    Ok(Some(set))
}

fn validate_xlsx_sheets(
    anchors: &[AnchoredText],
    requested: Option<&BTreeSet<String>>,
) -> io::Result<()> {
    let Some(requested) = requested else {
        return Ok(());
    };
    let available = anchors
        .iter()
        .filter_map(|anchor| anchor.anchor.split_once('!').map(|(sheet, _)| sheet.to_string()))
        .collect::<BTreeSet<_>>();
    let missing = requested
        .iter()
        .filter(|sheet| !available.contains(*sheet))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown sheet(s): {}", missing.join(", ")),
        ))
    }
}

fn validate_pptx_slides(
    anchors: &[AnchoredText],
    requested: Option<&BTreeSet<u32>>,
) -> io::Result<()> {
    let Some(requested) = requested else {
        return Ok(());
    };
    let available = anchors
        .iter()
        .filter_map(|anchor| slide_number_from_anchor(&anchor.anchor))
        .collect::<BTreeSet<_>>();
    let missing = requested
        .iter()
        .filter(|slide| !available.contains(slide))
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown slide(s): {missing:?}"),
        ))
    }
}

fn slide_number_from_anchor(anchor: &str) -> Option<u32> {
    anchor
        .strip_prefix("slide")?
        .split(':')
        .next()?
        .parse()
        .ok()
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OfficeSearchInput {
    pub pattern: String,
    pub paths: Vec<String>,
    #[serde(rename = "include_ext")]
    pub include_ext: Option<Vec<String>>,
    #[serde(rename = "-i")]
    pub case_insensitive: Option<bool>,
    pub context: Option<usize>,
    #[serde(rename = "max_results")]
    pub max_results: Option<usize>,
    #[serde(rename = "max_files")]
    pub max_files: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct OfficeSearchHit {
    pub path: String,
    pub anchor: String,
    #[serde(rename = "match")]
    pub matched: String,
    pub preview: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct OfficeSearchError {
    pub path: String,
    pub kind: String,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct OfficeSearchOutput {
    pub results: Vec<OfficeSearchHit>,
    pub errors: Vec<OfficeSearchError>,
    #[serde(rename = "filesScanned")]
    pub files_scanned: usize,
    #[serde(rename = "files_truncated")]
    pub files_truncated: bool,
    #[serde(rename = "results_truncated")]
    pub results_truncated: bool,
    #[serde(rename = "wall_clock_truncated")]
    pub wall_clock_truncated: bool,
}

#[allow(clippy::too_many_lines)]
pub fn office_search(input: &OfficeSearchInput) -> io::Result<OfficeSearchOutput> {
    let regex = RegexBuilder::new(&input.pattern)
        .case_insensitive(input.case_insensitive.unwrap_or(false))
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
    let include_ext = normalize_include_ext(input.include_ext.as_ref())?;
    let max_results = input.max_results.unwrap_or(100).clamp(1, 1_000);
    let max_files = input.max_files.unwrap_or(50).clamp(1, 1_000);
    let mut candidates = expand_office_candidates(&input.paths, &include_ext)?;
    candidates.sort();
    candidates.dedup();

    let files_truncated = candidates.len() > max_files;
    candidates.truncate(max_files);

    let started = Instant::now();
    let wall = Duration::from_secs(env_u64("RELAY_OFFICE_SEARCH_MAX_WALL_SECS", 600, 10, 3600));
    let parse_timeout = parse_timeout();
    let worker_count = candidates.len().min(max_concurrent_extractions()).max(1);
    let (work_tx, work_rx) = mpsc::sync_channel::<PathBuf>(0);
    let (result_tx, result_rx) = mpsc::channel::<(PathBuf, io::Result<ParsedDoc>)>();
    let work_rx = Arc::new(Mutex::new(work_rx));

    let mut handles = Vec::new();
    for _ in 0..worker_count {
        let work_rx = Arc::clone(&work_rx);
        let result_tx = result_tx.clone();
        handles.push(thread::spawn(move || {
            loop {
                let received = {
                    let rx = work_rx
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    rx.recv()
                };
                let Ok(path) = received else {
                    break;
                };
                let result = load_or_extract(&path);
                let _ = result_tx.send((path, result));
            }
        }));
    }
    drop(result_tx);

    let mut results = Vec::new();
    let mut errors = Vec::new();
    let mut wall_clock_truncated = false;
    let mut cursor = 0usize;
    let mut outstanding = 0usize;

    loop {
        if started.elapsed() >= wall {
            wall_clock_truncated = true;
            errors.push(OfficeSearchError {
                path: String::from("(wall-clock cap)"),
                kind: String::from("TimedOut"),
                reason: format!(
                    "RELAY_OFFICE_SEARCH_MAX_WALL_SECS={}s exceeded; {} files still pending (never started), {} abandoned in flight",
                    wall.as_secs(),
                    candidates.len().saturating_sub(cursor),
                    outstanding
                ),
            });
            break;
        }

        if cursor < candidates.len() && outstanding < worker_count {
            if work_tx.send(candidates[cursor].clone()).is_err() {
                break;
            }
            cursor += 1;
            outstanding += 1;
        }

        if cursor == candidates.len() && outstanding == 0 {
            break;
        }

        let remaining = wall
            .checked_sub(started.elapsed())
            .unwrap_or_else(|| Duration::from_millis(0));
        let wait = remaining.min(Duration::from_millis(100));
        match result_rx.recv_timeout(wait) {
            Ok((path, result)) => {
                outstanding = outstanding.saturating_sub(1);
                fold_office_search_result(
                    &regex,
                    input.context.unwrap_or(80),
                    max_results,
                    &path,
                    result,
                    &mut results,
                    &mut errors,
                );
                if results.len() >= max_results {
                    drop(work_tx);
                    return Ok(OfficeSearchOutput {
                        results,
                        errors,
                        files_scanned: cursor,
                        files_truncated,
                        results_truncated: true,
                        wall_clock_truncated,
                    });
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(work_tx);
    if wall_clock_truncated && outstanding > 0 {
        let drain_until = Instant::now() + parse_timeout;
        while outstanding > 0 && Instant::now() < drain_until {
            let wait = (drain_until - Instant::now()).min(Duration::from_millis(100));
            match result_rx.recv_timeout(wait) {
                Ok((path, result)) => {
                    outstanding = outstanding.saturating_sub(1);
                    fold_office_search_result(
                        &regex,
                        input.context.unwrap_or(80),
                        max_results,
                        &path,
                        result,
                        &mut results,
                        &mut errors,
                    );
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    } else {
        for handle in handles {
            let _ = handle.join();
        }
    }

    Ok(OfficeSearchOutput {
        results,
        errors,
        files_scanned: cursor,
        files_truncated,
        results_truncated: false,
        wall_clock_truncated,
    })
}

fn fold_office_search_result(
    regex: &Regex,
    context: usize,
    max_results: usize,
    path: &Path,
    result: io::Result<ParsedDoc>,
    results: &mut Vec<OfficeSearchHit>,
    errors: &mut Vec<OfficeSearchError>,
) {
    let parsed = match result {
        Ok(parsed) => parsed,
        Err(error) => {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: format!("{:?}", error.kind()),
                reason: error.to_string(),
            });
            return;
        }
    };
    for anchor in &parsed.anchors {
        for mat in regex.find_iter(&anchor.text) {
            if results.len() >= max_results {
                return;
            }
            let start = mat.start().saturating_sub(context);
            let end = (mat.end() + context).min(anchor.text.len());
            results.push(OfficeSearchHit {
                path: parsed.source.to_string_lossy().into_owned(),
                anchor: anchor.anchor.clone(),
                matched: mat.as_str().to_string(),
                preview: safe_preview(&anchor.text, start, end),
            });
        }
    }
}

fn safe_preview(text: &str, requested_start: usize, requested_end: usize) -> String {
    let mut start = requested_start.min(text.len());
    while start > 0 && !text.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = requested_end.min(text.len());
    while end < text.len() && !text.is_char_boundary(end) {
        end += 1;
    }
    text[start..end].replace(['\r', '\n', '\t'], " ")
}

fn normalize_include_ext(input: Option<&Vec<String>>) -> io::Result<BTreeSet<String>> {
    let allowed = ["docx", "xlsx", "pptx", "pdf"]
        .into_iter()
        .map(String::from)
        .collect::<BTreeSet<_>>();
    let values = input
        .map(|items| {
            items
                .iter()
                .map(|item| item.trim_start_matches('.').to_ascii_lowercase())
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or(allowed.clone());
    if let Some(invalid) = values.iter().find(|value| !allowed.contains(*value)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unsupported include_ext entry: {invalid}"),
        ));
    }
    Ok(values)
}

fn expand_office_candidates(
    paths: &[String],
    include_ext: &BTreeSet<String>,
) -> io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for raw in paths {
        if sensitive_literal_glob(raw) {
            continue;
        }
        if contains_glob_meta(raw) {
            for entry in glob::glob(raw)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?
                .flatten()
            {
                push_candidate(&mut out, &entry, include_ext)?;
            }
        } else {
            push_candidate(&mut out, &PathBuf::from(raw), include_ext)?;
        }
    }
    Ok(out)
}

fn contains_glob_meta(value: &str) -> bool {
    value.chars().any(|ch| matches!(ch, '*' | '?' | '[' | '{'))
}

fn sensitive_literal_glob(value: &str) -> bool {
    let leaf = value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(value)
        .to_ascii_lowercase();
    leaf.starts_with(".env")
        || leaf.starts_with("id_rsa")
        || leaf
            .rsplit_once('.')
            .is_some_and(|(_, ext)| matches!(ext, "pem" | "key"))
}

fn push_candidate(
    out: &mut Vec<PathBuf>,
    path: &Path,
    include_ext: &BTreeSet<String>,
) -> io::Result<()> {
    let Some(ext) = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
    else {
        return Ok(());
    };
    if !include_ext.contains(&ext) || !path.is_file() {
        return Ok(());
    }
    if reject_sensitive_file_path(path).is_err() {
        return Ok(());
    }
    out.push(fs::canonicalize(path)?);
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct CacheRecord {
    source_encoding: String,
    source: String,
    format: DocFormat,
    mtime_sec: u64,
    mtime_nsec: u32,
    size: u64,
    content_hash: String,
    extracted_at: String,
    schema_version: u32,
    anchors: Vec<AnchoredText>,
}

#[allow(clippy::similar_names)]
fn load_or_extract(path: &Path) -> io::Result<ParsedDoc> {
    let canonical = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical)?;
    let (modified_sec, modified_nsec) = modified_parts(&metadata)?;
    let size = metadata.len();
    let path_hash = path_hash(&canonical);
    let path_bytes = os_native_path_bytes(&normalize_cache_path(&canonical));
    let cache_path = cache_record_path(&path_hash)?;

    if let Ok(bytes) = fs::read(&cache_path) {
        if let Ok(record) = serde_json::from_slice::<CacheRecord>(&bytes) {
            if record.schema_version == CACHE_SCHEMA_VERSION
                && record_source_bytes(&record).as_deref() == Some(path_bytes.as_slice())
                && record.mtime_sec == modified_sec
                && record.mtime_nsec == modified_nsec
                && record.size == size
            {
                return Ok(ParsedDoc {
                    source: canonical,
                    format: record.format,
                    anchors: record.anchors,
                });
            }
            if record.schema_version == CACHE_SCHEMA_VERSION
                && record_source_bytes(&record).as_deref() == Some(path_bytes.as_slice())
            {
                let current_hash = content_hash(&canonical)?;
                if record.content_hash == current_hash {
                    let updated = CacheRecord {
                        mtime_sec: modified_sec,
                        mtime_nsec: modified_nsec,
                        size,
                        ..record
                    };
                    let _ = write_cache_record(&cache_path, &updated);
                    return Ok(ParsedDoc {
                        source: canonical,
                        format: updated.format,
                        anchors: updated.anchors,
                    });
                }
            }
        } else {
            let _ = fs::remove_file(&cache_path);
        }
    }

    let parsed = extract_with_timeout(&canonical)?;
    let metadata_after = fs::metadata(&canonical)?;
    let (after_modified_sec, after_modified_nsec) = modified_parts(&metadata_after)?;
    if after_modified_sec == modified_sec
        && after_modified_nsec == modified_nsec
        && metadata_after.len() == size
    {
        let record = CacheRecord {
            source_encoding: source_encoding_tag().to_string(),
            source: encode_source_path(&normalize_cache_path(&canonical)),
            format: parsed.format,
            mtime_sec: modified_sec,
            mtime_nsec: modified_nsec,
            size,
            content_hash: content_hash(&canonical)?,
            extracted_at: Utc::now().to_rfc3339(),
            schema_version: CACHE_SCHEMA_VERSION,
            anchors: parsed.anchors.clone(),
        };
        let _ = write_cache_record(&cache_path, &record);
    }
    Ok(parsed)
}

fn modified_parts(metadata: &fs::Metadata) -> io::Result<(u64, u32)> {
    let duration = metadata
        .modified()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|error| io::Error::other(error.to_string()))?;
    Ok((duration.as_secs(), duration.subsec_nanos()))
}

fn content_hash(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn path_hash(path: &Path) -> String {
    let normalized = normalize_cache_path(path);
    let bytes = os_native_path_bytes(&normalized);
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn cache_record_path(path_hash: &str) -> io::Result<PathBuf> {
    let base = dirs::cache_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "cache directory not found"))?;
    Ok(base
        .join("relay")
        .join("office_text")
        .join("by_path")
        .join(format!("{path_hash}.json")))
}

fn write_cache_record(path: &Path, record: &CacheRecord) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let nonce = {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        Instant::now().hash(&mut hasher);
        hasher.finish()
    };
    let tmp = path.with_extension(format!("json.tmp-{}-{nonce}", std::process::id()));
    let mut file = File::create(&tmp)?;
    file.write_all(&serde_json::to_vec(record).map_err(io::Error::other)?)?;
    file.sync_all()?;
    drop(file);
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

fn record_source_bytes(record: &CacheRecord) -> Option<Vec<u8>> {
    match record.source_encoding.as_str() {
        "unix-bytes-b64" | "windows-wide-b64" => BASE64_STANDARD.decode(&record.source).ok(),
        "utf8" => Some(record.source.as_bytes().to_vec()),
        _ => None,
    }
}

#[cfg(unix)]
fn os_native_path_bytes(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(windows)]
fn os_native_path_bytes(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn encode_source_path(path: &Path) -> String {
    BASE64_STANDARD.encode(os_native_path_bytes(path))
}

#[cfg(unix)]
fn source_encoding_tag() -> &'static str {
    "unix-bytes-b64"
}

#[cfg(windows)]
fn source_encoding_tag() -> &'static str {
    "windows-wide-b64"
}

#[cfg(not(any(unix, windows)))]
fn source_encoding_tag() -> &'static str {
    "utf8"
}

#[cfg(not(any(unix, windows)))]
fn os_native_path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().as_bytes().to_vec()
}

#[cfg(windows)]
fn normalize_cache_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn normalize_cache_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

pub(crate) fn read_zip_part(
    archive: &mut zip::ZipArchive<impl Read + io::Seek>,
    name: &str,
    limits: &OfficeLimits,
    produced: &mut u64,
) -> io::Result<Vec<u8>> {
    validate_zip_archive(archive, limits)?;
    let mut file = archive
        .by_name(name)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    validate_zip_entry(file.name(), file.size(), file.compressed_size(), limits)?;
    let mut reader = BoundedRead {
        inner: &mut file,
        produced,
        max: limits.zip_max_expanded_bytes,
    };
    let mut out = Vec::new();
    reader.read_to_end(&mut out)?;
    Ok(out)
}

pub(crate) fn validate_zip_archive<R: Read + io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    limits: &OfficeLimits,
) -> io::Result<()> {
    if archive.len() > limits.zip_max_entries {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "zip entries exceed RELAY_OFFICE_ZIP_MAX_ENTRIES={}",
                limits.zip_max_entries
            ),
        ));
    }
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
        validate_zip_entry(file.name(), file.size(), file.compressed_size(), limits)?;
    }
    Ok(())
}

pub(crate) fn validate_zip_entry(
    name: &str,
    size: u64,
    compressed_size: u64,
    limits: &OfficeLimits,
) -> io::Result<()> {
    if name.contains('\0')
        || name.contains('\\')
        || name.starts_with('/')
        || name.contains("//")
        || name.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || name.as_bytes().get(1) == Some(&b':')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid Office zip entry name: {name:?}"),
        ));
    }
    if size > limits.zip_max_expanded_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "zip entry exceeds RELAY_OFFICE_ZIP_MAX_EXPANDED_BYTES={}",
                limits.zip_max_expanded_bytes
            ),
        ));
    }
    let ratio = size / compressed_size.max(1);
    if ratio > limits.zip_max_compression_ratio {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "zip entry compression ratio exceeds RELAY_OFFICE_ZIP_MAX_COMPRESSION_RATIO={}",
                limits.zip_max_compression_ratio
            ),
        ));
    }
    Ok(())
}

struct BoundedRead<'a, R> {
    inner: R,
    produced: &'a mut u64,
    max: u64,
}

impl<R: Read> Read for BoundedRead<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        *self.produced += n as u64;
        if *self.produced > self.max {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "zip expanded bytes exceed RELAY_OFFICE_ZIP_MAX_EXPANDED_BYTES={}",
                    self.max
                ),
            ));
        }
        Ok(n)
    }
}
