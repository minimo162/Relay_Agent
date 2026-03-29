use calamine::{Data, Reader};
use serde::{Deserialize, Serialize};

use super::{csv_backend::CsvBackend, source::WorkbookSource, xlsx_backend::XlsxBackend};
use crate::models::{ColumnType, WorkbookFormat, WorkbookProfile, WorkbookSheet};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum XlsxFormulaPolicy {
    MetadataOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InspectPlan {
    pub preview_row_limit: usize,
    pub profile_sample_size: usize,
    pub xlsx_formula_policy: XlsxFormulaPolicy,
}

impl Default for InspectPlan {
    fn default() -> Self {
        Self {
            preview_row_limit: 25,
            profile_sample_size: 250,
            xlsx_formula_policy: XlsxFormulaPolicy::MetadataOnly,
        }
    }
}

pub fn supports_sheet_preview(format: WorkbookFormat) -> bool {
    matches!(format, WorkbookFormat::Csv | WorkbookFormat::Xlsx)
}

pub fn supports_column_profile(format: WorkbookFormat) -> bool {
    matches!(format, WorkbookFormat::Csv | WorkbookFormat::Xlsx)
}

const CSV_SHEET_NAME: &str = "Sheet1";
const SAMPLE_VALUE_LIMIT: usize = 3;

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetPreviewRow {
    pub row_number: u32,
    pub values: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetPreview {
    pub sheet: String,
    pub columns: Vec<String>,
    pub rows: Vec<SheetPreviewRow>,
    pub truncated: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnProfileSummary {
    pub column: String,
    pub inferred_type: ColumnType,
    pub non_empty_count: u32,
    pub null_count: u32,
    pub sample_values: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetColumnProfile {
    pub sheet: String,
    pub row_count: u32,
    pub sampled_rows: u32,
    pub columns: Vec<ColumnProfileSummary>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct ColumnAccumulator {
    column: String,
    non_empty_count: u32,
    null_count: u32,
    all_bool: bool,
    all_int: bool,
    all_number: bool,
    all_date: bool,
    sample_values: Vec<String>,
}

impl ColumnAccumulator {
    fn new(column: String) -> Self {
        Self {
            column,
            non_empty_count: 0,
            null_count: 0,
            all_bool: true,
            all_int: true,
            all_number: true,
            all_date: true,
            sample_values: Vec::new(),
        }
    }

    fn observe_string(&mut self, value: &str) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            self.null_count += 1;
            return;
        }

        self.non_empty_count += 1;
        self.all_bool &= is_boolean_value(trimmed);
        self.all_int &= trimmed.parse::<i64>().is_ok();
        self.all_number &= trimmed.parse::<f64>().is_ok();
        self.all_date &= is_date_like(trimmed);
        push_unique_sample(&mut self.sample_values, trimmed.to_string());
    }

    fn observe_data(&mut self, value: Option<&Data>) {
        let Some(value) = value else {
            self.null_count += 1;
            return;
        };

        match value {
            Data::Empty => self.null_count += 1,
            Data::Bool(boolean) => {
                self.non_empty_count += 1;
                self.all_bool &= true;
                self.all_int = false;
                self.all_number = false;
                self.all_date = false;
                push_unique_sample(&mut self.sample_values, boolean.to_string());
            }
            Data::Int(integer) => {
                self.non_empty_count += 1;
                self.all_bool = false;
                self.all_int &= true;
                self.all_number &= true;
                self.all_date = false;
                push_unique_sample(&mut self.sample_values, integer.to_string());
            }
            Data::Float(number) => {
                self.non_empty_count += 1;
                self.all_bool = false;
                self.all_int = false;
                self.all_number &= true;
                self.all_date = false;
                push_unique_sample(&mut self.sample_values, number.to_string());
            }
            Data::DateTime(value) => {
                self.non_empty_count += 1;
                self.all_bool = false;
                self.all_int = false;
                self.all_number = false;
                self.all_date &= true;
                push_unique_sample(&mut self.sample_values, value.to_string());
            }
            Data::DateTimeIso(value) | Data::DurationIso(value) => {
                self.non_empty_count += 1;
                self.all_bool = false;
                self.all_int = false;
                self.all_number = false;
                self.all_date &= true;
                push_unique_sample(&mut self.sample_values, value.clone());
            }
            Data::String(value) => self.observe_string(value),
            Data::Error(error) => {
                self.non_empty_count += 1;
                self.all_bool = false;
                self.all_int = false;
                self.all_number = false;
                self.all_date = false;
                push_unique_sample(&mut self.sample_values, error.to_string());
            }
        }
    }

    fn into_summary(self) -> ColumnProfileSummary {
        let inferred_type = if self.non_empty_count == 0 {
            ColumnType::String
        } else if self.all_bool {
            ColumnType::Boolean
        } else if self.all_int {
            ColumnType::Integer
        } else if self.all_number {
            ColumnType::Number
        } else if self.all_date {
            ColumnType::Date
        } else {
            ColumnType::String
        };

        ColumnProfileSummary {
            column: self.column,
            inferred_type,
            non_empty_count: self.non_empty_count,
            null_count: self.null_count,
            sample_values: self.sample_values,
        }
    }
}

pub fn inspect_workbook(
    csv_backend: &CsvBackend,
    _xlsx_backend: &XlsxBackend,
    source: &WorkbookSource,
) -> Result<WorkbookProfile, String> {
    match source.format() {
        WorkbookFormat::Csv => inspect_csv_workbook(csv_backend, source),
        WorkbookFormat::Xlsx => inspect_xlsx_workbook(source),
    }
}

pub fn sheet_preview(
    csv_backend: &CsvBackend,
    _xlsx_backend: &XlsxBackend,
    source: &WorkbookSource,
    sheet: &str,
    limit: usize,
) -> Result<SheetPreview, String> {
    if limit == 0 {
        return Err("sheet preview limit must be greater than zero".to_string());
    }

    match source.format() {
        WorkbookFormat::Csv => preview_csv_sheet(csv_backend, source, sheet, limit),
        WorkbookFormat::Xlsx => preview_xlsx_sheet(source, sheet, limit),
    }
}

pub fn profile_sheet_columns(
    csv_backend: &CsvBackend,
    _xlsx_backend: &XlsxBackend,
    source: &WorkbookSource,
    sheet: &str,
    sample_size: usize,
) -> Result<SheetColumnProfile, String> {
    if sample_size == 0 {
        return Err("column profile sample size must be greater than zero".to_string());
    }

    match source.format() {
        WorkbookFormat::Csv => profile_csv_columns(csv_backend, source, sheet, sample_size),
        WorkbookFormat::Xlsx => profile_xlsx_columns(source, sheet, sample_size),
    }
}

fn inspect_csv_workbook(
    csv_backend: &CsvBackend,
    source: &WorkbookSource,
) -> Result<WorkbookProfile, String> {
    let mut reader = csv_backend
        .reader_builder()
        .from_path(source.path())
        .map_err(|error| {
            format!(
                "failed to open CSV source `{}`: {error}",
                source.path().display()
            )
        })?;
    let headers = normalize_headers(
        reader
            .headers()
            .map_err(|error| {
                format!(
                    "failed to read CSV headers from `{}`: {error}",
                    source.path().display()
                )
            })?
            .iter()
            .map(str::to_string)
            .collect(),
    );
    let row_count = reader.records().try_fold(0u32, |count, record| {
        record.map(|_| count + 1).map_err(|error| {
            format!(
                "failed to read CSV rows from `{}`: {error}",
                source.path().display()
            )
        })
    })?;

    Ok(WorkbookProfile {
        source_path: source.path().to_string_lossy().into_owned(),
        format: WorkbookFormat::Csv,
        sheet_count: 1,
        sheets: vec![WorkbookSheet {
            name: CSV_SHEET_NAME.to_string(),
            row_count,
            column_count: headers.len() as u32,
            columns: headers,
        }],
        warnings: Vec::new(),
    })
}

fn inspect_xlsx_workbook(source: &WorkbookSource) -> Result<WorkbookProfile, String> {
    let mut workbook = XlsxBackend::open(source.path()).map_err(|error| {
        format!(
            "failed to open workbook `{}`: {error}",
            source.path().display()
        )
    })?;
    let sheet_names = workbook.sheet_names().to_owned();
    let mut sheets = Vec::new();

    for sheet_name in sheet_names {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| format!("failed to read sheet `{sheet_name}`: {error:?}"))?;
        let width = range.rows().map(|row| row.len()).max().unwrap_or(0);
        let headers = range
            .rows()
            .next()
            .map(|row| normalize_headers(pad_row(row.iter().map(display_data).collect(), width)))
            .unwrap_or_default();
        let row_count = range.rows().count().saturating_sub(1) as u32;

        sheets.push(WorkbookSheet {
            name: sheet_name,
            row_count,
            column_count: width as u32,
            columns: headers,
        });
    }

    Ok(WorkbookProfile {
        source_path: source.path().to_string_lossy().into_owned(),
        format: WorkbookFormat::Xlsx,
        sheet_count: sheets.len() as u32,
        sheets,
        warnings: Vec::new(),
    })
}

fn preview_csv_sheet(
    csv_backend: &CsvBackend,
    source: &WorkbookSource,
    sheet: &str,
    limit: usize,
) -> Result<SheetPreview, String> {
    ensure_csv_sheet(sheet)?;

    let mut reader = csv_backend
        .reader_builder()
        .from_path(source.path())
        .map_err(|error| {
            format!(
                "failed to open CSV source `{}`: {error}",
                source.path().display()
            )
        })?;
    let columns = normalize_headers(
        reader
            .headers()
            .map_err(|error| {
                format!(
                    "failed to read CSV headers from `{}`: {error}",
                    source.path().display()
                )
            })?
            .iter()
            .map(str::to_string)
            .collect(),
    );

    let mut rows = Vec::new();
    let mut truncated = false;
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| {
            format!(
                "failed to read CSV row {} from `{}`: {error}",
                index + 2,
                source.path().display()
            )
        })?;
        if index < limit {
            rows.push(SheetPreviewRow {
                row_number: index as u32 + 2,
                values: pad_row(record.iter().map(str::to_string).collect(), columns.len()),
            });
        } else {
            truncated = true;
            break;
        }
    }

    Ok(SheetPreview {
        sheet: CSV_SHEET_NAME.to_string(),
        columns,
        rows,
        truncated,
        warnings: Vec::new(),
    })
}

