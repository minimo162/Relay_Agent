use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use csv::ErrorKind;
use serde::Serialize;

use crate::models::WorkbookFormat;

use super::{WorkbookEngine, WorkbookSource};

const SAMPLE_BYTE_LIMIT: usize = 64 * 1024;
const CSV_SAMPLE_RECORD_LIMIT: usize = 250;
const CSV_SIZE_WARNING_BYTES: u64 = 10 * 1024 * 1024;
const XLSX_SIZE_WARNING_BYTES: u64 = 25 * 1024 * 1024;
const COMPLEX_WORKBOOK_SHEET_WARNING_COUNT: u32 = 12;
const COMPLEX_WORKBOOK_COLUMN_WARNING_COUNT: u32 = 80;
const COMPLEX_WORKBOOK_ROW_WARNING_COUNT: u32 = 50_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkbookPreflightStatus {
    Ready,
    Warning,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkbookPreflightCheckLevel {
    Info,
    Warning,
    Blocking,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPreflightCheck {
    pub code: String,
    pub title: String,
    pub detail: String,
    pub level: WorkbookPreflightCheckLevel,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPreflightReport {
    pub workbook_path: String,
    pub status: WorkbookPreflightStatus,
    pub headline: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<WorkbookFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    pub checks: Vec<WorkbookPreflightCheck>,
    pub guidance: Vec<String>,
}

pub fn preflight_workbook(path: impl Into<PathBuf>) -> WorkbookPreflightReport {
    let path = path.into();
    let workbook_path = path.display().to_string();
    let mut checks = Vec::new();
    let mut guidance = Vec::new();

    if workbook_path.trim().is_empty() {
        push_check(
            &mut checks,
            "missing-path",
            WorkbookPreflightCheckLevel::Blocking,
            "Choose a workbook first",
            "Relay Agent needs a file path before it can confirm whether the workbook is safe to inspect.",
        );
        push_guidance(
            &mut guidance,
            "Choose the workbook you want to inspect, then run the file check again.",
        );

        return finalize_report(workbook_path, None, None, checks, guidance);
    }

    if looks_like_excel_lock_file(&path) {
        push_check(
            &mut checks,
            "excel-lock-file",
            WorkbookPreflightCheckLevel::Blocking,
            "This looks like Excel's temporary lock file",
            "Choose the real workbook instead of the `~$...` helper file that Excel creates while another copy is open.",
        );
        push_guidance(
            &mut guidance,
            "Return to the original workbook file name and close Excel first if the file is still being saved.",
        );

        return finalize_report(workbook_path, None, None, checks, guidance);
    }

    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) => {
            push_check(
                &mut checks,
                "path-unavailable",
                WorkbookPreflightCheckLevel::Blocking,
                "Relay Agent could not reach this file",
                format!("`{}` could not be opened yet: {error}", path.display()),
            );
            push_guidance(
                &mut guidance,
                "Confirm the file still exists, then try the check again.",
            );

            return finalize_report(workbook_path, None, None, checks, guidance);
        }
    };

    if !metadata.is_file() {
        push_check(
            &mut checks,
            "not-a-file",
            WorkbookPreflightCheckLevel::Blocking,
            "The selected path is not a file",
            "Choose the workbook file itself, not a folder or shortcut target.",
        );
        push_guidance(
            &mut guidance,
            "Open the folder, copy the workbook path, and point Relay Agent at the file itself.",
        );

        return finalize_report(workbook_path, None, None, checks, guidance);
    }

    if let Err(error) = File::open(&path) {
        push_check(
            &mut checks,
            "read-access",
            WorkbookPreflightCheckLevel::Blocking,
            "Relay Agent cannot read this file yet",
            format!(
                "The workbook exists, but the app could not open it for inspection: {error}"
            ),
        );
        push_guidance(
            &mut guidance,
            "Close any app that is still saving the file, then try again.",
        );

        return finalize_report(workbook_path, None, Some(metadata.len()), checks, guidance);
    }

    let source = match WorkbookSource::detect(path.clone()) {
        Ok(source) => source,
        Err(error) => {
            push_check(
                &mut checks,
                "unsupported-format",
                WorkbookPreflightCheckLevel::Blocking,
                "This file type is not supported in Relay Agent yet",
                error,
            );
            push_guidance(
                &mut guidance,
                "Use a `.csv`, `.xlsx`, or `.xlsm` workbook for the current MVP path.",
            );

            return finalize_report(workbook_path, None, Some(metadata.len()), checks, guidance);
        }
    };

    let file_size_bytes = metadata.len();
    push_check(
        &mut checks,
        "format-detected",
        WorkbookPreflightCheckLevel::Info,
        "Workbook type detected",
        match source.format() {
            WorkbookFormat::Csv => "Relay Agent recognized this file as a CSV workbook.".to_string(),
            WorkbookFormat::Xlsx => {
                "Relay Agent recognized this file as an Excel workbook.".to_string()
            }
        },
    );

    match source.format() {
        WorkbookFormat::Csv => inspect_csv_source(
            &source,
            file_size_bytes,
            &mut checks,
            &mut guidance,
        ),
        WorkbookFormat::Xlsx => inspect_xlsx_source(
            &source,
            file_size_bytes,
            &mut checks,
            &mut guidance,
        ),
    }

    finalize_report(
        workbook_path,
        Some(source.format()),
        Some(file_size_bytes),
        checks,
        guidance,
    )
}

fn inspect_csv_source(
    source: &WorkbookSource,
    file_size_bytes: u64,
    checks: &mut Vec<WorkbookPreflightCheck>,
    guidance: &mut Vec<String>,
) {
    if file_size_bytes > CSV_SIZE_WARNING_BYTES {
        push_check(
            checks,
            "large-file",
            WorkbookPreflightCheckLevel::Warning,
            "This CSV is large for the current MVP path",
            format!(
                "The file is about {}. Relay Agent can still inspect it, but preview steps may feel slower than a smaller CSV.",
                format_file_size(file_size_bytes)
            ),
        );
        push_guidance(
            guidance,
            "If the preview feels slow, try narrowing the file before you start the full workflow.",
        );
    }

    let sample_bytes = match read_sample_bytes(source.path(), SAMPLE_BYTE_LIMIT) {
        Ok(sample_bytes) => sample_bytes,
        Err(error) => {
            push_check(
                checks,
                "sample-read",
                WorkbookPreflightCheckLevel::Blocking,
                "Relay Agent could not sample this CSV",
                error,
            );
            push_guidance(
                guidance,
                "Confirm the file is still readable, then run the file check again.",
            );
            return;
        }
    };

    let sample_text = match std::str::from_utf8(&sample_bytes) {
        Ok(text) => text,
        Err(_) => {
            push_check(
                checks,
                "csv-encoding",
                WorkbookPreflightCheckLevel::Blocking,
                "This CSV is not UTF-8 text",
                "Relay Agent currently expects UTF-8 CSV text. Files saved as Shift_JIS or other legacy encodings should be exported again before you continue.",
            );
            push_guidance(
                guidance,
                "Re-save the CSV as UTF-8, then run the file check again.",
            );
            return;
        }
    };

    if let Some(delimiter) = infer_delimiter(sample_text) {
        if delimiter != ',' {
            push_check(
                checks,
                "csv-delimiter",
                WorkbookPreflightCheckLevel::Blocking,
                "This CSV uses a different separator",
                format!(
                    "Relay Agent currently expects comma-separated CSV files, but this one looks {}-separated.",
                    describe_delimiter(delimiter)
                ),
            );
            push_guidance(
                guidance,
                "Export the file again as UTF-8, comma-separated CSV before you continue.",
            );
            return;
        }
    }

    let reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_path(source.path())
        .map_err(|error| {
            format!(
                "failed to open CSV source `{}`: {error}",
                source.path().display()
            )
        });

    let mut reader = match reader {
        Ok(reader) => reader,
        Err(error) => {
            push_check(
                checks,
                "csv-open",
                WorkbookPreflightCheckLevel::Blocking,
                "Relay Agent could not open this CSV",
                error,
            );
            return;
        }
    };

    let headers = match reader.headers() {
        Ok(headers) => headers.clone(),
        Err(error) => {
            push_csv_parse_check(checks, guidance, error);
            return;
        }
    };

    if headers.is_empty() || headers.iter().all(|value| value.trim().is_empty()) {
        push_check(
            checks,
            "csv-empty",
            WorkbookPreflightCheckLevel::Blocking,
            "This CSV does not expose usable column headers",
            "Relay Agent needs at least one visible header row before it can inspect the workbook safely.",
        );
        push_guidance(
            guidance,
            "Open the CSV once, confirm the first row contains column names, and save it again if needed.",
        );
        return;
    }

    push_check(
        checks,
        "csv-shape",
        WorkbookPreflightCheckLevel::Info,
        "The CSV header looks usable",
        format!(
            "Relay Agent found {} column(s) in the header and can continue with normal CSV inspection.",
            headers.len()
        ),
    );

    let mut saw_decimal_comma = false;
    let mut saw_ambiguous_date = false;
    let mut saw_grouped_thousands = false;

    for record in reader.records().take(CSV_SAMPLE_RECORD_LIMIT) {
        let record = match record {
            Ok(record) => record,
            Err(error) => {
                push_csv_parse_check(checks, guidance, error);
                return;
            }
        };

        inspect_csv_record(
            &record,
            &mut saw_decimal_comma,
            &mut saw_ambiguous_date,
            &mut saw_grouped_thousands,
        );
    }

    if saw_decimal_comma {
        push_check(
            checks,
            "locale-decimal-comma",
            WorkbookPreflightCheckLevel::Warning,
            "Some values look like comma-decimal numbers",
            "Numeric casts and aggregates work best when decimal values use periods. Review these values before you ask for number-heavy transforms.",
        );
        push_guidance(
            guidance,
            "If this file came from a locale that writes `12,5`, normalize those numbers or keep them as text during the first pass.",
        );
    }

    if saw_grouped_thousands {
        push_check(
            checks,
            "locale-thousands",
            WorkbookPreflightCheckLevel::Warning,
            "Some values include thousands separators",
            "Quoted values such as `1,234` can stay readable, but you should confirm they are interpreted the way you expect before numeric transforms.",
        );
        push_guidance(
            guidance,
            "Spot-check a few number columns in the preview before you approve any write step.",
        );
    }

    if saw_ambiguous_date {
        push_check(
            checks,
            "locale-ambiguous-date",
            WorkbookPreflightCheckLevel::Warning,
            "Some dates may be locale-sensitive",
            "Values like `03/04/2024` can mean different things in different regions. Review date columns before you ask Relay Agent to filter or cast them.",
        );
        push_guidance(
            guidance,
            "Prefer ISO-style dates such as `2024-04-03` when you can, or mention the intended date format in your request.",
        );
    }

    if !checks
        .iter()
        .any(|check| matches!(check.level, WorkbookPreflightCheckLevel::Warning))
    {
        push_guidance(
            guidance,
            "This looks like the safest path today: a readable, comma-separated UTF-8 CSV.",
        );
    }
}

fn inspect_xlsx_source(
    source: &WorkbookSource,
    file_size_bytes: u64,
    checks: &mut Vec<WorkbookPreflightCheck>,
    guidance: &mut Vec<String>,
) {
    if file_size_bytes > XLSX_SIZE_WARNING_BYTES {
        push_check(
            checks,
            "large-workbook",
            WorkbookPreflightCheckLevel::Warning,
            "This workbook is large for the current MVP path",
            format!(
                "The file is about {}. Opening metadata should still work, but inspect and preview steps may take longer.",
                format_file_size(file_size_bytes)
            ),
        );
    }

    let engine = WorkbookEngine::default();
    let profile = match engine.inspect_workbook(source) {
        Ok(profile) => profile,
        Err(error) => {
            push_check(
                checks,
                "xlsx-open",
                WorkbookPreflightCheckLevel::Blocking,
                "Relay Agent could not inspect this workbook",
                error,
            );
            push_guidance(
                guidance,
                "Open the workbook in Excel once, confirm it is readable, then run the file check again.",
            );
            return;
        }
    };

    if profile.sheet_count == 0 {
        push_check(
            checks,
            "xlsx-empty",
            WorkbookPreflightCheckLevel::Blocking,
            "This workbook does not expose any sheets",
            "Relay Agent could open the file, but it did not find a visible sheet to inspect.",
        );
        return;
    }

    push_check(
        checks,
        "xlsx-opened",
        WorkbookPreflightCheckLevel::Info,
        "Workbook metadata opened successfully",
        format!(
            "Relay Agent found {} sheet(s) and can use this workbook for inspect-side context.",
            profile.sheet_count
        ),
    );

    push_check(
        checks,
        "xlsx-write-limit",
        WorkbookPreflightCheckLevel::Warning,
        "Excel files are still best for inspect and planning",
        "Relay Agent's most complete save-copy path is still CSV-first. Use Excel workbooks mainly to inspect the data and prepare the plan.",
    );
    push_guidance(
        guidance,
        "If you expect to write a transformed copy, exporting the target sheet to CSV is still the safest path.",
    );

    let extension = normalized_extension(source.path());
    if matches!(extension.as_deref(), Some("xlsm") | Some("xlam")) {
        push_check(
            checks,
            "macro-workbook",
            WorkbookPreflightCheckLevel::Warning,
            "Macros and add-ins stay outside Relay Agent",
            "This workbook uses a macro-enabled or add-in extension. Relay Agent will not run VBA, formulas, or external workbook code from that file.",
        );
        push_guidance(
            guidance,
            "If you only need the table data, start from a normal workbook or CSV export when possible.",
        );
    }

    if profile.sheet_count > COMPLEX_WORKBOOK_SHEET_WARNING_COUNT {
        push_check(
            checks,
            "complex-sheet-count",
            WorkbookPreflightCheckLevel::Warning,
            "This workbook has many sheets",
            format!(
                "Relay Agent found {} sheets. Starting with one target sheet will keep the first pass easier to review.",
                profile.sheet_count
            ),
        );
    }

    let has_wide_sheet = profile
        .sheets
        .iter()
        .any(|sheet| sheet.column_count > COMPLEX_WORKBOOK_COLUMN_WARNING_COUNT);
    if has_wide_sheet {
        push_check(
            checks,
            "complex-wide-sheet",
            WorkbookPreflightCheckLevel::Warning,
            "Some sheets are very wide",
            format!(
                "At least one sheet has more than {} columns. Reviewer-friendly previews work best when you narrow the target first.",
                COMPLEX_WORKBOOK_COLUMN_WARNING_COUNT
            ),
        );
    }

    let has_tall_sheet = profile
        .sheets
        .iter()
        .any(|sheet| sheet.row_count > COMPLEX_WORKBOOK_ROW_WARNING_COUNT);
    if has_tall_sheet {
        push_check(
            checks,
            "complex-row-count",
            WorkbookPreflightCheckLevel::Warning,
            "Some sheets are large enough to review in smaller steps",
            format!(
                "At least one sheet has more than {} data rows. Expect previews to focus on summaries first.",
                COMPLEX_WORKBOOK_ROW_WARNING_COUNT
            ),
        );
    }
}

fn inspect_csv_record(
    record: &csv::StringRecord,
    saw_decimal_comma: &mut bool,
    saw_ambiguous_date: &mut bool,
    saw_grouped_thousands: &mut bool,
) {
    for value in record.iter() {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !*saw_decimal_comma && looks_like_decimal_comma(trimmed) {
            *saw_decimal_comma = true;
        }

        if !*saw_ambiguous_date && looks_like_ambiguous_slash_date(trimmed) {
            *saw_ambiguous_date = true;
        }

        if !*saw_grouped_thousands && looks_like_grouped_thousands(trimmed) {
            *saw_grouped_thousands = true;
        }

        if *saw_decimal_comma && *saw_ambiguous_date && *saw_grouped_thousands {
            return;
        }
    }
}

fn push_csv_parse_check(
    checks: &mut Vec<WorkbookPreflightCheck>,
    guidance: &mut Vec<String>,
    error: csv::Error,
) {
    match error.kind() {
        ErrorKind::Utf8 { .. } => {
            push_check(
                checks,
                "csv-encoding",
                WorkbookPreflightCheckLevel::Blocking,
                "This CSV contains non-UTF-8 text",
                "Relay Agent currently expects UTF-8 CSV text. Re-save the file as UTF-8 before you continue.",
            );
            push_guidance(
                guidance,
                "Export the file again as UTF-8 CSV, then run the check once more.",
            );
        }
        ErrorKind::UnequalLengths { .. } => {
            push_check(
                checks,
                "csv-shape-mismatch",
                WorkbookPreflightCheckLevel::Blocking,
                "Some CSV rows do not match the header",
                "Relay Agent found a row with a different number of columns than the header. This usually means the separator or quoting is not what the app expects yet.",
            );
            push_guidance(
                guidance,
                "Open the CSV once, confirm it is comma-separated, and export it again if the columns do not line up cleanly.",
            );
        }
        _ => {
            push_check(
                checks,
                "csv-parse",
                WorkbookPreflightCheckLevel::Blocking,
                "Relay Agent could not parse this CSV cleanly",
                format!("The CSV parser stopped before preview could begin: {error}"),
            );
            push_guidance(
                guidance,
                "Re-save the file as UTF-8, comma-separated CSV and try again.",
            );
        }
    }
}

fn finalize_report(
    workbook_path: String,
    format: Option<WorkbookFormat>,
    file_size_bytes: Option<u64>,
    checks: Vec<WorkbookPreflightCheck>,
    guidance: Vec<String>,
) -> WorkbookPreflightReport {
    let status = derive_status(&checks);
    let headline = match status {
        WorkbookPreflightStatus::Ready => "This file looks ready for Relay Agent.".to_string(),
        WorkbookPreflightStatus::Warning => {
            "This file can open, but there are a few things to review first.".to_string()
        }
        WorkbookPreflightStatus::Blocked => "This file needs attention before you start.".to_string(),
    };
    let summary = checks
        .iter()
        .find(|check| matches!(check.level, WorkbookPreflightCheckLevel::Blocking))
        .or_else(|| {
            checks
                .iter()
                .find(|check| matches!(check.level, WorkbookPreflightCheckLevel::Warning))
        })
        .or_else(|| {
            checks
                .iter()
                .find(|check| matches!(check.level, WorkbookPreflightCheckLevel::Info))
        })
        .map(|check| check.detail.clone())
        .unwrap_or_else(|| {
            "Relay Agent did not find any early file-readiness issues.".to_string()
        });

    WorkbookPreflightReport {
        workbook_path,
        status,
        headline,
        summary,
        format,
        file_size_bytes,
        checks,
        guidance,
    }
}

fn derive_status(checks: &[WorkbookPreflightCheck]) -> WorkbookPreflightStatus {
    if checks
        .iter()
        .any(|check| matches!(check.level, WorkbookPreflightCheckLevel::Blocking))
    {
        WorkbookPreflightStatus::Blocked
    } else if checks
        .iter()
        .any(|check| matches!(check.level, WorkbookPreflightCheckLevel::Warning))
    {
        WorkbookPreflightStatus::Warning
    } else {
        WorkbookPreflightStatus::Ready
    }
}

fn push_check(
    checks: &mut Vec<WorkbookPreflightCheck>,
    code: &str,
    level: WorkbookPreflightCheckLevel,
    title: &str,
    detail: impl Into<String>,
) {
    checks.push(WorkbookPreflightCheck {
        code: code.to_string(),
        title: title.to_string(),
        detail: detail.into(),
        level,
    });
}

fn push_guidance(guidance: &mut Vec<String>, message: &str) {
    if guidance.iter().any(|existing| existing == message) {
        return;
    }

    guidance.push(message.to_string());
}

fn read_sample_bytes(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("failed to open `{}` for sampling: {error}", path.display()))?;
    let mut buffer = vec![0; limit];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|error| format!("failed to read `{}` for sampling: {error}", path.display()))?;
    buffer.truncate(bytes_read);
    Ok(buffer)
}

