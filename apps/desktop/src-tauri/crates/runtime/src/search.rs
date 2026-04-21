use std::cmp::Reverse;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

use glob::Pattern;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::office;
use crate::search_backend;
use crate::tool_hard_denylist::reject_sensitive_file_path;

const DEFAULT_WORKSPACE_SEARCH_MAX_FILES: usize = 50;
const DEFAULT_WORKSPACE_SEARCH_MAX_SNIPPETS: usize = 30;
const DEFAULT_WORKSPACE_SEARCH_MAX_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_WORKSPACE_SEARCH_MAX_DURATION_MS: u64 = 5_000;
const MAX_WORKSPACE_SEARCH_MAX_FILES: usize = 500;
const MAX_WORKSPACE_SEARCH_MAX_SNIPPETS: usize = 200;
const MAX_WORKSPACE_SEARCH_MAX_BYTES: u64 = 10 * 1024 * 1024;
const MAX_WORKSPACE_SEARCH_MAX_DURATION_MS: u64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchInput {
    pub query: String,
    pub paths: Option<Vec<String>>,
    pub mode: Option<String>,
    #[serde(rename = "include_ext")]
    pub include_ext: Option<Vec<String>>,
    #[serde(rename = "max_files")]
    pub max_files: Option<usize>,
    #[serde(rename = "max_snippets")]
    pub max_snippets: Option<usize>,
    #[serde(rename = "max_bytes")]
    pub max_bytes: Option<u64>,
    #[serde(rename = "max_duration_ms")]
    pub max_duration_ms: Option<u64>,
    pub context: Option<usize>,
    pub literal: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSearchCandidate {
    pub path: String,
    pub score: f64,
    pub confidence: String,
    pub features: WorkspaceSearchRankingFeatures,
    pub why: Vec<String>,
    pub reasons: Vec<String>,
    #[serde(rename = "match_count")]
    pub match_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct WorkspaceSearchRankingFeatures {
    #[serde(rename = "filename_match")]
    pub filename_match: bool,
    #[serde(rename = "path_match")]
    pub path_match: bool,
    #[serde(rename = "content_match_count")]
    pub content_match_count: usize,
    #[serde(rename = "symbol_match_count")]
    pub symbol_match_count: usize,
    #[serde(rename = "office_anchor")]
    pub office_anchor: bool,
    #[serde(rename = "recently_modified")]
    pub recently_modified: bool,
    #[serde(rename = "ignored_generated_penalty")]
    pub ignored_generated_penalty: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchSnippet {
    pub path: String,
    pub anchor: Option<String>,
    #[serde(rename = "line_start")]
    pub line_start: usize,
    #[serde(rename = "line_end")]
    pub line_end: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchSkipped {
    pub path: String,
    pub reason: String,
    pub category: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchLimits {
    #[serde(rename = "scanned_files")]
    pub scanned_files: usize,
    #[serde(rename = "skipped_files")]
    pub skipped_files: usize,
    #[serde(rename = "scanned_bytes")]
    pub scanned_bytes: u64,
    pub truncated: bool,
    #[serde(rename = "elapsed_ms")]
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchPlan {
    pub intent: String,
    #[serde(rename = "query_variants")]
    pub query_variants: Vec<String>,
    pub retrievers: Vec<String>,
    pub scope: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchRecommendedNextTool {
    pub tool: String,
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceSearchTrace {
    #[serde(rename = "searched_files")]
    pub searched_files: usize,
    #[serde(rename = "skipped_files")]
    pub skipped_files: usize,
    pub truncated: bool,
    #[serde(rename = "fallbacks_used")]
    pub fallbacks_used: Vec<String>,
    #[serde(rename = "needs_clarification")]
    pub needs_clarification: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSearchOutput {
    pub query: String,
    pub plan: WorkspaceSearchPlan,
    pub strategy: Vec<String>,
    pub candidates: Vec<WorkspaceSearchCandidate>,
    pub snippets: Vec<WorkspaceSearchSnippet>,
    #[serde(rename = "recommended_next_tools")]
    pub recommended_next_tools: Vec<WorkspaceSearchRecommendedNextTool>,
    pub skipped: Vec<WorkspaceSearchSkipped>,
    pub limits: WorkspaceSearchLimits,
    pub trace: WorkspaceSearchTrace,
    #[serde(rename = "needs_clarification")]
    pub needs_clarification: bool,
}

#[derive(Debug, Clone)]
struct WorkspaceCandidateAccumulator {
    path: String,
    score: f64,
    reasons: Vec<String>,
    match_count: usize,
    features: WorkspaceSearchRankingFeatures,
    modified_ms: u128,
}

impl WorkspaceCandidateAccumulator {
    fn new(path: String) -> Self {
        let modified_ms = path_modified_ms(Path::new(&path));
        Self::with_modified(path, modified_ms)
    }

    fn with_modified(path: String, modified_ms: u128) -> Self {
        Self {
            path,
            score: 0.0,
            reasons: Vec::new(),
            match_count: 0,
            features: WorkspaceSearchRankingFeatures::default(),
            modified_ms,
        }
    }

    fn add(&mut self, score: f64, matches: usize, reason: impl Into<String>) {
        self.score += score;
        self.match_count += matches;
        let reason = reason.into();
        if !self.reasons.iter().any(|existing| existing == &reason) {
            self.reasons.push(reason);
        }
    }

    fn merge(&mut self, other: Self) {
        self.score += other.score;
        self.match_count += other.match_count;
        self.features.filename_match |= other.features.filename_match;
        self.features.path_match |= other.features.path_match;
        self.features.content_match_count += other.features.content_match_count;
        self.features.symbol_match_count += other.features.symbol_match_count;
        self.features.office_anchor |= other.features.office_anchor;
        self.features.recently_modified |= other.features.recently_modified;
        self.features.ignored_generated_penalty += other.features.ignored_generated_penalty;
        self.modified_ms = self.modified_ms.max(other.modified_ms);
        for reason in other.reasons {
            if !self.reasons.iter().any(|existing| existing == &reason) {
                self.reasons.push(reason);
            }
        }
    }

    fn into_candidate(self) -> WorkspaceSearchCandidate {
        let score = (self.score * 100.0).round() / 100.0;
        let confidence = if score >= 80.0 || self.features.content_match_count >= 3 {
            "high"
        } else if score >= 35.0 || self.match_count > 0 {
            "medium"
        } else {
            "low"
        };
        WorkspaceSearchCandidate {
            path: self.path,
            score,
            confidence: confidence.to_string(),
            features: self.features,
            why: self.reasons.clone(),
            reasons: self.reasons,
            match_count: self.match_count,
        }
    }
}

#[derive(Debug)]
struct SearchBudgets {
    max_files: usize,
    max_snippets: usize,
    max_bytes: u64,
    deadline: Instant,
}

#[derive(Debug)]
struct SearchState {
    scanned_files: usize,
    skipped_files: usize,
    scanned_bytes: u64,
    truncated: bool,
    skipped: Vec<WorkspaceSearchSkipped>,
}

#[derive(Debug)]
struct WorkspaceFileEntry {
    canonical: PathBuf,
    path_string: String,
    metadata: fs::Metadata,
    modified_ms: u128,
    scan_priority: i64,
    accumulator: WorkspaceCandidateAccumulator,
}

impl SearchState {
    fn new() -> Self {
        Self {
            scanned_files: 0,
            skipped_files: 0,
            scanned_bytes: 0,
            truncated: false,
            skipped: Vec::new(),
        }
    }

    fn skip(&mut self, path: impl Into<String>, reason: impl Into<String>) {
        self.skip_structured(path, reason, None::<String>);
    }

    fn skip_structured(
        &mut self,
        path: impl Into<String>,
        reason: impl Into<String>,
        detail: Option<impl Into<String>>,
    ) {
        self.skipped_files += 1;
        if self.skipped.len() < 100 {
            let reason = reason.into();
            self.skipped.push(WorkspaceSearchSkipped {
                path: path.into(),
                category: reason
                    .split_once(':')
                    .map_or_else(|| reason.clone(), |(category, _)| category.to_string()),
                reason,
                detail: detail.map(Into::into),
            });
        }
    }

    fn skip_sensitive(&mut self) {
        self.skip_structured(
            "[redacted-sensitive-path]",
            "sensitive_path",
            Some("path blocked by Relay hard denylist"),
        );
    }
}

#[derive(Debug)]
struct GitIgnoreMatcher {
    patterns: Vec<GitIgnorePattern>,
}

#[derive(Debug)]
struct GitIgnorePattern {
    pattern: Pattern,
    negated: bool,
    directory_only: bool,
    raw: String,
}

impl GitIgnoreMatcher {
    fn load(root: &Path) -> Self {
        let patterns = [".gitignore", ".ignore"]
            .into_iter()
            .filter_map(|name| fs::read_to_string(root.join(name)).ok())
            .flat_map(|contents| parse_ignore_patterns(&contents))
            .collect();
        Self { patterns }
    }

    fn is_match(&self, workspace_root: &Path, path: &Path) -> bool {
        let relative = path.strip_prefix(workspace_root).unwrap_or(path);
        let relative_string = relative.to_string_lossy();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        let mut ignored = false;
        for rule in &self.patterns {
            if ignore_pattern_matches(rule, &relative_string, file_name, relative) {
                ignored = !rule.negated;
            }
        }
        ignored
    }
}

fn parse_ignore_patterns(contents: &str) -> Vec<GitIgnorePattern> {
    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let negated = line.starts_with('!');
            let raw_pattern = line.trim_start_matches('!');
            let directory_only = raw_pattern.ends_with('/');
            let pattern = raw_pattern.trim_start_matches('/').trim_end_matches('/');
            let raw = pattern.to_string();
            Pattern::new(pattern)
                .ok()
                .map(|pattern| GitIgnorePattern {
                    pattern,
                    negated,
                    directory_only,
                    raw,
                })
        })
        .collect()
}

fn ignore_pattern_matches(
    rule: &GitIgnorePattern,
    relative_string: &str,
    file_name: &str,
    relative: &Path,
) -> bool {
    if rule.pattern.matches(relative_string) || rule.pattern.matches(file_name) {
        return true;
    }
    if !rule.directory_only {
        return false;
    }
    let raw = rule.raw.trim_matches('/');
    if raw.is_empty() {
        return false;
    }
    if raw.contains('/') || raw.contains('\\') {
        let normalized_raw = raw.replace('\\', "/");
        let normalized_relative = relative_string.replace('\\', "/");
        return normalized_relative == normalized_raw
            || normalized_relative.starts_with(&format!("{normalized_raw}/"));
    }
    relative.components().any(|component| {
        component.as_os_str().to_string_lossy() == raw
    })
}

fn load_global_ignore_patterns() -> Vec<GitIgnorePattern> {
    std::env::var_os("RELAY_WORKSPACE_SEARCH_IGNORE_FILE")
        .map(PathBuf::from)
        .into_iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .flat_map(|contents| parse_ignore_patterns(&contents))
        .collect()
}

#[derive(Debug)]
struct WorkspaceIgnoreMatcher {
    local: GitIgnoreMatcher,
    global: Vec<GitIgnorePattern>,
}

impl WorkspaceIgnoreMatcher {
    fn load(root: &Path) -> Self {
        Self {
            local: GitIgnoreMatcher::load(root),
            global: load_global_ignore_patterns(),
        }
    }

    fn is_match(&self, workspace_root: &Path, path: &Path) -> bool {
        if self.local.is_match(workspace_root, path) {
            return true;
        }
        if self.global.is_empty() {
            return false;
        }
        let relative = path.strip_prefix(workspace_root).unwrap_or(path);
        let relative_string = relative.to_string_lossy();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        let mut ignored = false;
        for rule in &self.global {
            if ignore_pattern_matches(rule, &relative_string, file_name, relative) {
                ignored = !rule.negated;
            }
        }
        ignored
    }
}

fn discover_workspace_paths(
    search_roots: &[PathBuf],
    include_ext: Option<&HashSet<String>>,
    limit_per_root: usize,
    state: &mut SearchState,
    fallbacks_used: &mut Vec<String>,
) -> io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let globs = workspace_search_rg_globs(include_ext);
    for root in search_roots {
        match search_backend::rg_files(
            root,
            search_backend::RgFilesOptions::new(&globs, limit_per_root),
        )? {
            Some(result) => {
                state.truncated |= result.truncated;
                for path in result.files {
                    if seen.insert(path.clone()) {
                        out.push(path);
                    }
                }
            }
            None => {
                if !fallbacks_used.iter().any(|entry| entry == "walkdir_file_discovery") {
                    fallbacks_used.push(String::from("walkdir_file_discovery"));
                }
                for entry in WalkDir::new(root)
                    .follow_links(false)
                    .into_iter()
                    .filter_entry(|entry| !is_ignored_workspace_search_path(entry.path()))
                {
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(error) => {
                            state.skip("(walkdir)", format!("walk_error:{error}"));
                            continue;
                        }
                    };
                    let path = entry.path().to_path_buf();
                    if entry.file_type().is_symlink() {
                        state.skip(path.to_string_lossy(), "symlink");
                        continue;
                    }
                    if entry.file_type().is_file() && seen.insert(path.clone()) {
                        out.push(path);
                    }
                    if out.len() >= limit_per_root {
                        state.truncated = true;
                        break;
                    }
                }
            }
        }
    }
    Ok(out)
}

fn workspace_search_rg_globs(include_ext: Option<&HashSet<String>>) -> Vec<String> {
    let Some(include_ext) = include_ext else {
        return Vec::new();
    };
    include_ext
        .iter()
        .map(|ext| format!("**/*.{}", ext.trim_start_matches('.')))
        .collect()
}

fn is_sensitive_workspace_search_path(path: &Path) -> bool {
    if reject_sensitive_file_path(path).is_err() {
        return true;
    }
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        is_sensitive_workspace_search_component(&name)
    })
}

fn is_sensitive_workspace_search_component(name: &str) -> bool {
    let stem = name.split_once('.').map_or(name, |(stem, _)| stem);
    matches!(
        name,
        ".ssh" | ".gnupg" | "private-key" | "private_key"
    ) || matches!(
        stem,
        "credential" | "credentials" | "secret" | "secrets" | "token" | "tokens"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchIntent {
    ExactPath,
    Filename,
    CodeSymbol,
    RelatedImplementation,
    Documentation,
    OfficeEvidence,
    DiagnosticFollowup,
    Unknown,
}

#[derive(Debug, Clone)]
struct SearchToolAdvice {
    intent: SearchIntent,
    primary: &'static str,
    fallbacks: Vec<&'static str>,
    require_read_file_before_conclusion: bool,
    reason: String,
}

pub fn workspace_search(input: &WorkspaceSearchInput) -> io::Result<WorkspaceSearchOutput> {
    let workspace_root = std::env::current_dir()?.canonicalize()?;
    workspace_search_with_root(input, &workspace_root)
}

pub fn workspace_search_with_root(
    input: &WorkspaceSearchInput,
    workspace_root: &Path,
) -> io::Result<WorkspaceSearchOutput> {
    let started = Instant::now();
    let query = input.query.trim();
    if query.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace_search query is required",
        ));
    }

    let workspace_root = workspace_root.canonicalize()?;
    let search_roots = workspace_search_roots(input.paths.as_ref(), &workspace_root)?;
    let include_ext = normalize_workspace_search_exts(input.include_ext.as_ref());
    let budgets = SearchBudgets {
        max_files: input
            .max_files
            .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_FILES)
            .clamp(1, MAX_WORKSPACE_SEARCH_MAX_FILES),
        max_snippets: input
            .max_snippets
            .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_SNIPPETS)
            .clamp(1, MAX_WORKSPACE_SEARCH_MAX_SNIPPETS),
        max_bytes: input
            .max_bytes
            .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_BYTES)
            .clamp(1, MAX_WORKSPACE_SEARCH_MAX_BYTES),
        deadline: started
            + Duration::from_millis(
                input
                    .max_duration_ms
                    .unwrap_or(DEFAULT_WORKSPACE_SEARCH_MAX_DURATION_MS)
                    .clamp(1, MAX_WORKSPACE_SEARCH_MAX_DURATION_MS),
            ),
    };
    let context = input.context.unwrap_or(2).min(10);
    let terms = workspace_search_terms(query);
    let plan = build_workspace_search_plan(
        input,
        query,
        &terms,
        &search_roots,
        include_ext.as_ref(),
        &workspace_root,
    );
    let ignore_matcher = WorkspaceIgnoreMatcher::load(&workspace_root);
    let mut state = SearchState::new();
    let mut candidate_map = BTreeMap::<String, WorkspaceCandidateAccumulator>::new();
    let mut snippets = Vec::new();
    let mut fallbacks_used = vec![
        String::from("rg_file_discovery"),
        String::from("rg_content_search"),
    ];
    let mut file_entries = Vec::new();

    for path in discover_workspace_paths(
        &search_roots,
        include_ext.as_ref(),
        budgets.max_files.saturating_mul(8).clamp(100, 2_000),
        &mut state,
        &mut fallbacks_used,
    )? {
        if Instant::now() >= budgets.deadline {
            state.truncated = true;
            state.skip(path.to_string_lossy(), "duration_budget_exceeded");
            break;
        }
            if is_ignored_workspace_search_path(&path) {
                state.skip(path.to_string_lossy(), "default_ignore");
                continue;
            }
            if ignore_matcher.is_match(&workspace_root, &path) {
                state.skip(path.to_string_lossy(), "ignored_by_gitignore");
                continue;
            }
            if is_sensitive_workspace_search_path(&path) {
                state.skip_sensitive();
                continue;
            }
            if !workspace_search_ext_allowed(&path, include_ext.as_ref()) {
                state.skip(path.to_string_lossy(), "extension_filter");
                continue;
            }
            let canonical = match path.canonicalize() {
                Ok(canonical) if canonical.starts_with(&workspace_root) => canonical,
                Ok(canonical) => {
                    state.skip(canonical.to_string_lossy(), "outside_workspace");
                    continue;
                }
                Err(error) => {
                    state.skip(path.to_string_lossy(), format!("canonicalize_error:{error}"));
                    continue;
                }
            };
            if is_sensitive_workspace_search_path(&canonical) {
                state.skip_sensitive();
                continue;
            }
            let metadata = match fs::metadata(&canonical) {
                Ok(metadata) => metadata,
                Err(error) => {
                    state.skip(canonical.to_string_lossy(), format!("metadata_error:{error}"));
                    continue;
                }
            };
            if metadata.len() > budgets.max_bytes {
                state.skip(canonical.to_string_lossy(), "max_bytes");
                continue;
            }

            let path_string = canonical.to_string_lossy().into_owned();
            let modified_ms = metadata_modified_ms(&metadata);
            let mut accumulator =
                WorkspaceCandidateAccumulator::with_modified(path_string.clone(), modified_ms);
            score_workspace_path(&path_string, &terms, &mut accumulator);
            score_extension(&canonical, &mut accumulator);
            score_recency_from_metadata(&metadata, &mut accumulator);
            let scan_priority = workspace_search_scan_priority(&accumulator);
            file_entries.push(WorkspaceFileEntry {
                modified_ms,
                canonical,
                path_string,
                metadata,
                scan_priority,
                accumulator,
            });
    }

    file_entries.sort_by(|left, right| {
        right
            .scan_priority
            .cmp(&left.scan_priority)
            .then_with(|| Reverse(left.modified_ms).cmp(&Reverse(right.modified_ms)))
            .then_with(|| left.path_string.cmp(&right.path_string))
    });

    for file_entry in &file_entries {
        if file_entry.accumulator.match_count > 0 {
            candidate_map.insert(
                file_entry.path_string.clone(),
                file_entry.accumulator.clone(),
            );
        }
    }

    integrate_rg_content_search(
        &terms,
        &search_roots,
        include_ext.as_ref(),
        &workspace_root,
        &ignore_matcher,
        &mut candidate_map,
        &mut snippets,
        &mut state,
        budgets.max_bytes,
        budgets.max_snippets,
    );

    for file_entry in file_entries {
        if Instant::now() >= budgets.deadline {
            state.truncated = true;
            state.skip(file_entry.path_string, "duration_budget_exceeded");
            break;
        }
        if state.scanned_files >= budgets.max_files {
            state.truncated = true;
            state.skip(file_entry.path_string, "max_files");
            break;
        }

        let WorkspaceFileEntry {
            canonical,
            path_string,
            metadata,
            accumulator,
            ..
        } = file_entry;
        let mut accumulator = accumulator;

        if is_office_workspace_search_path(&canonical) {
            state.scanned_files += 1;
            state.scanned_bytes = state.scanned_bytes.saturating_add(metadata.len());
            if accumulator.match_count > 0 {
                candidate_map.insert(path_string, accumulator);
            }
            continue;
        }

        let bytes = match fs::read(&canonical) {
            Ok(bytes) => bytes,
            Err(error) => {
                state.skip(path_string, format!("read_error:{error}"));
                continue;
            }
        };
        if bytes.contains(&0) {
            state.skip(path_string, "binary");
            continue;
        }
        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => {
                state.skip(path_string, "non_utf8");
                continue;
            }
        };
        state.scanned_files += 1;
        state.scanned_bytes = state.scanned_bytes.saturating_add(metadata.len());

        let file_snippets =
            score_workspace_text(&path_string, &content, &terms, context, &mut accumulator);
        if accumulator.match_count > 0 {
            candidate_map.insert(path_string, accumulator);
        }
        for snippet in file_snippets {
            if snippets.len() < budgets.max_snippets {
                snippets.push(snippet);
            } else {
                state.truncated = true;
                break;
            }
        }
    }

    let include_office_search =
        workspace_search_should_include_office(input.mode.as_deref(), include_ext.as_ref());
    if include_office_search && snippets.len() < budgets.max_snippets {
        fallbacks_used.push(String::from("office_search"));
        integrate_office_search(
            query,
            &terms,
            &search_roots,
            &mut candidate_map,
            &mut snippets,
            &mut state,
            include_ext.as_ref(),
            budgets.max_files,
            budgets.max_snippets,
            budgets.deadline,
        );
    }

    let mut accumulators = candidate_map.into_values().collect::<Vec<_>>();
    accumulators.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.match_count.cmp(&a.match_count))
            .then_with(|| b.modified_ms.cmp(&a.modified_ms))
            .then_with(|| a.path.cmp(&b.path))
    });
    let mut candidates = accumulators
        .into_iter()
        .map(WorkspaceCandidateAccumulator::into_candidate)
        .collect::<Vec<_>>();
    if candidates.len() > budgets.max_files {
        candidates.truncate(budgets.max_files);
        state.truncated = true;
    }
    let needs_clarification = candidates.is_empty()
        || candidates
            .windows(2)
            .next()
            .is_some_and(|pair| (pair[0].score - pair[1].score).abs() < f64::EPSILON);
    let recommended_next_tools = recommend_workspace_search_next_tools(&candidates);
    let trace = WorkspaceSearchTrace {
        searched_files: state.scanned_files,
        skipped_files: state.skipped_files,
        truncated: state.truncated,
        fallbacks_used,
        needs_clarification,
    };

    let mut strategy = vec![
        "intent:auto".to_string(),
        "path_discovery".to_string(),
        "lightweight_candidate_ranking".to_string(),
        "literal_grep".to_string(),
        "snippet_expansion".to_string(),
    ];
    if include_office_search {
        strategy.push("office_preview_anchor_integration".to_string());
    }

    let output = WorkspaceSearchOutput {
        query: query.to_string(),
        plan,
        strategy,
        needs_clarification,
        candidates,
        snippets,
        recommended_next_tools,
        skipped: state.skipped,
        limits: WorkspaceSearchLimits {
            scanned_files: state.scanned_files,
            skipped_files: state.skipped_files,
            scanned_bytes: state.scanned_bytes,
            truncated: state.truncated,
            elapsed_ms: started.elapsed().as_millis(),
        },
        trace,
    };
    tracing::info!(
        target: "relay.runtime.search",
        tool = "workspace_search",
        query = %output.query,
        candidates = output.candidates.len(),
        snippets = output.snippets.len(),
        scanned_files = output.limits.scanned_files,
        skipped_files = output.limits.skipped_files,
        scanned_bytes = output.limits.scanned_bytes,
        truncated = output.limits.truncated,
        elapsed_ms = output.limits.elapsed_ms,
        needs_clarification = output.needs_clarification,
        "workspace_search completed"
    );
    Ok(output)
}

