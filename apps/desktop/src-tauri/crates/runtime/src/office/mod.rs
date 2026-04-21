use std::cmp::Reverse;
use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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

struct ExtractionSemaphore {
    state: Mutex<usize>,
    cv: Condvar,
}

impl ExtractionSemaphore {
    fn new(permits: usize) -> Self {
        Self {
            state: Mutex::new(permits),
            cv: Condvar::new(),
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<ExtractionPermit> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *state == 0 {
            return None;
        }
        *state -= 1;
        Some(ExtractionPermit {
            sem: Arc::clone(self),
        })
    }

    fn acquire_with_deadline(self: &Arc<Self>, deadline: Instant) -> Option<ExtractionPermit> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *state == 0 {
            let now = Instant::now();
            if now >= deadline {
                return None;
            }
            let waited = self.cv.wait_timeout(state, deadline - now);
            state = match waited {
                Ok((guard, _)) => guard,
                Err(poison) => poison.into_inner().0,
            };
        }
        *state -= 1;
        Some(ExtractionPermit {
            sem: Arc::clone(self),
        })
    }
}

struct ExtractionPermit {
    sem: Arc<ExtractionSemaphore>,
}

impl Drop for ExtractionPermit {
    fn drop(&mut self) {
        let mut state = self
            .sem
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *state += 1;
        self.sem.cv.notify_one();
    }
}

fn global_semaphore() -> Arc<ExtractionSemaphore> {
    static SEMAPHORE: OnceLock<Arc<ExtractionSemaphore>> = OnceLock::new();
    SEMAPHORE
        .get_or_init(|| Arc::new(ExtractionSemaphore::new(max_concurrent_extractions())))
        .clone()
}

fn in_flight() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

struct InFlightReservation {
    key: String,
}

impl InFlightReservation {
    fn reserve(key: String) -> io::Result<Self> {
        let mut slots = in_flight()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !slots.insert(key.clone()) {
            return Err(io::Error::new(
                io::ErrorKind::ResourceBusy,
                "still cancelling or extracting previous Office extraction of this path",
            ));
        }
        Ok(Self { key })
    }
}

impl Drop for InFlightReservation {
    fn drop(&mut self) {
        let mut slots = in_flight()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        slots.remove(&self.key);
    }
}

