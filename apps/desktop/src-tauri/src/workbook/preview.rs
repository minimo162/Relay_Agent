use std::collections::BTreeSet;

use chrono::{NaiveDate, NaiveDateTime};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use super::{
    csv_backend::CsvBackend,
    inspect::{normalize_headers, pad_row},
    source::WorkbookSource,
};
use crate::models::{ColumnType, DiffSummary, SheetDiff, SpreadsheetAction, WorkbookFormat};

const CSV_SHEET_NAME: &str = "Sheet1";

#[derive(Clone, Debug)]
pub struct PreviewResult {
    pub diff_summary: DiffSummary,
    pub requires_approval: bool,
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

    let mut warnings = Vec::new();
    let explicit_output_path = actions
        .iter()
        .filter_map(extract_save_copy_output_path)
        .last()
        .map(str::to_string);
    let output_path = explicit_output_path
        .clone()
        .or_else(|| {
            source.map(|source| source.default_output_path().to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "relay-agent-output-preview.csv".to_string());

    if requires_approval && explicit_output_path.is_none() {
        warnings.push(
            "No explicit save-copy path was provided, so the preview used a derived output path."
                .to_string(),
        );
    }

    let mut table = if requires_csv_preview {
        Some(CsvPreviewTable::load(
            csv_backend,
            source.expect("source presence was checked above"),
        )?)
    } else {
        None
    };
    let mut sheet_diff = None;

    for action in actions {
        match action.tool.as_str() {
            "table.rename_columns" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: RenameColumnsArgs = parse_args("table.rename_columns", &action.args)?;
                let changed_columns = table.rename_columns(&args.renames)?;
                let diff = ensure_sheet_diff(&mut sheet_diff, table.row_count());
                diff.estimated_rows = table.row_count();
                for column in changed_columns {
                    push_unique(&mut diff.changed_columns, column);
                }
            }
            "table.cast_columns" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: CastColumnsArgs = parse_args("table.cast_columns", &action.args)?;
                let cast_warnings = table.cast_columns(&args.casts)?;
                let diff = ensure_sheet_diff(&mut sheet_diff, table.row_count());
                diff.estimated_rows = table.row_count();
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
                let args: FilterRowsArgs = parse_args("table.filter_rows", &action.args)?;
                let diff = ensure_sheet_diff(&mut sheet_diff, table.row_count());
                if let Some(output_sheet) = args.output_sheet.as_deref() {
                    push_unique(
                        &mut diff.warnings,
                        format!(
                            "CSV preview ignores outputSheet `{output_sheet}` and keeps a single logical sheet."
                        ),
                    );
                }
                table.filter_rows(&args.predicate)?;
                diff.estimated_rows = table.row_count();
            }
            "table.derive_column" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: DeriveColumnArgs = parse_args("table.derive_column", &action.args)?;
                table.derive_column(&args)?;
                let diff = ensure_sheet_diff(&mut sheet_diff, table.row_count());
                diff.estimated_rows = table.row_count();
                push_unique(&mut diff.added_columns, args.column);
            }
            "table.group_aggregate" => {
                let table = require_csv_table(table.as_mut())?;
                table.ensure_sheet(action.sheet.as_deref())?;
                let args: GroupAggregateArgs = parse_args("table.group_aggregate", &action.args)?;
                let diff = ensure_sheet_diff(&mut sheet_diff, table.row_count());
                diff.estimated_rows = table.row_count().max(1);
                for measure in args.measures {
                    push_unique(&mut diff.added_columns, measure.alias);
                }
                push_unique(
                    &mut diff.warnings,
                    "Aggregation preview remains approximate until workbook save-copy execution is implemented."
                        .to_string(),
                );
                if let Some(output_sheet) = args.output_sheet {
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

    let mut sheets = Vec::new();
    if let Some(sheet_diff) = sheet_diff {
        sheets.push(sheet_diff);
    }

    let diff_summary = DiffSummary {
        source_path: source
            .map(|source| source.path().to_string_lossy().into_owned())
            .unwrap_or_else(|| "unspecified-input".to_string()),
        output_path,
        mode: "preview".to_string(),
        sheets,
        warnings: warnings.clone(),
    };

    Ok(PreviewResult {
        diff_summary,
        requires_approval,
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
    measures: Vec<AggregateMeasure>,
    output_sheet: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AggregateMeasure {
    #[serde(rename = "as")]
    alias: String,
}

struct CsvPreviewTable {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
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

    fn column_index(&self, column: &str) -> Result<usize, String> {
        self.find_column_index(column)
            .ok_or_else(|| format!("column `{column}` was not found in the staged CSV preview"))
    }

    fn find_column_index(&self, column: &str) -> Option<usize> {
        self.columns.iter().position(|existing| existing == column)
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

fn parse_args<T: DeserializeOwned>(tool: &str, args: &Value) -> Result<T, String> {
    serde_json::from_value(args.clone())
        .map_err(|error| format!("failed to parse `{tool}` arguments for preview: {error}"))
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
        sheet: CSV_SHEET_NAME.to_string(),
        estimated_rows: row_count,
        added_columns: Vec::new(),
        changed_columns: Vec::new(),
        removed_columns: Vec::new(),
        warnings: Vec::new(),
    })
}

fn require_csv_table(table: Option<&mut CsvPreviewTable>) -> Result<&mut CsvPreviewTable, String> {
    table.ok_or_else(|| "CSV write preview state was not initialized".to_string())
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

#[cfg(test)]
mod tests {
    use std::{env, fs};

    use serde_json::{json, Value};
    use uuid::Uuid;

    use super::{preview_actions, CsvBackend};
    use crate::models::{SpreadsheetAction, WorkbookFormat};
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
        assert_eq!(preview.diff_summary.sheets.len(), 1);
        assert_eq!(preview.diff_summary.output_path, output_path);
        assert_eq!(preview.diff_summary.sheets[0].estimated_rows, 2);
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

        assert_eq!(preview.diff_summary.sheets[0].estimated_rows, 2);
        assert_eq!(
            preview.diff_summary.sheets[0].added_columns,
            vec!["Label".to_string()]
        );

        fs::remove_file(csv_path).expect("test csv should clean up");
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