fn build_workspace_search_plan(
    input: &WorkspaceSearchInput,
    query: &str,
    terms: &[String],
    search_roots: &[PathBuf],
    include_ext: Option<&HashSet<String>>,
    workspace_root: &Path,
) -> WorkspaceSearchPlan {
    let mode = input.mode.as_deref().unwrap_or("auto");
    let exact_path = exact_workspace_search_path(query, workspace_root);
    let advice = advise_workspace_search(input, query, exact_path.is_some(), include_ext);
    let intent = match advice.intent {
        SearchIntent::ExactPath => "exact_path_read_recommended",
        SearchIntent::Filename => "path_discovery",
        SearchIntent::CodeSymbol => "code_symbol_search",
        SearchIntent::RelatedImplementation => "related_implementation_search",
        SearchIntent::Documentation => "documentation_search",
        SearchIntent::OfficeEvidence => "office_evidence_search",
        SearchIntent::DiagnosticFollowup => "diagnostic_followup_search",
        SearchIntent::Unknown => match mode {
            "code" => "implementation_search",
            "path" => "path_discovery",
            "office" => "office_evidence_search",
            "text" => "text_evidence_search",
            _ => "workspace_evidence_search",
        },
    }
    .to_string();

    let mut query_variants = Vec::new();
    for term in terms.iter().take(32) {
        if !query_variants.iter().any(|existing| existing == term) {
            query_variants.push(term.clone());
        }
    }

    let mut retrievers = vec![advice.primary.to_string()];
    for fallback in &advice.fallbacks {
        if !retrievers.iter().any(|existing| existing == fallback) {
            retrievers.push((*fallback).to_string());
        }
    }

    let scope = search_roots
        .iter()
        .map(|root| {
            root.strip_prefix(workspace_root)
                .ok()
                .filter(|relative| !relative.as_os_str().is_empty())
                .unwrap_or(root)
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();

    WorkspaceSearchPlan {
        intent,
        query_variants,
        retrievers,
        scope,
        reason: if let Some(path) = exact_path {
            format!(
                "query appears to name an exact workspace file {}; read_file is the preferred next tool; {}",
                path.to_string_lossy(),
                advice.reason
            )
        } else {
            format!(
                "{}; require_read_file_before_conclusion={}",
                advice.reason, advice.require_read_file_before_conclusion
            )
        },
    }
}

fn advise_workspace_search(
    input: &WorkspaceSearchInput,
    query: &str,
    exact_path: bool,
    include_ext: Option<&HashSet<String>>,
) -> SearchToolAdvice {
    let lower = query.to_ascii_lowercase();
    if exact_path {
        return SearchToolAdvice {
            intent: SearchIntent::ExactPath,
            primary: "read_file",
            fallbacks: Vec::new(),
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: exact path queries should bypass broad search"),
        };
    }
    if matches!(input.mode.as_deref(), Some("office"))
        || workspace_search_should_include_office(input.mode.as_deref(), include_ext)
            && (lower.contains("pdf")
                || lower.contains("docx")
                || lower.contains("xlsx")
                || lower.contains("pptx")
                || query.contains("文書"))
    {
        return SearchToolAdvice {
            intent: SearchIntent::OfficeEvidence,
            primary: "office",
            fallbacks: vec!["path", "text"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: Office/PDF evidence can use office_search previews before read_file"),
        };
    }
    if lower.contains("diagnostic") || lower.contains("error") || query.contains("診断") {
        return SearchToolAdvice {
            intent: SearchIntent::DiagnosticFollowup,
            primary: "text",
            fallbacks: vec!["path", "docs", "recent-change"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: diagnostics need text evidence plus nearby docs/recent changes"),
        };
    }
    if lower.contains("readme")
        || lower.contains("docs")
        || lower.contains("plans")
        || lower.contains("alignment")
        || query.contains("ドキュメント")
    {
        return SearchToolAdvice {
            intent: SearchIntent::Documentation,
            primary: "docs",
            fallbacks: vec!["path", "text"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: documentation lookup prioritizes docs retriever"),
        };
    }
    if lower.contains("fn ")
        || lower.contains("struct")
        || lower.contains("enum")
        || lower.contains("symbol")
        || lower.contains("command")
    {
        return SearchToolAdvice {
            intent: SearchIntent::CodeSymbol,
            primary: "symbol",
            fallbacks: vec!["path", "text", "recent-change"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: symbol-like lookup prioritizes symbol retriever"),
        };
    }
    if matches!(input.mode.as_deref(), Some("path"))
        || lower.contains(".rs")
        || lower.contains(".ts")
        || lower.contains("filename")
        || query.contains("ファイル名")
    {
        return SearchToolAdvice {
            intent: SearchIntent::Filename,
            primary: "path",
            fallbacks: vec!["text"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: filename lookup prioritizes path retriever"),
        };
    }
    if lower.contains("implementation")
        || lower.contains("implement")
        || lower.contains("agentic")
        || lower.contains("tool call")
        || query.contains("実装")
        || query.contains("改善")
    {
        return SearchToolAdvice {
            intent: SearchIntent::RelatedImplementation,
            primary: "text",
            fallbacks: vec!["path", "symbol", "docs", "recent-change"],
            require_read_file_before_conclusion: true,
            reason: String::from("SearchToolAdvisor: implementation lookup uses hybrid path/text/symbol/docs/recent retrievers"),
        };
    }
    SearchToolAdvice {
        intent: SearchIntent::Unknown,
        primary: "path",
        fallbacks: vec!["text"],
        require_read_file_before_conclusion: true,
        reason: String::from("SearchToolAdvisor: default read-only workspace search"),
    }
}

fn exact_workspace_search_path(query: &str, workspace_root: &Path) -> Option<PathBuf> {
    let trimmed = query
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'');
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return None;
    }
    let candidate = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        workspace_root.join(trimmed)
    };
    let canonical = candidate.canonicalize().ok()?;
    if canonical.is_file() && canonical.starts_with(&workspace_root) {
        Some(canonical)
    } else {
        None
    }
}

fn recommend_workspace_search_next_tools(
    candidates: &[WorkspaceSearchCandidate],
) -> Vec<WorkspaceSearchRecommendedNextTool> {
    let Some(top) = candidates.first() else {
        return Vec::new();
    };
    let tied = candidates
        .iter()
        .take_while(|candidate| (candidate.score - top.score).abs() < f64::EPSILON)
        .take(3)
        .collect::<Vec<_>>();
    if tied.len() > 1 {
        return tied
            .into_iter()
            .map(|candidate| WorkspaceSearchRecommendedNextTool {
                tool: String::from("read_file"),
                path: candidate.path.clone(),
                reason: String::from(
                    "top candidates are tied; inspect each file before choosing or making a final judgment",
                ),
            })
            .collect();
    }
    vec![WorkspaceSearchRecommendedNextTool {
        tool: String::from("read_file"),
        path: top.path.clone(),
        reason: String::from(
            "top ranked candidate; snippets are discovery evidence and need read_file expansion before important conclusions",
        ),
    }]
}

fn integrate_rg_content_search(
    terms: &[String],
    search_roots: &[PathBuf],
    include_ext: Option<&HashSet<String>>,
    workspace_root: &Path,
    ignore_matcher: &WorkspaceIgnoreMatcher,
    candidate_map: &mut BTreeMap<String, WorkspaceCandidateAccumulator>,
    snippets: &mut Vec<WorkspaceSearchSnippet>,
    state: &mut SearchState,
    max_bytes: u64,
    max_snippets: usize,
) {
    if snippets.len() >= max_snippets {
        return;
    }
    let globs = workspace_search_rg_globs(include_ext);
    let terms = terms
        .iter()
        .filter(|term| term.len() >= 2)
        .take(6)
        .map(|term| escape_rg_literal(term))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return;
    }
    let pattern = terms.join("|");
    let limit = max_snippets.saturating_mul(8).max(32);
    let mut hits = Vec::new();
    for root in search_roots {
        let result = match search_backend::rg_search(
            root,
            search_backend::RgSearchOptions {
                limit: Some(limit),
                ..search_backend::RgSearchOptions::new(&pattern, &globs)
            },
        ) {
            Ok(Some(result)) => result,
            Ok(None) => continue,
            Err(error) => {
                state.skip(root.to_string_lossy(), format!("rg_search_error:{error}"));
                continue;
            }
        };
        state.truncated |= result.partial;
        for hit in result.matches {
            let canonical = match hit.path.canonicalize() {
                Ok(canonical) if canonical.starts_with(workspace_root) => canonical,
                Ok(canonical) => {
                    state.skip(canonical.to_string_lossy(), "outside_workspace");
                    continue;
                }
                Err(error) => {
                    state.skip(
                        hit.path.to_string_lossy(),
                        format!("canonicalize_error:{error}"),
                    );
                    continue;
                }
            };
            if is_sensitive_workspace_search_path(&canonical)
                || is_ignored_workspace_search_path(&canonical)
                || ignore_matcher.is_match(workspace_root, &canonical)
                || !workspace_search_ext_allowed(&canonical, include_ext)
            {
                continue;
            }
            let metadata = match fs::metadata(&canonical) {
                Ok(metadata) => metadata,
                Err(error) => {
                    state.skip(canonical.to_string_lossy(), format!("metadata_error:{error}"));
                    continue;
                }
            };
            if metadata.len() > max_bytes {
                state.skip(canonical.to_string_lossy(), "max_bytes");
                continue;
            }
            hits.push((metadata_modified_ms(&metadata), canonical, hit));
        }
    }
    hits.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.line_number.cmp(&right.2.line_number))
    });
    for (_, canonical, hit) in hits {
        if snippets.len() >= max_snippets {
            state.truncated = true;
            break;
        }
        let path = canonical.to_string_lossy().into_owned();
        let entry = candidate_map
            .entry(path.clone())
            .or_insert_with(|| WorkspaceCandidateAccumulator::new(path.clone()));
        entry.features.content_match_count += 1;
        entry.add(18.0, 1, "rg content match".to_string());
        snippets.push(WorkspaceSearchSnippet {
            path,
            anchor: None,
            line_start: hit.line_number,
            line_end: hit.line_number,
            preview: hit.line.trim_end_matches(['\r', '\n']).to_string(),
        });
    }
}