fn preview_xlsx_sheet(
    source: &WorkbookSource,
    sheet: &str,
    limit: usize,
) -> Result<SheetPreview, String> {
    let mut workbook = XlsxBackend::open(source.path()).map_err(|error| {
        format!(
            "failed to open workbook `{}`: {error}",
            source.path().display()
        )
    })?;
    let range = workbook
        .worksheet_range(sheet)
        .map_err(|error| format!("failed to read sheet `{sheet}`: {error:?}"))?;
    let width = range.rows().map(|row| row.len()).max().unwrap_or(0);
    let mut iterator = range.rows();
    let columns = iterator
        .next()
        .map(|row| normalize_headers(pad_row(row.iter().map(display_data).collect(), width)))
        .unwrap_or_default();

    let mut rows = Vec::new();
    let mut truncated = false;
    for (index, row) in iterator.enumerate() {
        if index < limit {
            rows.push(SheetPreviewRow {
                row_number: index as u32 + 2,
                values: pad_row(row.iter().map(display_data).collect(), columns.len()),
            });
        } else {
            truncated = true;
            break;
        }
    }

    Ok(SheetPreview {
        sheet: sheet.to_string(),
        columns,
        rows,
        truncated,
        warnings: Vec::new(),
    })
}

fn profile_csv_columns(
    csv_backend: &CsvBackend,
    source: &WorkbookSource,
    sheet: &str,
    sample_size: usize,
) -> Result<SheetColumnProfile, String> {
    ensure_csv_sheet(sheet)?;

    let mut reader = csv_backend
        .reader_builder()
        .from_path(source.path())
        .map_err(|error| {
            format!(
                "failed to open CSV source `{}`: {error}",
                source.path().display()
            )
        })?;
    let columns = normalize_headers(
        reader
            .headers()
            .map_err(|error| {
                format!(
                    "failed to read CSV headers from `{}`: {error}",
                    source.path().display()
                )
            })?
            .iter()
            .map(str::to_string)
            .collect(),
    );
    let mut accumulators = columns
        .iter()
        .cloned()
        .map(ColumnAccumulator::new)
        .collect::<Vec<_>>();
    let mut row_count = 0u32;
    let mut sampled_rows = 0u32;

    for record in reader.records() {
        let record = record.map_err(|error| {
            format!(
                "failed to read CSV rows from `{}`: {error}",
                source.path().display()
            )
        })?;
        row_count += 1;

        if sampled_rows < sample_size as u32 {
            sampled_rows += 1;
            for (index, accumulator) in accumulators.iter_mut().enumerate() {
                accumulator.observe_string(record.get(index).unwrap_or(""));
            }
        }
    }

    Ok(SheetColumnProfile {
        sheet: CSV_SHEET_NAME.to_string(),
        row_count,
        sampled_rows,
        columns: accumulators
            .into_iter()
            .map(ColumnAccumulator::into_summary)
            .collect(),
        warnings: Vec::new(),
    })
}

