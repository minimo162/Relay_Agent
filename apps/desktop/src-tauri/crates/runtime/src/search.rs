use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use glob::Pattern;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::office;

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
    pub reasons: Vec<String>,
    #[serde(rename = "match_count")]
    pub match_count: usize,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSearchOutput {
    pub query: String,
    pub strategy: Vec<String>,
    pub candidates: Vec<WorkspaceSearchCandidate>,
    pub snippets: Vec<WorkspaceSearchSnippet>,
    pub skipped: Vec<WorkspaceSearchSkipped>,
    pub limits: WorkspaceSearchLimits,
    #[serde(rename = "needs_clarification")]
    pub needs_clarification: bool,
}

#[derive(Debug, Clone)]
struct WorkspaceCandidateAccumulator {
    path: String,
    score: f64,
    reasons: Vec<String>,
    match_count: usize,
}

impl WorkspaceCandidateAccumulator {
    fn new(path: String) -> Self {
        Self {
            path,
            score: 0.0,
            reasons: Vec::new(),
            match_count: 0,
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
        for reason in other.reasons {
            if !self.reasons.iter().any(|existing| existing == &reason) {
                self.reasons.push(reason);
            }
        }
    }

    fn into_candidate(self) -> WorkspaceSearchCandidate {
        WorkspaceSearchCandidate {
            path: self.path,
            score: (self.score * 100.0).round() / 100.0,
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
        self.skipped_files += 1;
        if self.skipped.len() < 100 {
            self.skipped.push(WorkspaceSearchSkipped {
                path: path.into(),
                reason: reason.into(),
            });
        }
    }
}

#[derive(Debug)]
struct GitIgnoreMatcher {
    patterns: Vec<Pattern>,
}

impl GitIgnoreMatcher {
    fn load(root: &Path) -> Self {
        let patterns = fs::read_to_string(root.join(".gitignore"))
            .ok()
            .into_iter()
            .flat_map(|contents| {
                contents
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with('!'))
                    .filter_map(|line| Pattern::new(line.trim_start_matches('/')).ok())
                    .collect::<Vec<_>>()
            })
            .collect();
        Self { patterns }
    }

    fn is_match(&self, workspace_root: &Path, path: &Path) -> bool {
        let relative = path.strip_prefix(workspace_root).unwrap_or(path);
        let relative_string = relative.to_string_lossy();
        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        self.patterns
            .iter()
            .any(|pattern| pattern.matches(&relative_string) || pattern.matches(file_name))
    }
}

pub fn workspace_search(input: &WorkspaceSearchInput) -> io::Result<WorkspaceSearchOutput> {
    let started = Instant::now();
    let query = input.query.trim();
    if query.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "workspace_search query is required",
        ));
    }

    let workspace_root = std::env::current_dir()?.canonicalize()?;
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
    let gitignore = GitIgnoreMatcher::load(&workspace_root);
    let mut state = SearchState::new();
    let mut candidate_map = BTreeMap::<String, WorkspaceCandidateAccumulator>::new();
    let mut snippets = Vec::new();

    for root in &search_roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !is_ignored_workspace_search_path(entry.path()))
        {
            if Instant::now() >= budgets.deadline {
                state.truncated = true;
                state.skip(root.to_string_lossy(), "duration_budget_exceeded");
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    state.skip("(walkdir)", format!("walk_error:{error}"));
                    continue;
                }
            };
            let path = entry.path().to_path_buf();
            if !entry.file_type().is_file() {
                continue;
            }
            if is_ignored_workspace_search_path(&path) {
                state.skip(path.to_string_lossy(), "default_ignore");
                continue;
            }
            if gitignore.is_match(&workspace_root, &path) {
                state.skip(path.to_string_lossy(), "gitignore");
                continue;
            }
            if !workspace_search_ext_allowed(&path, include_ext.as_ref()) {
                state.skip(path.to_string_lossy(), "extension_filter");
                continue;
            }
            let canonical = match path.canonicalize() {
                Ok(canonical) if canonical.starts_with(&workspace_root) => canonical,
                Ok(canonical) => {
                    state.skip(canonical.to_string_lossy(), "workspace_boundary");
                    continue;
                }
                Err(error) => {
                    state.skip(path.to_string_lossy(), format!("canonicalize_error:{error}"));
                    continue;
                }
            };
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
            if state.scanned_files >= budgets.max_files {
                state.truncated = true;
                state.skip(canonical.to_string_lossy(), "max_files");
                break;
            }

            let path_string = canonical.to_string_lossy().into_owned();
            let mut accumulator = WorkspaceCandidateAccumulator::new(path_string.clone());
            score_workspace_path(&path_string, &terms, &mut accumulator);
            score_extension(&canonical, &mut accumulator);
            score_recency(&canonical, &mut accumulator);

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
                candidate_map
                    .entry(path_string)
                    .and_modify(|existing| existing.merge(accumulator.clone()))
                    .or_insert(accumulator);
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
    }

    if workspace_search_should_include_office(input.mode.as_deref(), include_ext.as_ref())
        && snippets.len() < budgets.max_snippets
    {
        integrate_office_search(
            query,
            &terms,
            &search_roots,
            &mut candidate_map,
            &mut snippets,
            &mut state,
            budgets.max_files,
            budgets.max_snippets,
        );
    }

    let mut candidates = candidate_map
        .into_values()
        .map(WorkspaceCandidateAccumulator::into_candidate)
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.match_count.cmp(&a.match_count))
            .then_with(|| a.path.cmp(&b.path))
    });
    if candidates.len() > budgets.max_files {
        candidates.truncate(budgets.max_files);
        state.truncated = true;
    }

    let output = WorkspaceSearchOutput {
        query: query.to_string(),
        strategy: vec![
            "intent:auto".to_string(),
            "path_discovery".to_string(),
            "literal_grep".to_string(),
            "snippet_expansion".to_string(),
            "office_preview_anchor_integration".to_string(),
        ],
        needs_clarification: candidates.is_empty(),
        candidates,
        snippets,
        skipped: state.skipped,
        limits: WorkspaceSearchLimits {
            scanned_files: state.scanned_files,
            skipped_files: state.skipped_files,
            scanned_bytes: state.scanned_bytes,
            truncated: state.truncated,
            elapsed_ms: started.elapsed().as_millis(),
        },
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

fn integrate_office_search(
    query: &str,
    terms: &[String],
    search_roots: &[PathBuf],
    candidate_map: &mut BTreeMap<String, WorkspaceCandidateAccumulator>,
    snippets: &mut Vec<WorkspaceSearchSnippet>,
    state: &mut SearchState,
    max_files: usize,
    max_snippets: usize,
) {
    let office_paths = workspace_search_office_paths(search_roots);
    if office_paths.is_empty() {
        return;
    }
    match office::office_search(&office::OfficeSearchInput {
        pattern: workspace_search_office_pattern(query, terms),
        paths: office_paths,
        regex: Some(false),
        include_ext: Some(vec![
            "docx".to_string(),
            "xlsx".to_string(),
            "pptx".to_string(),
            "pdf".to_string(),
        ]),
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
                entry.add(25.0, 1, format!("office anchor {}", hit.anchor));
                if snippets.len() < max_snippets {
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
    for token in query
        .split(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-'))
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        let token = token.to_ascii_lowercase();
        if !terms.iter().any(|existing| existing == &token) {
            terms.push(token);
        }
    }
    terms
}

fn score_workspace_path(
    path: &str,
    terms: &[String],
    accumulator: &mut WorkspaceCandidateAccumulator,
) {
    let lower = path.to_ascii_lowercase();
    for term in terms {
        if lower.contains(term) {
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
            accumulator.add(30.0, 1, format!("query term appears in filename: {term}"));
        }
    }
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

fn score_recency(path: &Path, accumulator: &mut WorkspaceCandidateAccumulator) {
    let Ok(modified) = fs::metadata(path).and_then(|metadata| metadata.modified()) else {
        return;
    };
    let Ok(age) = modified.elapsed() else {
        return;
    };
    if age.as_secs() <= 60 * 60 * 24 * 30 {
        accumulator.add(5.0, 0, "recently modified");
    }
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
    include_ext: Option<&HashSet<String>>,
) -> bool {
    if matches!(mode, Some("code" | "text")) {
        return false;
    }
    include_ext.is_none_or(|exts| {
        ["docx", "xlsx", "pptx", "pdf"]
            .iter()
            .any(|ext| exts.contains(*ext))
    })
}

fn workspace_search_office_paths(search_roots: &[PathBuf]) -> Vec<String> {
    let mut paths = Vec::new();
    for root in search_roots {
        let root = root.to_string_lossy();
        for ext in ["docx", "xlsx", "pptx", "pdf"] {
            paths.push(format!("{}/**/*.{}", root.trim_end_matches(['/', '\\']), ext));
        }
    }
    paths
}

fn workspace_search_office_pattern(query: &str, terms: &[String]) -> String {
    terms
        .iter()
        .find(|term| term.chars().count() >= 3)
        .cloned()
        .unwrap_or_else(|| query.to_string())
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
    use std::fs;
    use std::io;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{workspace_search, WorkspaceSearchInput};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        std::env::temp_dir().join(format!("clawd-search-{name}-{unique}"))
    }

    #[test]
    fn workspace_search_returns_ranked_candidates_snippets_and_limits() {
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
        assert_eq!(output.candidates.len(), 1);
        assert!(output.candidates[0].path.ends_with("src/search.rs"));
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

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_reports_not_found_with_scope() {
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
        assert_eq!(output.limits.scanned_files, 1);

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_search_rejects_paths_outside_workspace() {
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
            .any(|skip| skip.reason == "gitignore"));
        assert!(output.skipped.iter().any(|skip| skip.reason == "binary"));

        std::env::set_current_dir(original_dir).expect("restore cwd");
        let _ = fs::remove_dir_all(dir);
    }
}