fn escape_rg_literal(term: &str) -> String {
    let mut escaped = String::with_capacity(term.len());
    for ch in term.chars() {
        if matches!(
            ch,
            '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn integrate_office_search(
    query: &str,
    terms: &[String],
    search_roots: &[PathBuf],
    candidate_map: &mut BTreeMap<String, WorkspaceCandidateAccumulator>,
    snippets: &mut Vec<WorkspaceSearchSnippet>,
    state: &mut SearchState,
    include_ext: Option<&HashSet<String>>,
    max_files: usize,
    max_snippets: usize,
    deadline: Instant,
) {
    if Instant::now() >= deadline {
        state.truncated = true;
        state.skip("(office_search)", "duration_budget_exceeded");
        return;
    }
    let office_exts = workspace_search_office_exts(include_ext);
    if office_exts.is_empty() {
        return;
    }
    let office_paths = workspace_search_office_paths(search_roots, &office_exts);
    if office_paths.is_empty() {
        return;
    }
    let patterns = workspace_search_office_patterns(query, terms);
    let mut seen_snippets = HashSet::new();
    for pattern in patterns {
        if snippets.len() >= max_snippets {
            break;
        }
        if Instant::now() >= deadline {
            state.truncated = true;
            state.skip("(office_search)", "duration_budget_exceeded");
            break;
        }
        match office::office_search(&office::OfficeSearchInput {
            pattern,
            paths: office_paths.clone(),
            regex: Some(false),
            include_ext: Some(office_exts.clone()),
            case_insensitive: Some(true),
            context: Some(120),
            max_results: Some(max_snippets.saturating_sub(snippets.len()).max(1)),
            max_files: Some(max_files),
        }) {
            Ok(office_output) => {
                state.truncated |= office_output.files_truncated
                    || office_output.results_truncated
                    || office_output.wall_clock_truncated;
                for error in office_output.errors {
                    state.skip(error.path, format!("office_search:{}:{}", error.kind, error.reason));
                }
                for hit in office_output.results {
                    let entry = candidate_map
                        .entry(hit.path.clone())
                        .or_insert_with(|| WorkspaceCandidateAccumulator::new(hit.path.clone()));
                    entry.features.office_anchor = true;
                    entry.add(25.0, 1, format!("office anchor {}", hit.anchor));
                    let snippet_key = (hit.path.clone(), hit.anchor.clone(), hit.preview.clone());
                    if snippets.len() < max_snippets && seen_snippets.insert(snippet_key) {
                        snippets.push(WorkspaceSearchSnippet {
                            path: hit.path,
                            anchor: Some(hit.anchor),
                            line_start: 0,
                            line_end: 0,
                            preview: hit.preview,
                        });
                    }
                }
            }
            Err(error) => state.skip("(office_search)", format!("office_search_error:{error}")),
        }
    }
}

fn workspace_search_roots(
    paths: Option<&Vec<String>>,
    workspace_root: &Path,
) -> io::Result<Vec<PathBuf>> {
    let requested = paths
        .filter(|paths| !paths.is_empty())
        .cloned()
        .unwrap_or_else(|| vec![String::from(".")]);
    let mut roots = Vec::new();
    for path in requested {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = if Path::new(trimmed).is_absolute() {
            PathBuf::from(trimmed)
        } else {
            workspace_root.join(trimmed)
        };
        let canonical = candidate.canonicalize()?;
        if !canonical.starts_with(workspace_root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "workspace_search path {} escapes workspace boundary {}",
                    canonical.display(),
                    workspace_root.display()
                ),
            ));
        }
        roots.push(canonical);
    }
    if roots.is_empty() {
        roots.push(workspace_root.to_path_buf());
    }
    Ok(roots)
}