fn profile_xlsx_columns(
    source: &WorkbookSource,
    sheet: &str,
    sample_size: usize,
) -> Result<SheetColumnProfile, String> {
    let mut workbook = XlsxBackend::open(source.path()).map_err(|error| {
        format!(
            "failed to open workbook `{}`: {error}",
            source.path().display()
        )
    })?;
    let range = workbook
        .worksheet_range(sheet)
        .map_err(|error| format!("failed to read sheet `{sheet}`: {error:?}"))?;
    let width = range.rows().map(|row| row.len()).max().unwrap_or(0);
    let mut iterator = range.rows();
    let columns = iterator
        .next()
        .map(|row| normalize_headers(pad_row(row.iter().map(display_data).collect(), width)))
        .unwrap_or_default();
    let mut accumulators = columns
        .iter()
        .cloned()
        .map(ColumnAccumulator::new)
        .collect::<Vec<_>>();
    let mut row_count = 0u32;
    let mut sampled_rows = 0u32;

    for row in iterator {
        row_count += 1;
        if sampled_rows < sample_size as u32 {
            sampled_rows += 1;
            for (index, accumulator) in accumulators.iter_mut().enumerate() {
                accumulator.observe_data(row.get(index));
            }
        }
    }

    Ok(SheetColumnProfile {
        sheet: sheet.to_string(),
        row_count,
        sampled_rows,
        columns: accumulators
            .into_iter()
            .map(ColumnAccumulator::into_summary)
            .collect(),
        warnings: Vec::new(),
    })
}