pub fn extract_with_timeout(path: &Path) -> io::Result<ParsedDoc> {
    let canonical = fs::canonicalize(path)?;
    let path_hash = path_hash(&canonical);
    let reservation = InFlightReservation::reserve(path_hash)?;
    let timeout = parse_timeout();
    let permit = global_semaphore()
        .acquire_with_deadline(Instant::now() + timeout)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::ResourceBusy,
                format!(
                    "extraction concurrency cap reached and acquire deadline expired ({}s); retry later",
                    timeout.as_secs()
                ),
            )
        })?;
    let (tx, rx) = mpsc::channel();
    let worker_path = canonical.clone();
    let deadline = Deadline::from_now(timeout);
    let handle = thread::spawn(move || {
        // Move both guards into the worker so that a panic during extraction
        // still releases the semaphore and clears the in-flight slot via Drop.
        let _reservation = reservation;
        let _permit = permit;
        let result = extract_uncached(&worker_path, &deadline);
        let _ = tx.send(result);
    });

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
            // Worker panicked — its Drop already released the reservation and permit.
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
    let total = anchors
        .iter()
        .map(|anchor| anchor.text.len())
        .sum::<usize>();
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
        let region = anchor.anchor.split_once(':').map_or("", |(prefix, _)| {
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
        for line in anchor
            .text
            .lines()
            .map(normalize_line)
            .filter(|s| !s.is_empty())
        {
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
    for part in input
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if let Some((start, end)) = part.split_once('-') {
            let start = start
                .trim()
                .parse::<u32>()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range"))?;
            let end = end
                .trim()
                .parse::<u32>()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range"))?;
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
            let slide = part
                .parse::<u32>()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid slides range"))?;
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
        .filter_map(|anchor| {
            anchor
                .anchor
                .split_once('!')
                .map(|(sheet, _)| sheet.to_string())
        })
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
    pub regex: Option<bool>,
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
    pub match_start: usize,
    pub match_end: usize,
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

/// Hard cap on the per-hit `context` size to keep result payloads bounded even when
/// callers pass huge values (the JSON schema only enforces a non-negative minimum).
pub const MAX_OFFICE_SEARCH_CONTEXT: usize = 1024;
/// Soft cap on regex memory use during compilation, mirroring the `regex` crate's
/// default but pinning the value so future bumps don't silently widen the surface.
const REGEX_SIZE_LIMIT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug)]
struct CandidateExpansion {
    candidates: Vec<PathBuf>,
    errors: Vec<OfficeSearchError>,
    files_truncated: bool,
    wall_clock_truncated: bool,
}

#[allow(clippy::too_many_lines)]
pub fn office_search(input: &OfficeSearchInput) -> io::Result<OfficeSearchOutput> {
    let regex = compile_office_search_regex(input)?;
    let include_ext = normalize_include_ext(input.include_ext.as_ref())?;
    let max_results = input.max_results.unwrap_or(100).clamp(1, 1_000);
    let max_files = input.max_files.unwrap_or(50).clamp(1, 1_000);
    let context = input.context.unwrap_or(80).min(MAX_OFFICE_SEARCH_CONTEXT);
    let started = Instant::now();
    let wall = Duration::from_secs(env_u64("RELAY_OFFICE_SEARCH_MAX_WALL_SECS", 600, 10, 3600));
    let expansion =
        expand_office_candidates(&input.paths, &include_ext, max_files, started + wall)?;
    let candidates = expansion.candidates;
    let files_truncated = expansion.files_truncated;
    let mut errors = expansion.errors;
    let mut wall_clock_truncated = expansion.wall_clock_truncated;

    let parse_timeout = parse_timeout();
    let worker_count = candidates.len().min(max_concurrent_extractions()).max(1);
    let (work_tx, work_rx) = mpsc::sync_channel::<(usize, PathBuf)>(0);
    let (result_tx, result_rx) = mpsc::channel::<(usize, PathBuf, io::Result<ParsedDoc>)>();
    let work_rx = Arc::new(Mutex::new(work_rx));

    let mut handles = Vec::new();
    for _ in 0..worker_count {
        let work_rx = Arc::clone(&work_rx);
        let result_tx = result_tx.clone();
        handles.push(thread::spawn(move || loop {
            let received = {
                let rx = work_rx
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                rx.recv()
            };
            let Ok((index, path)) = received else {
                break;
            };
            let result = load_or_extract(&path);
            let _ = result_tx.send((index, path, result));
        }));
    }
    drop(result_tx);

    let mut results = Vec::new();
    let mut ready = std::collections::BTreeMap::new();
    let mut next_to_fold = 0usize;
    let mut cursor = 0usize;
    let mut outstanding = 0usize;
    let mut results_truncated = false;

    let fold_ready =
        |ready: &mut std::collections::BTreeMap<usize, (PathBuf, io::Result<ParsedDoc>)>,
         next_to_fold: &mut usize,
         results: &mut Vec<OfficeSearchHit>,
         errors: &mut Vec<OfficeSearchError>| {
            while let Some((path, result)) = ready.remove(next_to_fold) {
                if fold_office_search_result(
                    &regex,
                    context,
                    max_results,
                    &path,
                    result,
                    results,
                    errors,
                ) {
                    return true;
                }
                *next_to_fold += 1;
            }
            false
        };

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
            if work_tx.send((cursor, candidates[cursor].clone())).is_err() {
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
            Ok((index, path, result)) => {
                outstanding = outstanding.saturating_sub(1);
                ready.insert(index, (path, result));
                if fold_ready(&mut ready, &mut next_to_fold, &mut results, &mut errors) {
                    results_truncated = true;
                    drop(work_tx);
                    let output = OfficeSearchOutput {
                        results,
                        errors,
                        files_scanned: cursor,
                        files_truncated,
                        results_truncated,
                        wall_clock_truncated,
                    };
                    tracing::info!(
                        target: "relay.runtime.search",
                        tool = "office_search",
                        files_scanned = output.files_scanned,
                        results = output.results.len(),
                        errors = output.errors.len(),
                        files_truncated = output.files_truncated,
                        results_truncated = output.results_truncated,
                        wall_clock_truncated = output.wall_clock_truncated,
                        elapsed_ms = started.elapsed().as_millis(),
                        "office_search completed"
                    );
                    return Ok(output);
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
                Ok((index, path, result)) => {
                    outstanding = outstanding.saturating_sub(1);
                    ready.insert(index, (path, result));
                    if fold_ready(&mut ready, &mut next_to_fold, &mut results, &mut errors) {
                        results_truncated = true;
                        break;
                    }
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

    let output = OfficeSearchOutput {
        results,
        errors,
        files_scanned: cursor,
        files_truncated,
        results_truncated,
        wall_clock_truncated,
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "office_search",
        files_scanned = output.files_scanned,
        results = output.results.len(),
        errors = output.errors.len(),
        files_truncated = output.files_truncated,
        results_truncated = output.results_truncated,
        wall_clock_truncated = output.wall_clock_truncated,
        elapsed_ms = started.elapsed().as_millis(),
        "office_search completed"
    );
    Ok(output)
}

fn compile_office_search_regex(input: &OfficeSearchInput) -> io::Result<Regex> {
    let pattern = if input.regex.unwrap_or(false) {
        input.pattern.clone()
    } else {
        regex::escape(&input.pattern)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(input.case_insensitive.unwrap_or(false))
        .size_limit(REGEX_SIZE_LIMIT_BYTES)
        .build()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))
}

fn fold_office_search_result(
    regex: &Regex,
    context: usize,
    max_results: usize,
    path: &Path,
    result: io::Result<ParsedDoc>,
    results: &mut Vec<OfficeSearchHit>,
    errors: &mut Vec<OfficeSearchError>,
) -> bool {
    let parsed = match result {
        Ok(parsed) => parsed,
        Err(error) => {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: format!("{:?}", error.kind()),
                reason: error.to_string(),
            });
            return false;
        }
    };
    for anchor in &parsed.anchors {
        for mat in regex.find_iter(&anchor.text) {
            if results.len() >= max_results {
                return true;
            }
            let start = mat.start().saturating_sub(context);
            let end = (mat.end() + context).min(anchor.text.len());
            results.push(OfficeSearchHit {
                path: parsed.source.to_string_lossy().into_owned(),
                anchor: anchor.anchor.clone(),
                matched: mat.as_str().to_string(),
                preview: safe_preview(&anchor.text, start, end),
                match_start: mat.start(),
                match_end: mat.end(),
            });
            if results.len() >= max_results {
                return true;
            }
        }
    }
    false
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
    max_files: usize,
    deadline: Instant,
) -> io::Result<CandidateExpansion> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut errors = Vec::new();
    let mut files_truncated = false;
    let mut wall_clock_truncated = false;
    for raw in paths {
        if Instant::now() >= deadline {
            wall_clock_truncated = true;
            break;
        }
        if sensitive_literal_glob(raw) {
            continue;
        }
        if contains_glob_meta(raw) {
            let glob_entries = match glob::glob(raw) {
                Ok(entries) => entries,
                Err(error) => {
                    errors.push(OfficeSearchError {
                        path: raw.clone(),
                        kind: String::from("InvalidInput"),
                        reason: error.to_string(),
                    });
                    continue;
                }
            };
            for entry in glob_entries {
                if Instant::now() >= deadline {
                    wall_clock_truncated = true;
                    break;
                }
                match entry {
                    Ok(entry) => {
                        push_candidate(&mut out, &mut seen, &entry, include_ext, false, &mut errors)
                    }
                    Err(error) => errors.push(OfficeSearchError {
                        path: error.path().to_string_lossy().into_owned(),
                        kind: String::from("GlobError"),
                        reason: error.error().to_string(),
                    }),
                }
            }
            if wall_clock_truncated {
                break;
            }
        } else {
            push_candidate(
                &mut out,
                &mut seen,
                &PathBuf::from(raw),
                include_ext,
                true,
                &mut errors,
            );
        }
    }
    sort_candidates_by_modified_desc(&mut out);
    files_truncated |= out.len() > max_files;
    out.truncate(max_files);
    Ok(CandidateExpansion {
        candidates: out,
        errors,
        files_truncated,
        wall_clock_truncated,
    })
}

fn candidate_modified_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis())
}

