use crate::models::WorkbookFormat;

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