fn normalize_workspace_search_exts(input: Option<&Vec<String>>) -> Option<HashSet<String>> {
    input
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let ext = item.trim().trim_start_matches('.').to_ascii_lowercase();
                    (!ext.is_empty()).then_some(ext)
                })
                .collect()
        })
        .filter(|items: &HashSet<String>| !items.is_empty())
}

fn workspace_search_ext_allowed(path: &Path, include_ext: Option<&HashSet<String>>) -> bool {
    let Some(include_ext) = include_ext else {
        return true;
    };
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| include_ext.contains(&extension.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn workspace_search_terms(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let lower_query = query.trim().to_ascii_lowercase();
    if !lower_query.is_empty() {
        terms.push(lower_query);
    }
    let normalized_query = normalize_fullwidth_ascii(query);
    if normalized_query != query {
        let normalized_lower = normalized_query.trim().to_ascii_lowercase();
        if !normalized_lower.is_empty() && !terms.iter().any(|existing| existing == &normalized_lower)
        {
            terms.push(normalized_lower);
        }
    }
    for token in normalized_query
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-'))
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        let token = token.to_ascii_lowercase();
        add_case_variants(&token, &mut terms);
        if !terms.iter().any(|existing| existing == &token) {
            terms.push(token);
        }
    }
    expand_workspace_search_terms(&normalized_query, &mut terms);
    terms
}

fn normalize_fullwidth_ascii(input: &str) -> String {
    input
        .chars()
        .map(|ch| match ch {
            '\u{ff01}'..='\u{ff5e}' => char::from_u32(ch as u32 - 0xfee0).unwrap_or(ch),
            '\u{3000}' => ' ',
            _ => ch,
        })
        .collect()
}

fn add_unique_term(terms: &mut Vec<String>, term: String) {
    if !term.is_empty() && !terms.iter().any(|existing| existing == &term) {
        terms.push(term);
    }
}

fn add_case_variants(token: &str, terms: &mut Vec<String>) {
    let lower = token.to_ascii_lowercase();
    for separator in ['_', '-'] {
        if lower.contains(separator) {
            let parts = lower
                .split(separator)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>();
            if parts.len() >= 2 {
                add_unique_term(terms, parts.join(if separator == '_' { "-" } else { "_" }));
                add_unique_term(terms, parts.join(""));
                let pascal = parts
                    .iter()
                    .map(|part| {
                        let mut chars = part.chars();
                        match chars.next() {
                            Some(first) => {
                                format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
                            }
                            None => String::new(),
                        }
                    })
                    .collect::<String>();
                if !pascal.is_empty() {
                    let mut camel = pascal.clone();
                    if let Some(first) = camel.get_mut(0..1) {
                        first.make_ascii_lowercase();
                    }
                    add_unique_term(terms, camel.to_ascii_lowercase());
                    add_unique_term(terms, pascal.to_ascii_lowercase());
                }
            }
        }
    }
    if lower.contains(' ') {
        let parts = lower
            .split_whitespace()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if parts.len() >= 2 {
            add_unique_term(terms, parts.join("_"));
            add_unique_term(terms, parts.join("-"));
            add_unique_term(terms, parts.join(""));
        }
    }
}

fn expand_workspace_search_terms(query: &str, terms: &mut Vec<String>) {
    let lower = query.to_ascii_lowercase();
    let mut add = |term: &str| {
        let term = term.to_ascii_lowercase();
        if !term.is_empty() && !terms.iter().any(|existing| existing == &term) {
            terms.push(term);
        }
    };

    if lower.contains("search") || query.contains("検索") || query.contains("探索") {
        add("search");
        add("workspace_search");
        add("grep");
        add("grep_search");
        add("glob");
        add("office_search");
        add("ranking");
        add("検索");
        add("探索");
    }
    if lower.contains("implementation") || lower.contains("implement") || query.contains("実装") {
        add("implementation");
        add("implement");
        add("実装");
    }
    if lower.contains("related") || query.contains("関連") || query.contains("関係") {
        add("related");
        add("関連");
        add("関係");
    }
    if lower.contains("required")
        || lower.contains("needed")
        || query.contains("必要")
        || query.contains("要る")
    {
        add("required");
        add("needed");
        add("必要");
    }
    if lower.contains("file") || query.contains("ファイル") {
        add("file");
        add("ファイル");
    }
    if lower.contains("agentic") || query.contains("エージェント") {
        add("agentic");
        add("agent");
        add("エージェント");
    }
    if lower.contains("agentic search") || (lower.contains("agentic") && lower.contains("search"))
    {
        add("workspace_search");
        add("grep_search");
        add("search.rs");
        add("retriever");
        add("ranking");
        add("検索改善");
    }
    if query.contains("検索改善") || (query.contains("検索") && query.contains("改善")) {
        add("agentic");
        add("workspace_search");
        add("grep_search");
        add("search.rs");
        add("retriever");
        add("ranking");
        add("検索改善");
    }
    if lower.contains("tool call")
        || lower.contains("toolcall")
        || lower.contains("tool-call")
        || query.contains("ツール呼び出し")
    {
        add("tool call");
        add("relay_tool");
        add("toolcall");
        add("response_parser");
        add("orchestrator");
    }
    if lower.contains("approval") || query.contains("承認") {
        add("approval");
        add("承認");
        add("permission");
        add("approval.rs");
        add("approval_needed");
        add("approval-needed");
        add("approvalneeded");
        add("orchestrator");
    }
    if lower.contains("cash flow") || lower.contains("cashflow") || query.contains("キャッシュフロー")
    {
        add("cash flow");
        add("cashflow");
        add("cf");
        add("cfs");
        add("キャッシュフロー");
        add("キャッシュ・フロー");
    }
}

fn score_workspace_path(
    path: &str,
    terms: &[String],
    accumulator: &mut WorkspaceCandidateAccumulator,
) {
    let lower = path.to_ascii_lowercase();
    for term in terms {
        if lower.contains(term) {
            accumulator.features.path_match = true;
            accumulator.add(30.0, 1, format!("query term appears in path: {term}"));
        }
    }
    let filename = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    for term in terms {
        if filename.contains(term) {
            accumulator.features.filename_match = true;
            accumulator.add(30.0, 1, format!("query term appears in filename: {term}"));
        }
    }
}

fn workspace_search_scan_priority(accumulator: &WorkspaceCandidateAccumulator) -> i64 {
    let mut priority = 0;
    if accumulator.features.filename_match {
        priority += 3_000;
    }
    if accumulator.features.path_match {
        priority += 2_000;
    }
    if accumulator.features.symbol_match_count > 0 {
        priority += 1_500;
    }
    if accumulator.features.office_anchor {
        priority += 1_000;
    }
    priority += (accumulator.match_count.min(20) as i64) * 100;
    priority += accumulator.score.round() as i64;
    if accumulator.features.recently_modified {
        priority += 25;
    }
    priority - i64::from(accumulator.features.ignored_generated_penalty.max(0))
}

fn score_extension(path: &Path, accumulator: &mut WorkspaceCandidateAccumulator) {
    let Some(ext) = path.extension().and_then(|extension| extension.to_str()) else {
        return;
    };
    let score = match ext.to_ascii_lowercase().as_str() {
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "cs" => 10.0,
        "md" | "mdx" | "txt" | "toml" | "json" | "yaml" | "yml" => 6.0,
        "docx" | "xlsx" | "pptx" | "pdf" => 5.0,
        _ => 1.0,
    };
    accumulator.add(score, 0, format!("{ext} file"));
}

fn score_recency_from_metadata(
    metadata: &fs::Metadata,
    accumulator: &mut WorkspaceCandidateAccumulator,
) {
    let Ok(modified) = metadata.modified() else {
        return;
    };
    let Ok(age) = modified.elapsed() else {
        return;
    };
    if age.as_secs() <= 60 * 60 * 24 * 30 {
        accumulator.features.recently_modified = true;
        accumulator.add(5.0, 0, "recently modified");
    }
}

fn path_modified_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .map(|metadata| metadata_modified_ms(&metadata))
        .unwrap_or(0)
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis())
}