fn sort_candidates_by_modified_desc(paths: &mut [PathBuf]) {
    paths.sort_by(|left, right| {
        Reverse(candidate_modified_ms(left))
            .cmp(&Reverse(candidate_modified_ms(right)))
            .then_with(|| left.cmp(right))
    });
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
    seen: &mut BTreeSet<PathBuf>,
    path: &Path,
    include_ext: &BTreeSet<String>,
    report_explicit_errors: bool,
    errors: &mut Vec<OfficeSearchError>,
) {
    let Some(ext) = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
    else {
        if report_explicit_errors {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: String::from("UnsupportedExtension"),
                reason: String::from("missing or non-UTF-8 file extension"),
            });
        }
        return;
    };
    if !include_ext.contains(&ext) {
        if report_explicit_errors {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: String::from("UnsupportedExtension"),
                reason: format!("extension .{ext} is not included"),
            });
        }
        return;
    }
    if !path.exists() {
        if report_explicit_errors {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: String::from("NotFound"),
                reason: String::from("path does not exist"),
            });
        }
        return;
    }
    if !path.is_file() {
        if report_explicit_errors {
            errors.push(OfficeSearchError {
                path: path.to_string_lossy().into_owned(),
                kind: String::from("NotFile"),
                reason: String::from("path is not a regular file"),
            });
        }
        return;
    }
    if reject_sensitive_file_path(path).is_err() {
        return;
    }
    // Files that disappear between glob expansion and canonicalize are skipped silently
    // so a single missing path does not abort the entire search.
    if let Ok(canonical) = fs::canonicalize(path) {
        if reject_sensitive_file_path(&canonical).is_err() {
            return;
        }
        if seen.insert(canonical.clone()) {
            out.push(canonical);
        }
    }
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
    let cache_path = cache_record_path(&path_hash);

    if let Some(cache_path) = cache_path.as_ref() {
        if let Ok(bytes) = fs::read(cache_path) {
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
                        if let Err(error) = write_cache_record(cache_path, &updated) {
                            tracing::debug!(
                                cache_path = %cache_path.display(),
                                error = %error,
                                "office cache refresh write failed"
                            );
                        }
                        return Ok(ParsedDoc {
                            source: canonical,
                            format: updated.format,
                            anchors: updated.anchors,
                        });
                    }
                }
            } else {
                let _ = fs::remove_file(cache_path);
            }
        }
    }

    let parsed = extract_with_timeout(&canonical)?;
    if let Some(cache_path) = cache_path {
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
            if let Err(error) = write_cache_record(&cache_path, &record) {
                tracing::debug!(
                    cache_path = %cache_path.display(),
                    error = %error,
                    "office cache write failed"
                );
            }
        }
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