fn ensure_csv_sheet(sheet: &str) -> Result<(), String> {
    if sheet.eq_ignore_ascii_case(CSV_SHEET_NAME) {
        Ok(())
    } else {
        Err(format!(
            "CSV sources expose a single logical sheet named `{CSV_SHEET_NAME}`, but `{sheet}` was requested"
        ))
    }
}

fn normalize_headers(headers: Vec<String>) -> Vec<String> {
    headers
        .into_iter()
        .enumerate()
        .map(|(index, header)| {
            let trimmed = header.trim();
            if trimmed.is_empty() {
                format!("column_{}", index + 1)
            } else {
                trimmed.to_string()
            }
        })
        .collect()
}

fn pad_row(mut values: Vec<String>, width: usize) -> Vec<String> {
    if values.len() < width {
        values.resize(width, String::new());
    }
    values
}

fn push_unique_sample(samples: &mut Vec<String>, value: String) {
    if samples.iter().any(|existing| existing == &value) {
        return;
    }

    if samples.len() < SAMPLE_VALUE_LIMIT {
        samples.push(value);
    }
}

fn display_data(value: &Data) -> String {
    value.to_string()
}

fn is_boolean_value(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "true" | "false")
}

fn is_date_like(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
        || chrono::NaiveDate::parse_from_str(value, "%Y/%m/%d").is_ok()
        || chrono::NaiveDate::parse_from_str(value, "%m/%d/%Y").is_ok()
        || chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").is_ok()
}

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use super::{profile_sheet_columns, sheet_preview};
    use crate::models::{ColumnType, WorkbookFormat};
    use crate::workbook::engine::WorkbookEngine;
    use crate::workbook::{csv_backend::CsvBackend, xlsx_backend::XlsxBackend, WorkbookSource};
    use uuid::Uuid;

    #[test]
    fn inspects_csv_workbooks_and_preserves_header_shape() {
        let csv_path = write_test_csv(
            "customer_id,amount,posted_on,approved\n1,42.5,2025-01-01,true\n2,13.0,2025-01-02,false\n",
        );
        let engine = WorkbookEngine::default();
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);

        let profile = engine
            .inspect_workbook(&source)
            .expect("profile should load");

        assert_eq!(profile.sheet_count, 1);
        assert_eq!(profile.sheets[0].name, "Sheet1");
        assert_eq!(profile.sheets[0].row_count, 2);
        assert_eq!(
            profile.sheets[0].columns,
            vec!["customer_id", "amount", "posted_on", "approved"]
        );

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn previews_csv_rows_with_truncation() {
        let csv_path = write_test_csv("customer_id,amount\n1,42.5\n2,13.0\n3,11.25\n");
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);
        let preview = sheet_preview(&CsvBackend::default(), &XlsxBackend, &source, "Sheet1", 2)
            .expect("preview should load");

        assert_eq!(preview.columns, vec!["customer_id", "amount"]);
        assert_eq!(preview.rows.len(), 2);
        assert!(preview.truncated);
        assert_eq!(preview.rows[0].row_number, 2);
        assert_eq!(preview.rows[0].values, vec!["1", "42.5"]);

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn profiles_csv_columns_from_sample_rows() {
        let csv_path = write_test_csv(
            "customer_id,amount,posted_on,approved,label\n1,42.5,2025-01-01,true,starter\n2,13.0,2025-01-02,false,premium\n3,15.75,2025-01-03,true,starter\n",
        );
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);
        let profile =
            profile_sheet_columns(&CsvBackend::default(), &XlsxBackend, &source, "Sheet1", 2)
                .expect("column profile should load");

        assert_eq!(profile.row_count, 3);
        assert_eq!(profile.sampled_rows, 2);
        assert_eq!(profile.columns[0].inferred_type, ColumnType::Integer);
        assert_eq!(profile.columns[1].inferred_type, ColumnType::Number);
        assert_eq!(profile.columns[2].inferred_type, ColumnType::Date);
        assert_eq!(profile.columns[3].inferred_type, ColumnType::Boolean);
        assert_eq!(profile.columns[4].inferred_type, ColumnType::String);

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    fn write_test_csv(contents: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-inspect-{}.csv", Uuid::new_v4()));
        fs::write(&path, contents).expect("test csv should be written");
        path
    }
}