fn infer_delimiter(sample: &str) -> Option<char> {
    let candidates = [',', ';', '\t', '|'];
    let mut best_match = None;
    let mut best_score = 0usize;

    for candidate in candidates {
        let score = sample
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(5)
            .map(|line| count_delimiter_outside_quotes(line, candidate))
            .sum::<usize>();

        if score > best_score {
            best_score = score;
            best_match = Some(candidate);
        }
    }

    if best_score == 0 {
        None
    } else {
        best_match
    }
}

fn count_delimiter_outside_quotes(line: &str, delimiter: char) -> usize {
    let mut in_quotes = false;
    let mut count = 0usize;

    for character in line.chars() {
        match character {
            '"' => in_quotes = !in_quotes,
            _ if character == delimiter && !in_quotes => count += 1,
            _ => {}
        }
    }

    count
}

fn describe_delimiter(delimiter: char) -> &'static str {
    match delimiter {
        ';' => "semicolon",
        '\t' => "tab",
        '|' => "pipe",
        _ => "comma",
    }
}

fn looks_like_excel_lock_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .map(|file_name| file_name.starts_with("~$"))
        .unwrap_or(false)
}

fn normalized_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
}

fn looks_like_decimal_comma(value: &str) -> bool {
    if value.contains('.') || !value.contains(',') {
        return false;
    }

    let unsigned = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    let mut parts = unsigned.split(',');
    let Some(left) = parts.next() else {
        return false;
    };
    let Some(right) = parts.next() else {
        return false;
    };

    if parts.next().is_some() {
        return false;
    }

    !left.is_empty()
        && !right.is_empty()
        && left.chars().all(|character| character.is_ascii_digit())
        && right.chars().all(|character| character.is_ascii_digit())
}