fn cache_record_path(path_hash: &str) -> Option<PathBuf> {
    dirs::cache_dir().map(|base| {
        base.join("relay")
            .join("office_text")
            .join("by_path")
            .join(format!("{path_hash}.json"))
    })
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

/// Reads a single zip entry by name. Callers MUST have already invoked
/// [`validate_zip_archive`] on the archive once before walking entries — re-validating
/// on every read would make multi-part formats (DOCX headers/footers, PPTX slides) O(N²).
pub(crate) fn read_zip_part(
    archive: &mut zip::ZipArchive<impl Read + io::Seek>,
    name: &str,
    limits: &OfficeLimits,
    produced: &mut u64,
) -> io::Result<Vec<u8>> {
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
        || name
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "relay-office-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create test dir");
        path
    }

    fn base_input(pattern: &str) -> OfficeSearchInput {
        OfficeSearchInput {
            pattern: pattern.to_string(),
            paths: vec![String::from("unused")],
            regex: None,
            include_ext: None,
            case_insensitive: None,
            context: None,
            max_results: None,
            max_files: None,
        }
    }

    #[test]
    fn office_search_defaults_to_literal_pattern() {
        let input = base_input("Q1.2026 (draft) A+B");
        let regex = compile_office_search_regex(&input).expect("compile literal pattern");

        assert!(regex.is_match("prefix Q1.2026 (draft) A+B suffix"));
        assert!(!regex.is_match("Q1x2026 draft AAAB"));
    }

    #[test]
    fn office_search_regex_mode_preserves_regex_behavior() {
        let mut input = base_input("Q1.2026");
        input.regex = Some(true);
        let regex = compile_office_search_regex(&input).expect("compile regex pattern");

        assert!(regex.is_match("Q1x2026"));
    }

    #[test]
    fn fold_office_search_result_records_match_offsets() {
        let regex = Regex::new("needle").expect("regex");
        let parsed = ParsedDoc {
            source: PathBuf::from("/tmp/report.docx"),
            format: DocFormat::Docx,
            anchors: vec![AnchoredText {
                anchor: String::from("p1"),
                text: String::from("before needle after"),
            }],
        };
        let mut results = Vec::new();
        let mut errors = Vec::new();

        let truncated = fold_office_search_result(
            &regex,
            3,
            10,
            Path::new("/tmp/report.docx"),
            Ok(parsed),
            &mut results,
            &mut errors,
        );

        assert!(!truncated);
        assert!(errors.is_empty());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matched, "needle");
        assert_eq!(results[0].match_start, 7);
        assert_eq!(results[0].match_end, 13);
        assert_eq!(results[0].preview, "re needle af");
    }

    #[test]
    fn expand_office_candidates_truncates_during_glob_expansion() {
        let root = test_dir();
        for name in ["b.xlsx", "a.xlsx", "c.xlsx"] {
            fs::write(root.join(name), b"not a real workbook").expect("write candidate");
        }
        let pattern = root.join("*.xlsx").to_string_lossy().into_owned();
        let include_ext = normalize_include_ext(None).expect("include ext");

        let expansion = expand_office_candidates(
            &[pattern],
            &include_ext,
            2,
            Instant::now() + Duration::from_secs(60),
        )
        .expect("expand candidates");

        assert!(expansion.files_truncated);
        assert_eq!(expansion.candidates.len(), 2);
        assert!(expansion.errors.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expand_office_candidates_truncation_prefers_recent_files() {
        let root = test_dir();
        let oldest = root.join("a_oldest.xlsx");
        let middle = root.join("m_middle.xlsx");
        let newest = root.join("z_newest.xlsx");
        fs::write(&oldest, b"oldest").expect("write oldest candidate");
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&middle, b"middle").expect("write middle candidate");
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&newest, b"newest").expect("write newest candidate");
        let pattern = root.join("*.xlsx").to_string_lossy().into_owned();
        let include_ext =
            normalize_include_ext(Some(&vec![String::from("xlsx")])).expect("include ext");

        let expansion = expand_office_candidates(
            &[pattern],
            &include_ext,
            2,
            Instant::now() + Duration::from_secs(60),
        )
        .expect("expand candidates");

        assert!(expansion.files_truncated);
        assert_eq!(expansion.candidates.len(), 2);
        assert_eq!(expansion.candidates[0], fs::canonicalize(&newest).unwrap());
        assert_eq!(expansion.candidates[1], fs::canonicalize(&middle).unwrap());
        assert!(!expansion
            .candidates
            .contains(&fs::canonicalize(&oldest).unwrap()));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expand_office_candidates_orders_by_modified_time_desc() {
        let root = test_dir();
        let older = root.join("older.xlsx");
        let newer = root.join("newer.xlsx");
        fs::write(&older, b"old").expect("write older candidate");
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&newer, b"new").expect("write newer candidate");
        let pattern = root.join("*.xlsx").to_string_lossy().into_owned();
        let include_ext =
            normalize_include_ext(Some(&vec![String::from("xlsx")])).expect("include ext");

        let expansion = expand_office_candidates(
            &[pattern],
            &include_ext,
            10,
            Instant::now() + Duration::from_secs(60),
        )
        .expect("expand candidates");

        assert_eq!(expansion.candidates.len(), 2);
        assert_eq!(expansion.candidates[0], fs::canonicalize(&newer).unwrap());
        assert_eq!(expansion.candidates[1], fs::canonicalize(&older).unwrap());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn expand_office_candidates_reports_explicit_path_typos() {
        let root = test_dir();
        let include_ext =
            normalize_include_ext(Some(&vec![String::from("xlsx")])).expect("include ext");
        let missing = root.join("report.xslx").to_string_lossy().into_owned();

        let expansion = expand_office_candidates(
            &[missing],
            &include_ext,
            10,
            Instant::now() + Duration::from_secs(60),
        )
        .expect("expand candidates");

        assert!(expansion.candidates.is_empty());
        assert_eq!(expansion.errors.len(), 1);
        assert_eq!(expansion.errors[0].kind, "UnsupportedExtension");

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn expand_office_candidates_rechecks_sensitive_canonical_path() {
        use std::os::unix::fs::symlink;

        let root = test_dir();
        let sensitive = root.join(".env.xlsx");
        let link = root.join("safe.xlsx");
        fs::write(&sensitive, b"secret").expect("write sensitive target");
        symlink(&sensitive, &link).expect("create symlink");
        let include_ext =
            normalize_include_ext(Some(&vec![String::from("xlsx")])).expect("include ext");

        let expansion = expand_office_candidates(
            &[link.to_string_lossy().into_owned()],
            &include_ext,
            10,
            Instant::now() + Duration::from_secs(60),
        )
        .expect("expand candidates");

        assert!(expansion.candidates.is_empty());
        assert!(expansion.errors.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