fn score_workspace_text(
    path: &str,
    content: &str,
    terms: &[String],
    context: usize,
    accumulator: &mut WorkspaceCandidateAccumulator,
) -> Vec<WorkspaceSearchSnippet> {
    let mut snippets = Vec::new();
    let lines = content.lines().collect::<Vec<_>>();
    let lower_lines = lines
        .iter()
        .map(|line| line.to_ascii_lowercase())
        .collect::<Vec<_>>();
    for (index, lower_line) in lower_lines.iter().enumerate() {
        let matched_terms = terms
            .iter()
            .filter(|term| lower_line.contains(term.as_str()))
            .map(String::as_str)
            .collect::<Vec<_>>();
        if matched_terms.is_empty() {
            continue;
        }
        accumulator.add(
            25.0 + matched_terms.len() as f64,
            matched_terms.len(),
            format!("{} content matches: {}", matched_terms.len(), matched_terms.join(",")),
        );
        accumulator.features.content_match_count += matched_terms.len();
        if looks_like_symbol_line(lines[index]) {
            accumulator.features.symbol_match_count += matched_terms.len();
            accumulator.add(
                12.0,
                matched_terms.len(),
                format!("symbol-like line matches: {}", matched_terms.join(",")),
            );
        }
        let start = index.saturating_sub(context);
        let end = (index + context + 1).min(lines.len());
        snippets.push(WorkspaceSearchSnippet {
            path: path.to_string(),
            anchor: None,
            line_start: start + 1,
            line_end: end,
            preview: lines[start..end].join("\n"),
        });
    }
    snippets
}