fn looks_like_grouped_thousands(value: &str) -> bool {
    if !value.contains(',') || looks_like_decimal_comma(value) {
        return false;
    }

    let unsigned = value
        .strip_prefix('+')
        .or_else(|| value.strip_prefix('-'))
        .unwrap_or(value);
    let integer_portion = unsigned
        .split_once('.')
        .map(|(integer_portion, _)| integer_portion)
        .unwrap_or(unsigned);
    let groups = integer_portion.split(',').collect::<Vec<_>>();

    if groups.len() < 2 {
        return false;
    }

    let Some(first) = groups.first() else {
        return false;
    };
    if first.is_empty() || first.len() > 3 || !first.chars().all(|character| character.is_ascii_digit()) {
        return false;
    }

    groups[1..].iter().all(|group| {
        group.len() == 3 && group.chars().all(|character| character.is_ascii_digit())
    })
}

fn looks_like_ambiguous_slash_date(value: &str) -> bool {
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 3 {
        return false;
    }

    if parts[0].len() == 4 {
        return false;
    }

    let Ok(first) = parts[0].parse::<u32>() else {
        return false;
    };
    let Ok(second) = parts[1].parse::<u32>() else {
        return false;
    };

    first >= 1 && first <= 12 && second >= 1 && second <= 12
}

