use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use chrono::{NaiveDate, NaiveDateTime};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use super::{
    csv_backend::CsvBackend,
    inspect::{normalize_headers, pad_row},
    source::WorkbookSource,
};
use crate::models::{
    ColumnType, DiffSummary, PreviewTarget, PreviewTargetKind, SheetDiff, SpreadsheetAction,
    WorkbookFormat,
};

const CSV_SHEET_NAME: &str = "Sheet1";

#[derive(Clone, Debug)]
pub struct PreviewResult {
    pub diff_summary: DiffSummary,
    pub requires_approval: bool,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct WriteExecutionResult {
    pub output_path: String,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewStrategy {
    CsvTransform,
    InspectOnly,
}

pub fn preview_strategy(format: WorkbookFormat) -> PreviewStrategy {
    match format {
        WorkbookFormat::Csv => PreviewStrategy::CsvTransform,
        WorkbookFormat::Xlsx => PreviewStrategy::InspectOnly,
    }
}

pub fn supports_save_copy(format: WorkbookFormat) -> bool {
    matches!(format, WorkbookFormat::Csv | WorkbookFormat::Xlsx)
}

pub fn supports_write_preview(format: WorkbookFormat) -> bool {
    matches!(format, WorkbookFormat::Csv)
}

pub fn preview_actions(
    csv_backend: &CsvBackend,
    source: Option<&WorkbookSource>,
    actions: &[SpreadsheetAction],
) -> Result<PreviewResult, String> {
    let requires_approval = actions.iter().any(is_write_action);
    let requires_csv_preview = actions.iter().any(requires_csv_transform_preview);

    if requires_approval && source.is_none() {
        return Err("write preview requires a workbook source path".to_string());
    }

    if requires_csv_preview
        && !source
            .map(|source| supports_write_preview(source.format()))
            .unwrap_or(false)
    {
        return Err(
            "write preview is currently supported only for CSV workbook sources".to_string(),
        );
    }

    let (output_path, warnings) = resolve_output_path(source, actions, requires_approval)?;

    let mut table = if requires_csv_preview {
        Some(CsvPreviewTable::load(
            csv_backend,
            source.expect("source presence was checked above"),
        )?)
    } else {
        None
    };
    let mut sheet_diff = None;
    apply_actions_to_csv_table(actions, &mut table, &mut sheet_diff)?;

    let mut sheets = Vec::new();
    if let Some(sheet_diff) = sheet_diff {
        sheets.push(sheet_diff);
    }
    let estimated_affected_rows = sheets
        .iter()
        .map(|sheet| sheet.estimated_affected_rows)
        .sum();

    let diff_summary = DiffSummary {
        source_path: source
            .map(|source| source.path().to_string_lossy().into_owned())
            .unwrap_or_else(|| "unspecified-input".to_string()),
        output_path,
        mode: "preview".to_string(),
        target_count: sheets.len() as u32,
        estimated_affected_rows,
        sheets,
        warnings: warnings.clone(),
    };

    Ok(PreviewResult {
        diff_summary,
        requires_approval,
        warnings,
    })
}

pub fn execute_actions(
    csv_backend: &CsvBackend,
    source: &WorkbookSource,
    actions: &[SpreadsheetAction],
) -> Result<WriteExecutionResult, String> {
    if !actions.iter().any(is_write_action) {
        return Err("write execution requires at least one write action".to_string());
    }

    let requires_csv_replay = actions.iter().any(requires_csv_transform_preview);
    let (output_path, mut warnings) = resolve_output_path(Some(source), actions, true)?;

    if source.format() == WorkbookFormat::Xlsx {
        if requires_csv_replay {
            return Err(
                "write execution is currently supported only for CSV workbook sources".to_string(),
            );
        }

        write_output_copy(source.path(), Path::new(&output_path))?;
        return Ok(WriteExecutionResult {
            output_path,
            warnings,
        });
    }

    let mut table = Some(CsvPreviewTable::load(csv_backend, source)?);
    let mut sheet_diff = None;
    apply_actions_to_csv_table(actions, &mut table, &mut sheet_diff)?;

    let rendered = table
        .expect("CSV write execution initializes a staged table")
        .render_sanitized_csv(csv_backend)?;
    write_output_contents(Path::new(&output_path), rendered.contents.as_bytes())?;

    if rendered.sanitized_cell_count > 0 {
        warnings.push(format!(
            "CSV output sanitization prefixed {} cell(s) that started with `=`, `+`, `-`, or `@`.",
            rendered.sanitized_cell_count
        ));
    }

    Ok(WriteExecutionResult {
        output_path,
        warnings,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameColumnsArgs {
    renames: Vec<ColumnRename>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnRename {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CastColumnsArgs {
    casts: Vec<ColumnCast>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ColumnCast {
    column: String,
    to_type: ColumnType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterRowsArgs {
    predicate: String,
    output_sheet: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DeriveColumnPosition {
    Start,
    End,
    After,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeriveColumnArgs {
    column: String,
    expression: String,
    position: Option<DeriveColumnPosition>,
    after_column: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupAggregateArgs {
    group_by: Vec<String>,
    measures: Vec<AggregateMeasure>,
    output_sheet: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AggregateOperation {
    Sum,
    Avg,
    Count,
    Min,
    Max,
}

impl AggregateOperation {
    fn label(self) -> &'static str {
        match self {
            Self::Sum => "sum",
            Self::Avg => "avg",
            Self::Count => "count",
            Self::Min => "min",
            Self::Max => "max",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AggregateMeasure {
    column: String,
    op: AggregateOperation,
    #[serde(rename = "as")]
    alias: String,
}

#[derive(Debug)]
struct GroupAggregateResult {
    added_columns: Vec<String>,
    changed_columns: Vec<String>,
    removed_columns: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct AggregateMeasurePlan {
    column: String,
    column_index: usize,
    op: AggregateOperation,
    alias: String,
}

#[derive(Clone, Debug)]
struct GroupAccumulator {
    key_values: Vec<String>,
    states: Vec<AggregateState>,
}

#[derive(Clone, Debug)]
enum AggregateState {
    Sum {
        total: f64,
        numeric_count: u32,
        invalid_count: u32,
    },
    Avg {
        total: f64,
        numeric_count: u32,
        invalid_count: u32,
    },
    Count {
        count: u32,
    },
    Min {
        best: Option<String>,
    },
    Max {
        best: Option<String>,
    },
}

struct CsvPreviewTable {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

struct RenderedCsvOutput {
    contents: String,
    sanitized_cell_count: usize,
}

impl CsvPreviewTable {
    fn load(csv_backend: &CsvBackend, source: &WorkbookSource) -> Result<Self, String> {
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
        ensure_unique_columns(&columns)?;

        let mut rows = Vec::new();
        for (index, record) in reader.records().enumerate() {
            let record = record.map_err(|error| {
                format!(
                    "failed to read CSV row {} from `{}`: {error}",
                    index + 2,
                    source.path().display()
                )
            })?;
            rows.push(pad_row(
                record.iter().map(str::to_string).collect(),
                columns.len(),
            ));
        }

        Ok(Self { columns, rows })
    }

    fn ensure_sheet(&self, sheet: Option<&str>) -> Result<(), String> {
        match sheet.unwrap_or(CSV_SHEET_NAME) {
            CSV_SHEET_NAME => Ok(()),
            other => Err(format!(
                "CSV sources expose a single logical sheet named `{CSV_SHEET_NAME}`, but `{other}` was requested"
            )),
        }
    }

    fn row_count(&self) -> u32 {
        self.rows.len() as u32
    }

    fn rename_columns(&mut self, renames: &[ColumnRename]) -> Result<Vec<String>, String> {
        let mut changed_columns = Vec::new();

        for rename in renames {
            let index = self.column_index(&rename.from)?;
            if rename.from == rename.to {
                continue;
            }
            if let Some(existing_index) = self.find_column_index(&rename.to) {
                if existing_index != index {
                    return Err(format!(
                        "cannot rename `{}` to `{}` because the target column already exists",
                        rename.from, rename.to
                    ));
                }
            }
            self.columns[index] = rename.to.clone();
            push_unique(&mut changed_columns, rename.to.clone());
        }

        ensure_unique_columns(&self.columns)?;

        Ok(changed_columns)
    }

    fn cast_columns(&self, casts: &[ColumnCast]) -> Result<Vec<String>, String> {
        let mut warnings = Vec::new();

        for cast in casts {
            let index = self.column_index(&cast.column)?;
            let invalid_count = self
                .rows
                .iter()
                .filter(|row| !row[index].trim().is_empty())
                .filter(|row| !value_matches_type(&row[index], cast.to_type))
                .count();
            if invalid_count > 0 {
                warnings.push(format!(
                    "Cast preview found {invalid_count} non-empty value(s) in `{}` that do not match `{}`.",
                    cast.column,
                    column_type_label(cast.to_type)
                ));
            }
        }

        Ok(warnings)
    }

    fn filter_rows(&mut self, predicate: &str) -> Result<(), String> {
        let predicate = Predicate::parse(predicate)?;
        let columns = self.columns.clone();
        let mut filtered_rows = Vec::new();

        for (index, row) in self.rows.iter().enumerate() {
            if predicate.evaluate(&columns, row).map_err(|error| {
                format!(
                    "failed to evaluate filter predicate on CSV row {}: {error}",
                    index + 2
                )
            })? {
                filtered_rows.push(row.clone());
            }
        }

        self.rows = filtered_rows;
        Ok(())
    }

    fn derive_column(&mut self, args: &DeriveColumnArgs) -> Result<(), String> {
        if self.find_column_index(&args.column).is_some() {
            return Err(format!(
                "cannot derive `{}` because that column already exists",
                args.column
            ));
        }

        if args.expression.trim_start().starts_with('=') {
            return Err(
                "raw Excel-style formulas are not accepted in derive_column expressions"
                    .to_string(),
            );
        }

        let expression = Expression::parse(&args.expression)?;
        let insert_at = match args.position.as_ref().unwrap_or(&DeriveColumnPosition::End) {
            DeriveColumnPosition::Start => 0,
            DeriveColumnPosition::End => self.columns.len(),
            DeriveColumnPosition::After => {
                let after_column = args.after_column.as_deref().ok_or_else(|| {
                    "derive_column position `after` requires `afterColumn`".to_string()
                })?;
                self.column_index(after_column)? + 1
            }
        };
        let columns = self.columns.clone();

        for (index, row) in self.rows.iter_mut().enumerate() {
            let value = expression.evaluate(&columns, row).map_err(|error| {
                format!(
                    "failed to evaluate derive_column expression on CSV row {}: {error}",
                    index + 2
                )
            })?;
            row.insert(insert_at, value.as_string());
        }

        self.columns.insert(insert_at, args.column.clone());
        ensure_unique_columns(&self.columns)?;

        Ok(())
    }

    fn group_aggregate(
        &mut self,
        args: &GroupAggregateArgs,
    ) -> Result<GroupAggregateResult, String> {
        let original_columns = self.columns.clone();
        let group_by_indexes = args
            .group_by
            .iter()
            .map(|column| self.column_index(column))
            .collect::<Result<Vec<_>, _>>()?;
        let measures = args
            .measures
            .iter()
            .map(|measure| {
                Ok(AggregateMeasurePlan {
                    column: measure.column.clone(),
                    column_index: self.column_index(&measure.column)?,
                    op: measure.op,
                    alias: measure.alias.clone(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let next_columns = args
            .group_by
            .iter()
            .cloned()
            .chain(args.measures.iter().map(|measure| measure.alias.clone()))
            .collect::<Vec<_>>();
        ensure_unique_columns(&next_columns)?;

        let mut group_indexes = BTreeMap::<Vec<String>, usize>::new();
        let mut groups = Vec::new();

        for row in &self.rows {
            let key_values = group_by_indexes
                .iter()
                .map(|index| row.get(*index).cloned().unwrap_or_default())
                .collect::<Vec<_>>();
            let group_index = match group_indexes.get(&key_values).copied() {
                Some(existing) => existing,
                None => {
                    let next_index = groups.len();
                    group_indexes.insert(key_values.clone(), next_index);
                    groups.push(GroupAccumulator::new(key_values, &measures));
                    next_index
                }
            };
            groups[group_index].observe(row, &measures);
        }

        let mut warnings = Vec::new();
        let aggregated_rows = groups
            .into_iter()
            .map(|group| {
                let (row, group_warnings) = group.into_row(&measures);
                warnings.extend(group_warnings);
                row
            })
            .collect::<Vec<_>>();

        self.columns = next_columns.clone();
        self.rows = aggregated_rows;

        let mut added_columns = Vec::new();
        let mut changed_columns = Vec::new();
        let mut removed_columns = Vec::new();

        for column in &next_columns {
            if original_columns.iter().any(|existing| existing == column) {
                if !args.group_by.iter().any(|group_by| group_by == column) {
                    push_unique(&mut changed_columns, column.clone());
                }
            } else {
                push_unique(&mut added_columns, column.clone());
            }
        }

        for column in &original_columns {
            if !next_columns.iter().any(|next| next == column) {
                push_unique(&mut removed_columns, column.clone());
            }
        }

        Ok(GroupAggregateResult {
            added_columns,
            changed_columns,
            removed_columns,
            warnings,
        })
    }

    fn render_csv(&self, csv_backend: &CsvBackend) -> Result<String, String> {
        let mut writer = csv_backend.writer_builder().from_writer(Vec::new());
        writer
            .write_record(&self.columns)
            .map_err(|error| format!("failed to write CSV headers for preview output: {error}"))?;

        for row in &self.rows {
            writer.write_record(row).map_err(|error| {
                format!("failed to write CSV preview output row to buffer: {error}")
            })?;
        }

        let bytes = writer.into_inner().map_err(|error| {
            format!(
                "failed to finalize CSV preview output buffer: {}",
                error.error()
            )
        })?;

        String::from_utf8(bytes)
            .map_err(|error| format!("failed to decode CSV preview output as UTF-8: {error}"))
    }

    fn render_sanitized_csv(&self, csv_backend: &CsvBackend) -> Result<RenderedCsvOutput, String> {
        let mut writer = csv_backend.writer_builder().from_writer(Vec::new());
        let (headers, header_sanitized_count) = sanitize_csv_record(&self.columns);
        writer.write_record(headers).map_err(|error| {
            format!("failed to write CSV headers for execution output: {error}")
        })?;

        let mut sanitized_cell_count = header_sanitized_count;
        for row in &self.rows {
            let (sanitized_row, row_sanitized_count) = sanitize_csv_record(row);
            sanitized_cell_count += row_sanitized_count;
            writer.write_record(sanitized_row).map_err(|error| {
                format!("failed to write CSV execution output row to buffer: {error}")
            })?;
        }

        let bytes = writer.into_inner().map_err(|error| {
            format!(
                "failed to finalize CSV execution output buffer: {}",
                error.error()
            )
        })?;

        let contents = String::from_utf8(bytes)
            .map_err(|error| format!("failed to decode CSV execution output as UTF-8: {error}"))?;

        Ok(RenderedCsvOutput {
            contents,
            sanitized_cell_count,
        })
    }

    fn column_index(&self, column: &str) -> Result<usize, String> {
        self.find_column_index(column)
            .ok_or_else(|| format!("column `{column}` was not found in the staged CSV preview"))
    }

    fn find_column_index(&self, column: &str) -> Option<usize> {
        self.columns.iter().position(|existing| existing == column)
    }
}

impl GroupAccumulator {
    fn new(key_values: Vec<String>, measures: &[AggregateMeasurePlan]) -> Self {
        Self {
            key_values,
            states: measures
                .iter()
                .map(|measure| AggregateState::new(measure.op))
                .collect(),
        }
    }

    fn observe(&mut self, row: &[String], measures: &[AggregateMeasurePlan]) {
        for (state, measure) in self.states.iter_mut().zip(measures) {
            let value = row
                .get(measure.column_index)
                .map(String::as_str)
                .unwrap_or("");
            state.observe(value);
        }
    }

    fn into_row(self, measures: &[AggregateMeasurePlan]) -> (Vec<String>, Vec<String>) {
        let mut row = self.key_values;
        let mut warnings = Vec::new();

        for (state, measure) in self.states.into_iter().zip(measures) {
            let (value, warning) = state.finalize(measure);
            row.push(value);
            if let Some(warning) = warning {
                push_unique(&mut warnings, warning);
            }
        }

        (row, warnings)
    }
}

impl AggregateState {
    fn new(op: AggregateOperation) -> Self {
        match op {
            AggregateOperation::Sum => Self::Sum {
                total: 0.0,
                numeric_count: 0,
                invalid_count: 0,
            },
            AggregateOperation::Avg => Self::Avg {
                total: 0.0,
                numeric_count: 0,
                invalid_count: 0,
            },
            AggregateOperation::Count => Self::Count { count: 0 },
            AggregateOperation::Min => Self::Min { best: None },
            AggregateOperation::Max => Self::Max { best: None },
        }
    }

    fn observe(&mut self, raw_value: &str) {
        let value = raw_value.trim();

        match self {
            Self::Sum {
                total,
                numeric_count,
                invalid_count,
            }
            | Self::Avg {
                total,
                numeric_count,
                invalid_count,
            } => {
                if value.is_empty() {
                    return;
                }

                match value.parse::<f64>() {
                    Ok(parsed) => {
                        *total += parsed;
                        *numeric_count += 1;
                    }
                    Err(_) => *invalid_count += 1,
                }
            }
            Self::Count { count } => {
                if !value.is_empty() {
                    *count += 1;
                }
            }
            Self::Min { best } => {
                if value.is_empty() {
                    return;
                }

                match best {
                    Some(current) if compare_aggregate_values(value, current) == Ordering::Less => {
                        *best = Some(value.to_string());
                    }
                    None => *best = Some(value.to_string()),
                    _ => {}
                }
            }
            Self::Max { best } => {
                if value.is_empty() {
                    return;
                }

                match best {
                    Some(current)
                        if compare_aggregate_values(value, current) == Ordering::Greater =>
                    {
                        *best = Some(value.to_string());
                    }
                    None => *best = Some(value.to_string()),
                    _ => {}
                }
            }
        }
    }

    fn finalize(self, measure: &AggregateMeasurePlan) -> (String, Option<String>) {
        match self {
            Self::Sum {
                total,
                numeric_count,
                invalid_count,
            } => (
                if numeric_count == 0 {
                    String::new()
                } else {
                    format_number(total)
                },
                build_numeric_aggregation_warning(measure, invalid_count),
            ),
            Self::Avg {
                total,
                numeric_count,
                invalid_count,
            } => (
                if numeric_count == 0 {
                    String::new()
                } else {
                    format_number(total / numeric_count as f64)
                },
                build_numeric_aggregation_warning(measure, invalid_count),
            ),
            Self::Count { count } => (count.to_string(), None),
            Self::Min { best } | Self::Max { best } => (best.unwrap_or_default(), None),
        }
    }
}

#[derive(Clone, Debug)]
enum Expression {
    Column(String),
    StringLiteral(String),
    NumberLiteral(f64),
    BooleanLiteral(bool),
    Binary {
        left: Box<Expression>,
        operator: BinaryOperator,
        right: Box<Expression>,
    },
}

#[derive(Clone, Copy, Debug)]
enum BinaryOperator {
    Add,
    Subtract,
    Multiply,
    Divide,
}

#[derive(Clone, Debug)]
struct Predicate {
    left: Expression,
    operator: ComparisonOperator,
    right: Expression,
}

#[derive(Clone, Copy, Debug)]
enum ComparisonOperator {
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

#[derive(Clone, Debug)]
enum EvaluatedValue {
    String(String),
    Number(f64),
    Boolean(bool),
}

impl Expression {
    fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();
        if input.is_empty() {
            return Err("expression cannot be empty".to_string());
        }

        if let Some((index, operator)) = find_last_operator(input, &[" + ", " - "]) {
            let left = Self::parse(&input[..index])?;
            let right = Self::parse(&input[index + operator.len()..])?;
            return Ok(Self::Binary {
                left: Box::new(left),
                operator: match operator {
                    " + " => BinaryOperator::Add,
                    " - " => BinaryOperator::Subtract,
                    _ => unreachable!("operator list is fixed"),
                },
                right: Box::new(right),
            });
        }

        if let Some((index, operator)) = find_last_operator(input, &[" * ", " / "]) {
            let left = Self::parse(&input[..index])?;
            let right = Self::parse(&input[index + operator.len()..])?;
            return Ok(Self::Binary {
                left: Box::new(left),
                operator: match operator {
                    " * " => BinaryOperator::Multiply,
                    " / " => BinaryOperator::Divide,
                    _ => unreachable!("operator list is fixed"),
                },
                right: Box::new(right),
            });
        }

        parse_primary_expression(input)
    }

    fn evaluate(&self, columns: &[String], row: &[String]) -> Result<EvaluatedValue, String> {
        match self {
            Self::Column(column) => {
                let index = columns
                    .iter()
                    .position(|candidate| candidate == column)
                    .ok_or_else(|| format!("expression referenced unknown column `{column}`"))?;
                Ok(EvaluatedValue::String(
                    row.get(index).cloned().unwrap_or_default(),
                ))
            }
            Self::StringLiteral(value) => Ok(EvaluatedValue::String(value.clone())),
            Self::NumberLiteral(value) => Ok(EvaluatedValue::Number(*value)),
            Self::BooleanLiteral(value) => Ok(EvaluatedValue::Boolean(*value)),
            Self::Binary {
                left,
                operator,
                right,
            } => {
                let left = left.evaluate(columns, row)?;
                let right = right.evaluate(columns, row)?;
                evaluate_binary_expression(left, *operator, right)
            }
        }
    }
}

impl Predicate {
    fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();
        let Some((index, operator)) =
            find_last_operator(input, &[">=", "<=", "==", "!=", "=", ">", "<"])
        else {
            return Err(
                "filter_rows predicates must use one comparison such as `amount > 10`".to_string(),
            );
        };

        let left = Expression::parse(&input[..index])?;
        let right = Expression::parse(&input[index + operator.len()..])?;
        let operator = match operator {
            "=" | "==" => ComparisonOperator::Equal,
            "!=" => ComparisonOperator::NotEqual,
            ">" => ComparisonOperator::GreaterThan,
            ">=" => ComparisonOperator::GreaterThanOrEqual,
            "<" => ComparisonOperator::LessThan,
            "<=" => ComparisonOperator::LessThanOrEqual,
            _ => unreachable!("operator list is fixed"),
        };

        Ok(Self {
            left,
            operator,
            right,
        })
    }

    fn evaluate(&self, columns: &[String], row: &[String]) -> Result<bool, String> {
        let left = self.left.evaluate(columns, row)?;
        let right = self.right.evaluate(columns, row)?;

        compare_values(left, self.operator, right)
    }
}

impl EvaluatedValue {
    fn as_string(&self) -> String {
        match self {
            Self::String(value) => value.clone(),
            Self::Number(value) => format_number(*value),
            Self::Boolean(value) => value.to_string(),
        }
    }
}

fn parse_primary_expression(input: &str) -> Result<Expression, String> {
    if input.starts_with('[') && input.ends_with(']') && input.len() > 2 {
        return Ok(Expression::Column(
            input[1..input.len() - 1].trim().to_string(),
        ));
    }

    if input.starts_with('"') && input.ends_with('"') && input.len() >= 2 {
        let parsed: String = serde_json::from_str(input)
            .map_err(|error| format!("failed to parse string literal `{input}`: {error}"))?;
        return Ok(Expression::StringLiteral(parsed));
    }

    if input.starts_with('\'') && input.ends_with('\'') && input.len() >= 2 {
        return Ok(Expression::StringLiteral(
            input[1..input.len() - 1].to_string(),
        ));
    }

    if input.eq_ignore_ascii_case("true") {
        return Ok(Expression::BooleanLiteral(true));
    }

    if input.eq_ignore_ascii_case("false") {
        return Ok(Expression::BooleanLiteral(false));
    }

    if let Ok(number) = input.parse::<f64>() {
        return Ok(Expression::NumberLiteral(number));
    }

    Ok(Expression::Column(input.to_string()))
}

fn evaluate_binary_expression(
    left: EvaluatedValue,
    operator: BinaryOperator,
    right: EvaluatedValue,
) -> Result<EvaluatedValue, String> {
    match operator {
        BinaryOperator::Add => {
            if let (Some(left), Some(right)) = (as_number(&left), as_number(&right)) {
                Ok(EvaluatedValue::Number(left + right))
            } else {
                Ok(EvaluatedValue::String(format!(
                    "{}{}",
                    left.as_string(),
                    right.as_string()
                )))
            }
        }
        BinaryOperator::Subtract => Ok(EvaluatedValue::Number(
            as_number(&left).ok_or_else(|| {
                format!(
                    "left side of subtraction must be numeric, found `{}`",
                    left.as_string()
                )
            })? - as_number(&right).ok_or_else(|| {
                format!(
                    "right side of subtraction must be numeric, found `{}`",
                    right.as_string()
                )
            })?,
        )),
        BinaryOperator::Multiply => Ok(EvaluatedValue::Number(
            as_number(&left).ok_or_else(|| {
                format!(
                    "left side of multiplication must be numeric, found `{}`",
                    left.as_string()
                )
            })? * as_number(&right).ok_or_else(|| {
                format!(
                    "right side of multiplication must be numeric, found `{}`",
                    right.as_string()
                )
            })?,
        )),
        BinaryOperator::Divide => {
            let numerator = as_number(&left).ok_or_else(|| {
                format!(
                    "left side of division must be numeric, found `{}`",
                    left.as_string()
                )
            })?;
            let denominator = as_number(&right).ok_or_else(|| {
                format!(
                    "right side of division must be numeric, found `{}`",
                    right.as_string()
                )
            })?;
            if denominator == 0.0 {
                return Err("division by zero is not allowed in derive_column preview".to_string());
            }

            Ok(EvaluatedValue::Number(numerator / denominator))
        }
    }
}

fn compare_values(
    left: EvaluatedValue,
    operator: ComparisonOperator,
    right: EvaluatedValue,
) -> Result<bool, String> {
    if let (Some(left), Some(right)) = (as_number(&left), as_number(&right)) {
        return Ok(match operator {
            ComparisonOperator::Equal => left == right,
            ComparisonOperator::NotEqual => left != right,
            ComparisonOperator::GreaterThan => left > right,
            ComparisonOperator::GreaterThanOrEqual => left >= right,
            ComparisonOperator::LessThan => left < right,
            ComparisonOperator::LessThanOrEqual => left <= right,
        });
    }

    if let (Some(left), Some(right)) = (as_boolean(&left), as_boolean(&right)) {
        return match operator {
            ComparisonOperator::Equal => Ok(left == right),
            ComparisonOperator::NotEqual => Ok(left != right),
            _ => Err("boolean predicates only support `=` and `!=` comparisons".to_string()),
        };
    }

    if let (Some(left), Some(right)) = (as_datetime(&left), as_datetime(&right)) {
        return Ok(match operator {
            ComparisonOperator::Equal => left == right,
            ComparisonOperator::NotEqual => left != right,
            ComparisonOperator::GreaterThan => left > right,
            ComparisonOperator::GreaterThanOrEqual => left >= right,
            ComparisonOperator::LessThan => left < right,
            ComparisonOperator::LessThanOrEqual => left <= right,
        });
    }

    let left = left.as_string();
    let right = right.as_string();

    Ok(match operator {
        ComparisonOperator::Equal => left == right,
        ComparisonOperator::NotEqual => left != right,
        ComparisonOperator::GreaterThan => left > right,
        ComparisonOperator::GreaterThanOrEqual => left >= right,
        ComparisonOperator::LessThan => left < right,
        ComparisonOperator::LessThanOrEqual => left <= right,
    })
}

fn as_number(value: &EvaluatedValue) -> Option<f64> {
    match value {
        EvaluatedValue::Number(value) => Some(*value),
        EvaluatedValue::String(value) => value.trim().parse::<f64>().ok(),
        EvaluatedValue::Boolean(_) => None,
    }
}

fn as_boolean(value: &EvaluatedValue) -> Option<bool> {
    match value {
        EvaluatedValue::Boolean(value) => Some(*value),
        EvaluatedValue::String(value) => parse_boolean(value),
        EvaluatedValue::Number(_) => None,
    }
}

fn as_datetime(value: &EvaluatedValue) -> Option<NaiveDateTime> {
    match value {
        EvaluatedValue::String(value) => parse_datetime(value),
        EvaluatedValue::Number(_) | EvaluatedValue::Boolean(_) => None,
    }
}

fn parse_datetime(value: &str) -> Option<NaiveDateTime> {
    let trimmed = value.trim();
    NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S")
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
        })
        .or_else(|| {
            NaiveDate::parse_from_str(trimmed, "%Y/%m/%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
        })
        .or_else(|| {
            NaiveDate::parse_from_str(trimmed, "%m/%d/%Y")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
        })
}

fn parse_boolean(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn value_matches_type(value: &str, column_type: ColumnType) -> bool {
    match column_type {
        ColumnType::String => true,
        ColumnType::Number => value.trim().parse::<f64>().is_ok(),
        ColumnType::Integer => value.trim().parse::<i64>().is_ok(),
        ColumnType::Boolean => parse_boolean(value).is_some(),
        ColumnType::Date => parse_datetime(value).is_some(),
    }
}

fn column_type_label(column_type: ColumnType) -> &'static str {
    match column_type {
        ColumnType::String => "string",
        ColumnType::Number => "number",
        ColumnType::Integer => "integer",
        ColumnType::Boolean => "boolean",
        ColumnType::Date => "date",
    }
}

fn parse_args<T: DeserializeOwned>(context: &str, tool: &str, args: &Value) -> Result<T, String> {
    serde_json::from_value(args.clone())
        .map_err(|error| format!("failed to parse `{tool}` arguments for {context}: {error}"))
}

fn ensure_unique_columns(columns: &[String]) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for column in columns {
        if !seen.insert(column.clone()) {
            return Err(format!(
                "CSV write preview does not support duplicate column headers; `{column}` appears more than once"
            ));
        }
    }

    Ok(())
}

fn find_last_operator<'a>(input: &str, operators: &'a [&'a str]) -> Option<(usize, &'a str)> {
    let mut in_single = false;
    let mut in_double = false;
    let mut bracket_depth = 0usize;
    let mut found = None;

    for (index, ch) in input.char_indices() {
        match ch {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            '[' if !in_single && !in_double => bracket_depth += 1,
            ']' if !in_single && !in_double && bracket_depth > 0 => bracket_depth -= 1,
            _ => {}
        }

        if in_single || in_double || bracket_depth > 0 {
            continue;
        }

        if ch == '='
            && input[..index]
                .chars()
                .next_back()
                .is_some_and(|previous| matches!(previous, '>' | '<' | '!' | '='))
        {
            continue;
        }

        for operator in operators {
            if input[index..].starts_with(operator) {
                found = Some((index, *operator));
                break;
            }
        }
    }

    found
}

fn ensure_sheet_diff(sheet_diff: &mut Option<SheetDiff>, row_count: u32) -> &mut SheetDiff {
    sheet_diff.get_or_insert_with(|| SheetDiff {
        target: PreviewTarget {
            kind: PreviewTargetKind::Sheet,
            sheet: CSV_SHEET_NAME.to_string(),
            table: None,
            label: CSV_SHEET_NAME.to_string(),
        },
        estimated_affected_rows: row_count,
        added_columns: Vec::new(),
        changed_columns: Vec::new(),
        removed_columns: Vec::new(),
        warnings: Vec::new(),
    })
}

fn require_csv_table(table: Option<&mut CsvPreviewTable>) -> Result<&mut CsvPreviewTable, String> {
    table.ok_or_else(|| "CSV write preview state was not initialized".to_string())
}

fn apply_actions_to_csv_table(
    actions: &[SpreadsheetAction],
    table: &mut Option<CsvPreviewTable>,
    sheet_diff: &mut Option<SheetDiff>,
) -> Result<(), String> {
    for action in actions {
        match action.tool.as_str() {
            "table.rename_columns" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: RenameColumnsArgs =
                    parse_args("CSV replay", "table.rename_columns", &action.args)?;
                let changed_columns = table.rename_columns(&args.renames)?;
                let diff = ensure_sheet_diff(sheet_diff, table.row_count());
                diff.estimated_affected_rows = table.row_count();
                for column in changed_columns {
                    push_unique(&mut diff.changed_columns, column);
                }
            }
            "table.cast_columns" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: CastColumnsArgs =
                    parse_args("CSV replay", "table.cast_columns", &action.args)?;
                let cast_warnings = table.cast_columns(&args.casts)?;
                let diff = ensure_sheet_diff(sheet_diff, table.row_count());
                diff.estimated_affected_rows = table.row_count();
                for cast in args.casts {
                    push_unique(&mut diff.changed_columns, cast.column);
                }
                for warning in cast_warnings {
                    push_unique(&mut diff.warnings, warning);
                }
            }
            "table.filter_rows" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: FilterRowsArgs =
                    parse_args("CSV replay", "table.filter_rows", &action.args)?;
                let diff = ensure_sheet_diff(sheet_diff, table.row_count());
                if let Some(output_sheet) = args.output_sheet.as_deref() {
                    push_unique(
                        &mut diff.warnings,
                        format!(
                            "CSV preview ignores outputSheet `{output_sheet}` and keeps a single logical sheet."
                        ),
                    );
                }
                table.filter_rows(&args.predicate)?;
                diff.estimated_affected_rows = table.row_count();
            }
            "table.derive_column" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: DeriveColumnArgs =
                    parse_args("CSV replay", "table.derive_column", &action.args)?;
                table.derive_column(&args)?;
                let diff = ensure_sheet_diff(sheet_diff, table.row_count());
                diff.estimated_affected_rows = table.row_count();
                push_unique(&mut diff.added_columns, args.column);
            }
            "table.group_aggregate" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: GroupAggregateArgs =
                    parse_args("CSV replay", "table.group_aggregate", &action.args)?;
                let aggregation = table.group_aggregate(&args)?;
                let diff = ensure_sheet_diff(sheet_diff, table.row_count());
                diff.estimated_affected_rows = table.row_count();
                for column in aggregation.added_columns {
                    push_unique(&mut diff.added_columns, column);
                }
                for column in aggregation.changed_columns {
                    push_unique(&mut diff.changed_columns, column);
                }
                for column in aggregation.removed_columns {
                    push_unique(&mut diff.removed_columns, column);
                }
                for warning in aggregation.warnings {
                    push_unique(&mut diff.warnings, warning);
                }
                if let Some(output_sheet) = args.output_sheet.as_deref() {
                    push_unique(
                        &mut diff.warnings,
                        format!(
                            "CSV preview ignores outputSheet `{output_sheet}` and keeps a single logical sheet."
                        ),
                    );
                }
            }
            "workbook.save_copy"
            | "workbook.inspect"
            | "sheet.preview"
            | "sheet.profile_columns"
            | "session.diff_from_base" => {}
            _ => {}
        }
    }

    Ok(())
}

fn sanitize_csv_record(record: &[String]) -> (Vec<String>, usize) {
    let mut sanitized_count = 0;
    let values = record
        .iter()
        .map(|value| match sanitize_csv_cell(value) {
            Some(sanitized) => {
                sanitized_count += 1;
                sanitized
            }
            None => value.clone(),
        })
        .collect();

    (values, sanitized_count)
}

fn sanitize_csv_cell(value: &str) -> Option<String> {
    let first = value.chars().next()?;
    if matches!(first, '=' | '+' | '-' | '@') {
        Some(format!("'{value}"))
    } else {
        None
    }
}

fn write_output_contents(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create output directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    fs::write(path, contents)
        .map_err(|error| format!("failed to write output file `{}`: {error}", path.display()))
}

fn write_output_copy(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create output directory `{}`: {error}",
                parent.display()
            )
        })?;
    }

    fs::copy(source, destination).map_err(|error| {
        format!(
            "failed to copy workbook source `{}` to `{}`: {error}",
            source.display(),
            destination.display()
        )
    })?;

    Ok(())
}

fn resolve_output_path(
    source: Option<&WorkbookSource>,
    actions: &[SpreadsheetAction],
    requires_approval: bool,
) -> Result<(String, Vec<String>), String> {
    let explicit_output_paths = actions
        .iter()
        .filter_map(extract_save_copy_output_path)
        .collect::<Vec<_>>();
    if explicit_output_paths.len() > 1 {
        return Err("preview supports at most one `workbook.save_copy` action".to_string());
    }

    let explicit_output_path = explicit_output_paths
        .first()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(str::to_string);
    let output_path = explicit_output_path
        .clone()
        .or_else(|| {
            source.map(|source| source.default_output_path().to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "relay-agent-output-preview.csv".to_string());

    if let Some(source) = source {
        if !supports_save_copy(source.format()) {
            return Err(format!(
                "save-copy preview is not supported for `{}` workbook sources",
                match source.format() {
                    WorkbookFormat::Csv => "csv",
                    WorkbookFormat::Xlsx => "xlsx",
                }
            ));
        }

        if Path::new(&output_path) == source.path() {
            return Err(
                "save-copy output path must differ from the original workbook source path"
                    .to_string(),
            );
        }
    }

    let mut warnings = Vec::new();
    if requires_approval && explicit_output_path.is_none() {
        warnings.push(
            "No explicit save-copy path was provided, so the preview used a derived output path."
                .to_string(),
        );
    }

    Ok((output_path, warnings))
}

fn requires_csv_transform_preview(action: &SpreadsheetAction) -> bool {
    matches!(
        action.tool.as_str(),
        "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
    )
}

fn is_write_action(action: &SpreadsheetAction) -> bool {
    matches!(
        action.tool.as_str(),
        "table.rename_columns"
            | "table.cast_columns"
            | "table.filter_rows"
            | "table.derive_column"
            | "table.group_aggregate"
            | "workbook.save_copy"
    )
}

fn extract_save_copy_output_path(action: &SpreadsheetAction) -> Option<&str> {
    if action.tool != "workbook.save_copy" {
        return None;
    }

    action.args.get("outputPath").and_then(Value::as_str)
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if values.iter().any(|existing| existing == &value) {
        return;
    }

    values.push(value);
}

fn compare_aggregate_values(left: &str, right: &str) -> Ordering {
    if let (Ok(left), Ok(right)) = (left.parse::<f64>(), right.parse::<f64>()) {
        return left.partial_cmp(&right).unwrap_or(Ordering::Equal);
    }

    if let (Some(left), Some(right)) = (parse_datetime(left), parse_datetime(right)) {
        return left.cmp(&right);
    }

    if let (Some(left), Some(right)) = (parse_boolean(left), parse_boolean(right)) {
        return left.cmp(&right);
    }

    left.cmp(right)
}

fn build_numeric_aggregation_warning(
    measure: &AggregateMeasurePlan,
    invalid_count: u32,
) -> Option<String> {
    if invalid_count == 0 {
        return None;
    }

    Some(format!(
        "Aggregation preview ignored {invalid_count} non-numeric value(s) while computing `{}` on `{}` into `{}`.",
        measure.op.label(),
        measure.column,
        measure.alias
    ))
}

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::{
        preview_actions, AggregateMeasure, AggregateOperation, CsvBackend, CsvPreviewTable,
        GroupAggregateArgs,
    };
    use crate::models::{PreviewTargetKind, SpreadsheetAction, WorkbookFormat};
    use crate::workbook::WorkbookSource;

    #[test]
    fn previews_real_csv_rename_cast_filter_and_derive_actions() {
        let csv_path = write_test_csv(
            "customer_id,amount,posted_on,approved\n1,42.5,2025-01-01,true\n2,oops,2025-01-02,false\n3,11.25,2025-01-03,true\n",
        );
        let output_path = env::temp_dir()
            .join(format!("relay-agent-preview-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);

        let preview = preview_actions(
            &CsvBackend::default(),
            Some(&source),
            &[
                action(
                    "table.rename_columns",
                    Some("Sheet1"),
                    json!({
                        "renames": [{ "from": "amount", "to": "net_amount" }]
                    }),
                ),
                action(
                    "table.cast_columns",
                    Some("Sheet1"),
                    json!({
                        "casts": [{ "column": "net_amount", "toType": "number" }]
                    }),
                ),
                action(
                    "table.filter_rows",
                    Some("Sheet1"),
                    json!({
                        "predicate": "approved = true"
                    }),
                ),
                action(
                    "table.derive_column",
                    Some("Sheet1"),
                    json!({
                        "column": "gross_amount",
                        "expression": "[net_amount] + 10",
                        "position": "after",
                        "afterColumn": "net_amount"
                    }),
                ),
                action(
                    "workbook.save_copy",
                    None,
                    json!({
                        "outputPath": output_path
                    }),
                ),
            ],
        )
        .expect("preview should build");

        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets.len(), 1);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets[0].target.sheet, "Sheet1");
        assert_eq!(
            preview.diff_summary.sheets[0].target.kind,
            PreviewTargetKind::Sheet
        );
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec!["gross_amount".to_string()]
        );
        assert_eq!(
            preview.diff_summary.sheets[0].changed_columns,
            vec!["net_amount".to_string()]
        );
        assert!(preview.diff_summary.sheets[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("do not match `number`")));

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn supports_bracketed_column_names_in_predicates_and_expressions() {
        let csv_path = write_test_csv("Customer ID,Order Total\n1,100\n2,40\n3,55\n");
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);

        let preview = preview_actions(
            &CsvBackend::default(),
            Some(&source),
            &[
                action(
                    "table.filter_rows",
                    Some("Sheet1"),
                    json!({
                        "predicate": "[Order Total] >= 55"
                    }),
                ),
                action(
                    "table.derive_column",
                    Some("Sheet1"),
                    json!({
                        "column": "Label",
                        "expression": "[Customer ID] + \"-VIP\"",
                        "position": "end"
                    }),
                ),
            ],
        )
        .expect("preview should build");

        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 2);
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec!["Label".to_string()]
        );

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn previews_group_aggregate_and_keeps_source_csv_immutable() {
        let original_csv =
            "region,segment,amount,units\nEast,Retail,10,1\nEast,SMB,15,2\nWest,Retail,3,1\nWest,SMB,oops,4\n";
        let csv_path = write_test_csv(original_csv);
        let output_path = env::temp_dir()
            .join(format!("relay-agent-aggregate-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);

        let preview = preview_actions(
            &CsvBackend::default(),
            Some(&source),
            &[
                action(
                    "table.group_aggregate",
                    Some("Sheet1"),
                    json!({
                        "groupBy": ["region"],
                        "measures": [
                            { "column": "amount", "op": "sum", "as": "total_amount" },
                            { "column": "units", "op": "avg", "as": "average_units" },
                            { "column": "segment", "op": "count", "as": "row_count" }
                        ]
                    }),
                ),
                action(
                    "workbook.save_copy",
                    None,
                    json!({
                        "outputPath": output_path
                    }),
                ),
            ],
        )
        .expect("aggregation preview should build");

        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.target_count, 1);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.sheets.len(), 1);
        assert_eq!(preview.diff_summary.sheets[0].estimated_affected_rows, 2);
        assert_eq!(preview.diff_summary.sheets[0].target.label, "Sheet1");
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec![
                "total_amount".to_string(),
                "average_units".to_string(),
                "row_count".to_string()
            ]
        );
        assert!(preview.diff_summary.sheets[0].changed_columns.is_empty());
        assert_eq!(
            preview.diff_summary.sheets[0].removed_columns,
            vec![
                "segment".to_string(),
                "amount".to_string(),
                "units".to_string()
            ]
        );
        assert!(preview.diff_summary.sheets[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("ignored 1 non-numeric value")));
        assert_eq!(
            fs::read_to_string(&csv_path).expect("source CSV should still exist"),
            original_csv
        );

        let mut table = CsvPreviewTable::load(&CsvBackend::default(), &source)
            .expect("table should load from CSV source");
        table
            .group_aggregate(&GroupAggregateArgs {
                group_by: vec!["region".to_string()],
                measures: vec![
                    AggregateMeasure {
                        column: "amount".to_string(),
                        op: AggregateOperation::Sum,
                        alias: "total_amount".to_string(),
                    },
                    AggregateMeasure {
                        column: "units".to_string(),
                        op: AggregateOperation::Avg,
                        alias: "average_units".to_string(),
                    },
                    AggregateMeasure {
                        column: "segment".to_string(),
                        op: AggregateOperation::Count,
                        alias: "row_count".to_string(),
                    },
                ],
                output_sheet: None,
            })
            .expect("direct aggregation should succeed");

        assert_eq!(
            table
                .render_csv(&CsvBackend::default())
                .expect("aggregated CSV should render"),
            "region,total_amount,average_units,row_count\nEast,25,1.5,2\nWest,3,2.5,2\n"
        );

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn rejects_save_copy_paths_that_match_the_source_path() {
        let csv_path = write_test_csv("region,amount\nEast,10\n");
        let source = WorkbookSource::new(csv_path.clone(), WorkbookFormat::Csv);

        let error = preview_actions(
            &CsvBackend::default(),
            Some(&source),
            &[action(
                "workbook.save_copy",
                None,
                json!({
                    "outputPath": csv_path.to_string_lossy()
                }),
            )],
        )
        .expect_err("preview should reject overwriting the source workbook");

        assert!(error.contains("must differ from the original workbook source path"));

        fs::remove_file(csv_path).expect("test csv should clean up");
    }

    #[test]
    fn supports_copy_only_save_copy_preview_for_xlsx_sources() {
        let source = WorkbookSource::new("/tmp/input.xlsx", WorkbookFormat::Xlsx);

        let preview = preview_actions(
            &CsvBackend::default(),
            Some(&source),
            &[action(
                "workbook.save_copy",
                None,
                json!({
                    "outputPath": "/tmp/input.relay-copy.xlsx"
                }),
            )],
        )
        .expect("xlsx save-copy preview should be allowed");

        assert!(preview.requires_approval);
        assert_eq!(preview.diff_summary.target_count, 0);
        assert_eq!(preview.diff_summary.estimated_affected_rows, 0);
        assert!(preview.diff_summary.sheets.is_empty());
        assert_eq!(
            preview.diff_summary.output_path,
            "/tmp/input.relay-copy.xlsx"
        );
        assert!(preview.warnings.is_empty());
    }

    fn action(tool: &str, sheet: Option<&str>, args: Value) -> SpreadsheetAction {
        SpreadsheetAction {
            id: None,
            tool: tool.to_string(),
            rationale: None,
            sheet: sheet.map(str::to_string),
            args,
        }
    }

    fn write_test_csv(contents: &str) -> std::path::PathBuf {
        let path = env::temp_dir().join(format!("relay-agent-preview-test-{}.csv", Uuid::new_v4()));
        fs::write(&path, contents).expect("test csv should be written");
        path
    }
}