fn looks_like_symbol_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    [
        "fn ",
        "pub fn ",
        "struct ",
        "pub struct ",
        "enum ",
        "pub enum ",
        "impl ",
        "trait ",
        "pub trait ",
        "function ",
        "const ",
        "pub const ",
        "command ",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

fn is_office_workspace_search_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("docx" | "xlsx" | "pptx" | "pdf")
    )
}

fn workspace_search_should_include_office(
    mode: Option<&str>,
    _include_ext: Option<&HashSet<String>>,
) -> bool {
    matches!(mode, Some("office"))
}

fn workspace_search_office_exts(include_ext: Option<&HashSet<String>>) -> Vec<String> {
    let allowed = ["docx", "xlsx", "pptx", "pdf"];
    allowed
        .iter()
        .filter(|ext| include_ext.is_none_or(|include_ext| include_ext.contains::<str>(*ext)))
        .map(|ext| (*ext).to_string())
        .collect()
}

fn workspace_search_office_paths(search_roots: &[PathBuf], office_exts: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for root in search_roots {
        let root = root.to_string_lossy();
        for ext in office_exts {
            paths.push(format!("{}/**/*.{}", root.trim_end_matches(['/', '\\']), ext));
        }
    }
    paths
}

fn workspace_search_office_patterns(query: &str, terms: &[String]) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut seen = HashSet::new();
    let lower_query = query.to_ascii_lowercase();
    if (lower_query.contains("cash") && lower_query.contains("flow"))
        || lower_query.contains("cfs")
        || (query.contains("キャッシュ") && query.contains("フロー"))
    {
        for pattern in ["キャッシュフロー", "キャッシュ・フロー", "CFS", "計算書", "CF"] {
            add_unique_office_pattern(&mut patterns, &mut seen, pattern);
        }
    }
    for term in terms.iter().filter(|term| term.chars().count() >= 3) {
        add_unique_office_pattern(&mut patterns, &mut seen, term);
        if patterns.len() >= 6 {
            break;
        }
    }
    if patterns.is_empty() {
        add_unique_office_pattern(&mut patterns, &mut seen, query);
    }
    patterns.truncate(4);
    patterns
}

fn add_unique_office_pattern(patterns: &mut Vec<String>, seen: &mut HashSet<String>, pattern: &str) {
    let trimmed = pattern.trim();
    if trimmed.is_empty() {
        return;
    }
    if seen.insert(trimmed.to_ascii_lowercase()) {
        patterns.push(trimmed.to_string());
    }
}