fn format_file_size(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;

    if (bytes as f64) >= MIB {
        format!("{:.1} MB", bytes as f64 / MIB)
    } else if (bytes as f64) >= KIB {
        format!("{:.1} KB", bytes as f64 / KIB)
    } else {
        format!("{bytes} bytes")
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs, path::PathBuf};

    use uuid::Uuid;

    use super::{preflight_workbook, WorkbookPreflightStatus};

    #[test]
    fn blocks_semicolon_delimited_csv_files() {
        let csv_path = write_test_file(
            "region;amount\nWest;12,5\nEast;8,2\n",
            "csv",
            "semicolon",
        );

        let report = preflight_workbook(csv_path.clone());

        assert_eq!(report.status, WorkbookPreflightStatus::Blocked);
        assert!(report
            .checks
            .iter()
            .any(|check| check.code == "csv-delimiter"));

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn warns_on_locale_sensitive_csv_patterns() {
        let csv_path = write_test_file(
            "amount,booked_at\n\"12,5\",03/04/2024\n\"1,234.00\",11/12/2024\n",
            "csv",
            "locale-warning",
        );

        let report = preflight_workbook(csv_path.clone());

        assert_eq!(report.status, WorkbookPreflightStatus::Warning);
        assert!(report
            .checks
            .iter()
            .any(|check| check.code == "locale-decimal-comma"));
        assert!(report
            .checks
            .iter()
            .any(|check| check.code == "locale-ambiguous-date"));
        assert!(report
            .checks
            .iter()
            .any(|check| check.code == "locale-thousands"));

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn blocks_excel_lock_file_names() {
        let path = env::temp_dir().join(format!("~$relay-agent-lock-{}.csv", Uuid::new_v4()));
        fs::write(&path, "region,amount\nWest,10\n").expect("lock file should exist");

        let report = preflight_workbook(path.clone());

        assert_eq!(report.status, WorkbookPreflightStatus::Blocked);
        assert!(report
            .checks
            .iter()
            .any(|check| check.code == "excel-lock-file"));

        fs::remove_file(path).expect("lock file should clean up");
    }

    fn write_test_file(contents: &str, extension: &str, tag: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "relay-agent-preflight-{tag}-{}.{}",
            Uuid::new_v4(),
            extension
        ));
        fs::write(&path, contents).expect("test file should be written");
        path
    }
}