fn is_ignored_workspace_search_path(path: &Path) -> bool {
    const IGNORED_DIRS: &[&str] = &[
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".venv",
        "__pycache__",
        "out",
        "coverage",
    ];
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy();
        IGNORED_DIRS.iter().any(|ignored| name == *ignored)
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::io;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::{workspace_search, workspace_search_with_root, WorkspaceSearchInput};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        std::env::temp_dir().join(format!("clawd-search-{name}-{unique}"))
    }

    #[test]
    fn agentic_search_content_then_read() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search");
        std::fs::create_dir_all(dir.join("src")).expect("src should be created");
        std::fs::create_dir_all(dir.join("node_modules/pkg")).expect("ignored should be created");
        fs::write(
            dir.join("src/search.rs"),
            "pub fn workspace_search() {\n    // agentic search implementation\n}\n",
        )
        .expect("write search file");
        fs::write(
            dir.join("node_modules/pkg/noise.rs"),
            "agentic search implementation noise\n",
        )
        .expect("write ignored file");
        fs::write(dir.join("src/skip.md"), "agentic search implementation\n")
            .expect("write skipped extension");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("agentic search implementation"),
            paths: Some(vec![String::from("src"), String::from("node_modules")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(20),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(!output.needs_clarification);
        assert_eq!(output.plan.intent, "related_implementation_search");
        assert!(output.plan.retrievers.contains(&String::from("path")));
        assert!(output.plan.retrievers.contains(&String::from("text")));
        assert!(!output.candidates.is_empty());
        assert!(output.candidates[0].path.ends_with("src/search.rs"));
        assert_eq!(output.candidates[0].confidence, "high");
        assert!(output.candidates[0].features.filename_match);
        assert!(output.candidates[0].features.path_match);
        assert!(output.candidates[0].features.content_match_count > 0);
        assert!(output.candidates[0].features.symbol_match_count > 0);
        assert!(output.candidates[0]
            .why
            .iter()
            .any(|why| why.contains("content matches")));
        assert_eq!(output.recommended_next_tools.len(), 1);
        assert_eq!(output.recommended_next_tools[0].tool, "read_file");
        assert!(output.recommended_next_tools[0]
            .path
            .ends_with("src/search.rs"));
        assert!(output.recommended_next_tools[0]
            .reason
            .contains("top ranked candidate"));
        assert!(output.candidates[0].score > 0.0);
        assert!(output.candidates[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("content matches")));
        assert!(output.snippets[0]
            .preview
            .contains("agentic search implementation"));
        assert_eq!(output.limits.scanned_files, 1);
        assert!(output.limits.skipped_files >= 1);
        assert!(!output.skipped.is_empty());
        assert_eq!(output.trace.searched_files, output.limits.scanned_files);
        assert_eq!(output.trace.skipped_files, output.limits.skipped_files);
        assert_eq!(output.trace.needs_clarification, output.needs_clarification);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_with_root_uses_session_workspace_not_process_cwd() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let process_dir = temp_path("workspace-search-process-cwd");
        let workspace_dir = temp_path("workspace-search-session-cwd");
        std::fs::create_dir_all(&process_dir).expect("process dir should be created");
        std::fs::create_dir_all(workspace_dir.join("docs")).expect("docs should be created");
        fs::write(
            workspace_dir.join("docs/evidence.md"),
            "session workspace needle\n",
        )
        .expect("write evidence");
        std::env::set_current_dir(&process_dir).expect("set process cwd");

        let output = workspace_search_with_root(
            &WorkspaceSearchInput {
                query: String::from("session workspace needle"),
                paths: Some(vec![String::from("docs")]),
                mode: Some(String::from("text")),
                include_ext: Some(vec![String::from("md")]),
                max_files: Some(10),
                max_snippets: Some(5),
                max_bytes: Some(2 * 1024 * 1024),
                max_duration_ms: Some(5_000),
                context: Some(1),
                literal: Some(true),
            },
            &workspace_dir,
        )
        .expect("workspace_search should use supplied session workspace root");

        assert!(output
            .candidates
            .iter()
            .any(|candidate| candidate.path.replace('\\', "/").ends_with("docs/evidence.md")));
        assert!(output
            .snippets
            .iter()
            .any(|snippet| snippet.preview.contains("session workspace needle")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(process_dir);
        let _ = fs::remove_dir_all(workspace_dir);
    }

    #[test]
    fn agentic_search_no_evidence_honesty() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-empty");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("notes.txt"), "alpha beta\n").expect("write file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("missing needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.needs_clarification);
        assert!(output.candidates.is_empty());
        assert!(output.snippets.is_empty());
        assert!(output.recommended_next_tools.is_empty());
        assert_eq!(output.limits.scanned_files, 1);
        assert!(output.trace.needs_clarification);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn search_workspace_boundary() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-boundary");
        let outside = temp_path("workspace-search-outside");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        std::fs::create_dir_all(&outside).expect("outside should be created");
        std::env::set_current_dir(&dir).expect("set cwd");

        let err = workspace_search(&WorkspaceSearchInput {
            query: String::from("anything"),
            paths: Some(vec![outside.to_string_lossy().into_owned()]),
            mode: Some(String::from("text")),
            include_ext: None,
            max_files: None,
            max_snippets: None,
            max_bytes: None,
            max_duration_ms: None,
            context: None,
            literal: None,
        })
        .expect_err("outside path should be rejected");

        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn workspace_search_respects_gitignore_and_binary_skip_reasons() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-gitignore");
        std::fs::create_dir_all(dir.join("ignored")).expect("ignored dir");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join(".gitignore"), "ignored/**\n").expect("gitignore");
        fs::write(dir.join("ignored/hit.txt"), "needle\n").expect("ignored hit");
        fs::write(dir.join("src/binary.bin"), b"needle\0binary").expect("binary");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: None,
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.candidates.is_empty());
        assert!(output
            .skipped
            .iter()
            .any(|skip| skip.reason == "ignored_by_gitignore"));
        assert!(output.skipped.iter().any(|skip| skip.reason == "binary"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn agentic_search_path_discovery() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-path-discovery");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join("src/agentic_search_router.rs"), "pub fn route() {}\n")
            .expect("path target");
        fs::write(dir.join("src/unrelated.rs"), "pub fn route() {}\n").expect("other file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("agentic search router"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("path")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(5),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(!output.candidates.is_empty());
        assert!(output.candidates[0]
            .path
            .ends_with("src/agentic_search_router.rs"));
        assert!(output.candidates[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("path") || reason.contains("filename")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn agentic_search_office_pdf() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-office-pdf");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("contract.pdf"), b"%PDF-1.4\nsearch needle\n").expect("pdf fixture");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("search needle"),
            paths: Some(vec![String::from(".")]),
            mode: Some(String::from("office")),
            include_ext: Some(vec![String::from("pdf")]),
            max_files: Some(10),
            max_snippets: Some(5),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should keep office/pdf routing read-only");

        assert!(output
            .strategy
            .iter()
            .any(|step| step == "office_preview_anchor_integration"));
        assert!(output
            .skipped
            .iter()
            .all(|skip| !skip.path.ends_with("contract.pdf") || skip.reason != "non_utf8"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_only_scans_office_in_explicit_office_mode() {
        assert!(!super::workspace_search_should_include_office(
            Some("auto"),
            None
        ));

        let include_ext = HashSet::from([String::from("pdf")]);
        assert!(!super::workspace_search_should_include_office(
            Some("auto"),
            Some(&include_ext)
        ));
        assert!(super::workspace_search_should_include_office(
            Some("office"),
            None
        ));
    }

    #[test]
    fn search_budget_truncation() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-budget");
        std::fs::create_dir_all(&dir).expect("directory should be created");
        fs::write(dir.join("one.txt"), "needle one\n").expect("one");
        fs::write(dir.join("two.txt"), "needle two\n").expect("two");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(1),
            max_snippets: Some(5),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.limits.truncated);
        assert!(!output.candidates.is_empty());
        assert!(output.limits.scanned_files >= 1);
        assert!(output.limits.skipped_files >= 1);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_scans_recent_files_first_under_budget() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-recent-budget");
        std::fs::create_dir_all(dir.join("a_old")).expect("old dir");
        std::fs::create_dir_all(dir.join("z_new")).expect("new dir");
        fs::write(dir.join("a_old/old.txt"), "needle old\n").expect("old file");
        std::thread::sleep(Duration::from_millis(1100));
        fs::write(dir.join("z_new/new.txt"), "needle new\n").expect("new file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(1),
            max_snippets: Some(5),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.limits.truncated);
        assert_eq!(output.limits.scanned_files, 1);
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("z_new/new.txt"));
        assert!(output.snippets[0].preview.contains("needle new"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_preserves_path_match_under_recent_budget() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-path-budget");
        std::fs::create_dir_all(dir.join("a_old")).expect("old dir");
        std::fs::create_dir_all(dir.join("z_new")).expect("new dir");
        fs::write(
            dir.join("a_old/agentic_search_router.rs"),
            "pub fn route() {\n    // agentic search router\n}\n",
        )
        .expect("path target");
        std::thread::sleep(Duration::from_millis(1100));
        fs::write(dir.join("z_new/unrelated.rs"), "pub fn newer() {}\n").expect("newer file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("agentic search router"),
            paths: None,
            mode: Some(String::from("path")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(1),
            max_snippets: Some(5),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.limits.truncated);
        assert_eq!(output.limits.scanned_files, 1);
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0]
            .path
            .ends_with("a_old/agentic_search_router.rs"));
        assert!(output.candidates[0].features.filename_match);
        assert!(output
            .snippets
            .iter()
            .any(|snippet| snippet.preview.contains("agentic search router")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn search_ignores_generated_dirs() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-generated");
        for generated in ["node_modules/pkg", "target/debug", "dist/assets"] {
            std::fs::create_dir_all(dir.join(generated)).expect("generated dir");
        }
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join("node_modules/pkg/hit.txt"), "generated needle\n").expect("node");
        fs::write(dir.join("target/debug/hit.txt"), "generated needle\n").expect("target");
        fs::write(dir.join("dist/assets/hit.txt"), "generated needle\n").expect("dist");
        fs::write(dir.join("src/source.txt"), "generated needle\n").expect("source");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("generated needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(20),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/source.txt"));
        assert!(!output
            .candidates
            .iter()
            .any(|candidate| candidate.path.contains("node_modules")
                || candidate.path.contains("target")
                || candidate.path.contains("dist")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn search_ambiguous_candidates() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-ambiguous");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join("src/a.txt"), "shared ambiguous marker\n").expect("a");
        fs::write(dir.join("src/b.txt"), "shared ambiguous marker\n").expect("b");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("shared ambiguous marker"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(1),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.candidates.len() >= 2);
        assert_eq!(output.candidates[0].score, output.candidates[1].score);
        assert!(output.needs_clarification);
        assert!(output.recommended_next_tools.len() >= 2);
        assert!(output
            .recommended_next_tools
            .iter()
            .all(|tool| tool.tool == "read_file"));
        assert!(output
            .recommended_next_tools
            .iter()
            .any(|tool| tool.path.ends_with("src/a.txt")));
        assert!(output
            .recommended_next_tools
            .iter()
            .any(|tool| tool.path.ends_with("src/b.txt")));
        assert!(output
            .recommended_next_tools
            .iter()
            .all(|tool| tool.reason.contains("tied")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_expands_english_japanese_query_terms() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-query-expansion");
        std::fs::create_dir_all(dir.join("docs")).expect("docs dir");
        fs::write(dir.join("docs/notes.md"), "検索 runtime evidence\n").expect("notes");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("search runtime evidence"),
            paths: Some(vec![String::from("docs")]),
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("md")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output
            .plan
            .query_variants
            .iter()
            .any(|term| term == "検索"));
        assert_eq!(output.candidates.len(), 1);
        assert!(output.snippets[0].preview.contains("検索"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_handles_ambiguous_japanese_search_improvement_query() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-ambiguous-ja");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(
            dir.join("src/search.rs"),
            "pub fn workspace_search_retriever() {\n    // ranking for agentic search\n}\n",
        )
        .expect("search file");
        fs::write(dir.join("src/unrelated.rs"), "pub fn unrelated() {}\n").expect("unrelated");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("検索改善"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(!output.needs_clarification);
        assert_eq!(output.trace.needs_clarification, output.needs_clarification);
        assert_eq!(output.plan.intent, "related_implementation_search");
        for expected in ["検索改善", "workspace_search", "retriever", "ranking"] {
            assert!(
                output
                    .plan
                    .query_variants
                    .iter()
                    .any(|term| term == expected),
                "missing expansion term {expected:?}: {:?}",
                output.plan.query_variants
            );
        }
        assert!(!output.candidates.is_empty());
        assert!(output.candidates[0].path.ends_with("src/search.rs"));
        assert!(output.candidates[0].features.content_match_count > 0);
        assert_eq!(output.recommended_next_tools.len(), 1);
        assert_eq!(output.recommended_next_tools[0].tool, "read_file");
        assert!(output.recommended_next_tools[0]
            .path
            .ends_with("src/search.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_expands_agentic_search_implementation_terms() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-agentic-expansion");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(
            dir.join("src/search.rs"),
            "pub fn rank_retriever() {\n    // workspace_search ranking\n}\n",
        )
        .expect("search file");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("agentic search"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        for expected in [
            "search",
            "workspace_search",
            "grep",
            "grep_search",
            "glob",
            "office_search",
            "search.rs",
            "retriever",
            "ranking",
            "検索改善",
        ] {
            assert!(
                output
                    .plan
                    .query_variants
                    .iter()
                    .any(|term| term == expected),
                "missing expansion term {expected:?}: {:?}",
                output.plan.query_variants
            );
        }
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/search.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_expands_tool_call_terms() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-tool-call-expansion");
        std::fs::create_dir_all(dir.join("src/agent_loop")).expect("agent loop dir");
        fs::write(
            dir.join("src/agent_loop/response_parser.rs"),
            "pub fn parse_relay_tool_call() {\n    // relay_tool ToolCall orchestrator\n}\n",
        )
        .expect("response parser");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("tool call"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        for expected in [
            "tool call",
            "relay_tool",
            "toolcall",
            "response_parser",
            "orchestrator",
        ] {
            assert!(
                output
                    .plan
                    .query_variants
                    .iter()
                    .any(|term| term == expected),
                "missing expansion term {expected:?}: {:?}",
                output.plan.query_variants
            );
        }
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0]
            .path
            .ends_with("src/agent_loop/response_parser.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_expands_approval_terms() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-approval-expansion");
        std::fs::create_dir_all(dir.join("src/agent_loop")).expect("agent loop dir");
        fs::write(
            dir.join("src/agent_loop/approval.rs"),
            "pub fn request_permission() {\n    // approval 承認 orchestrator\n}\n",
        )
        .expect("approval");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("承認"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        for expected in [
            "approval",
            "承認",
            "permission",
            "approval.rs",
            "approval_needed",
            "approval-needed",
            "approvalneeded",
            "orchestrator",
        ] {
            assert!(
                output
                    .plan
                    .query_variants
                    .iter()
                    .any(|term| term == expected),
                "missing expansion term {expected:?}: {:?}",
                output.plan.query_variants
            );
        }
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0]
            .path
            .ends_with("src/agent_loop/approval.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_expands_case_and_fullwidth_variants() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-case-expansion");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(
            dir.join("src/tool_call.rs"),
            "pub fn handle_tool_call() {\n    // ToolCall relay_tool\n}\n",
        )
        .expect("tool call");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("ＴｏｏｌＣａｌｌ"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output
            .plan
            .query_variants
            .iter()
            .any(|term| term == "toolcall"));
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/tool_call.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_exact_path_recommends_read_file() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-exact-path");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join("src/exact.rs"), "pub fn exact() {}\n").expect("exact");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("src/exact.rs"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("path")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.plan.intent, "exact_path_read_recommended");
        assert_eq!(output.recommended_next_tools.len(), 1);
        assert_eq!(output.recommended_next_tools[0].tool, "read_file");
        assert!(output.recommended_next_tools[0]
            .path
            .ends_with("src/exact.rs"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_ignore_negation_reincludes_file() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-gitignore-negation");
        std::fs::create_dir_all(dir.join("ignored")).expect("ignored dir");
        fs::write(dir.join(".gitignore"), "ignored/**\n!ignored/keep.txt\n").expect("gitignore");
        fs::write(dir.join("ignored/drop.txt"), "needle drop\n").expect("drop");
        fs::write(dir.join("ignored/keep.txt"), "needle keep\n").expect("keep");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("ignored/keep.txt"));
        assert!(output.skipped.iter().any(|skip| skip.reason == "ignored_by_gitignore"
            && skip.path.ends_with("ignored/drop.txt")));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_gitignore_directory_pattern_skips_children() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-gitignore-dir");
        std::fs::create_dir_all(dir.join("generated")).expect("generated dir");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join(".gitignore"), "generated/\n").expect("gitignore");
        fs::write(dir.join("generated/drop.txt"), "needle generated\n").expect("drop");
        fs::write(dir.join("src/keep.txt"), "needle keep\n").expect("keep");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/keep.txt"));
        assert!(output.skipped.iter().any(|skip| {
            skip.reason == "ignored_by_gitignore" && skip.path.ends_with("generated/drop.txt")
        }));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_dot_ignore_and_global_ignore_are_respected() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let original_ignore = std::env::var_os("RELAY_WORKSPACE_SEARCH_IGNORE_FILE");
        let dir = temp_path("workspace-search-dot-ignore");
        let global_ignore = temp_path("workspace-search-global-ignore");
        std::fs::create_dir_all(dir.join("local")).expect("local dir");
        std::fs::create_dir_all(dir.join("global")).expect("global dir");
        std::fs::create_dir_all(dir.join("keep")).expect("keep dir");
        fs::write(dir.join(".ignore"), "local/**\n").expect("dot ignore");
        fs::write(&global_ignore, "global/**\n").expect("global ignore");
        fs::write(dir.join("local/drop.txt"), "needle local\n").expect("local drop");
        fs::write(dir.join("global/drop.txt"), "needle global\n").expect("global drop");
        fs::write(dir.join("keep/hit.txt"), "needle keep\n").expect("keep hit");
        std::env::set_var("RELAY_WORKSPACE_SEARCH_IGNORE_FILE", &global_ignore);
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("keep/hit.txt"));
        assert_eq!(
            output
                .skipped
                .iter()
                .filter(|skip| skip.reason == "ignored_by_gitignore")
                .count(),
            2
        );

        std::env::set_current_dir(original_dir).expect("restore cwd");
        if let Some(value) = original_ignore {
            std::env::set_var("RELAY_WORKSPACE_SEARCH_IGNORE_FILE", value);
        } else {
            std::env::remove_var("RELAY_WORKSPACE_SEARCH_IGNORE_FILE");
        }
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_file(global_ignore);
    }

    #[test]
    fn workspace_search_skips_sensitive_and_huge_files_with_structured_reasons() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-sensitive-huge");
        std::fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join(".env.local"), "needle secret\n").expect("secret");
        fs::write(dir.join("token.txt"), "needle token\n").expect("token");
        fs::write(dir.join("huge.txt"), "needle".repeat(200)).expect("huge");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(64),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.candidates.is_empty());
        assert!(output.skipped.iter().any(|skip| {
            skip.reason == "sensitive_path"
                && skip.category == "sensitive_path"
                && skip.path == "[redacted-sensitive-path]"
        }));
        assert!(output
            .skipped
            .iter()
            .any(|skip| skip.reason == "max_bytes" && skip.category == "max_bytes"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_does_not_treat_token_substrings_as_sensitive() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-tokenizer");
        std::fs::create_dir_all(dir.join("src")).expect("src dir");
        fs::write(dir.join("src/tokenizer.rs"), "pub fn tokenize_needle() {}\n")
            .expect("tokenizer");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("tokenize_needle"),
            paths: Some(vec![String::from("src")]),
            mode: Some(String::from("code")),
            include_ext: Some(vec![String::from("rs")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/tokenizer.rs"));
        assert!(!output
            .skipped
            .iter()
            .any(|skip| skip.reason == "sensitive_path"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_office_exts_respect_include_ext_filter() {
        let mut include_ext = std::collections::HashSet::new();
        include_ext.insert(String::from("pdf"));
        include_ext.insert(String::from("rs"));

        let exts = super::workspace_search_office_exts(Some(&include_ext));

        assert_eq!(exts, vec![String::from("pdf")]);
    }

    #[test]
    fn workspace_search_office_patterns_expand_cash_flow_aliases() {
        let terms = super::workspace_search_terms("キャッシュフロー計算書 関連ファイル");

        let patterns =
            super::workspace_search_office_patterns("キャッシュフロー計算書 関連ファイル", &terms);

        assert_eq!(
            patterns,
            vec![
                String::from("キャッシュフロー"),
                String::from("キャッシュ・フロー"),
                String::from("CFS"),
                String::from("計算書"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn workspace_search_does_not_follow_symlink_escape() {
        let _guard = crate::test_env_lock();
        let original_dir = std::env::current_dir().expect("cwd");
        let dir = temp_path("workspace-search-symlink");
        let outside = temp_path("workspace-search-symlink-outside");
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("outside.txt"), "needle outside\n").expect("outside file");
        std::os::unix::fs::symlink(outside.join("outside.txt"), dir.join("link.txt"))
            .expect("symlink");
        std::env::set_current_dir(&dir).expect("set cwd");

        let output = workspace_search(&WorkspaceSearchInput {
            query: String::from("needle"),
            paths: None,
            mode: Some(String::from("text")),
            include_ext: Some(vec![String::from("txt")]),
            max_files: Some(10),
            max_snippets: Some(10),
            max_bytes: Some(2 * 1024 * 1024),
            max_duration_ms: Some(5_000),
            context: Some(0),
            literal: Some(true),
        })
        .expect("workspace_search should succeed");

        assert!(output.candidates.is_empty());
        assert!(output.snippets.is_empty());

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
        let _ = fs::remove_dir_all(outside);
    }
}
