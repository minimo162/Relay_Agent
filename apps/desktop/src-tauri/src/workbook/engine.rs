use super::{
    csv_backend::CsvBackend,
    inspect::{
        profile_sheet_columns, sheet_preview, InspectPlan, SheetColumnProfile, SheetPreview,
    },
    preview::{preview_strategy, PreviewStrategy},
    source::WorkbookSource,
    xlsx_backend::XlsxBackend,
};
use crate::models::WorkbookProfile;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WorkbookLibrarySelection {
    pub csv_crate: &'static str,
    pub xlsx_crate: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ModuleBoundary {
    pub module: &'static str,
    pub responsibility: &'static str,
}

pub const WORKBOOK_ENGINE_BOUNDARIES: [ModuleBoundary; 5] = [
    ModuleBoundary {
        module: "workbook::source",
        responsibility: "Detect the source format, normalize source paths, and derive save-copy paths.",
    },
    ModuleBoundary {
        module: "workbook::csv_backend",
        responsibility: "Own CSV reader and writer construction for the CSV-first inspect and preview path.",
    },
    ModuleBoundary {
        module: "workbook::xlsx_backend",
        responsibility: "Own read-only spreadsheet opening for limited xlsx inspection and save-copy handoff.",
    },
    ModuleBoundary {
        module: "workbook::inspect",
        responsibility: "Define row-preview and column-profile limits for workbook.inspect, sheet.preview, and sheet.profile_columns.",
    },
    ModuleBoundary {
        module: "workbook::preview",
        responsibility: "Choose whether a source can participate in write-preview or inspect-only flows.",
    },
];

#[derive(Debug, Default)]
pub struct WorkbookEngine {
    csv: CsvBackend,
    xlsx: XlsxBackend,
}

impl WorkbookEngine {
    pub fn selected_libraries(&self) -> WorkbookLibrarySelection {
        WorkbookLibrarySelection {
            csv_crate: "csv",
            xlsx_crate: "calamine",
        }
    }

    pub fn inspect_plan(&self) -> InspectPlan {
        InspectPlan::default()
    }

    pub fn preview_strategy(&self, source: &WorkbookSource) -> PreviewStrategy {
        preview_strategy(source.format())
    }

    pub fn inspect_workbook(&self, source: &WorkbookSource) -> Result<WorkbookProfile, String> {
        super::inspect::inspect_workbook(&self.csv, &self.xlsx, source)
    }

    pub fn sheet_preview(
        &self,
        source: &WorkbookSource,
        sheet: &str,
        limit: Option<usize>,
    ) -> Result<SheetPreview, String> {
        let plan = self.inspect_plan();

        sheet_preview(
            &self.csv,
            &self.xlsx,
            source,
            sheet,
            limit.unwrap_or(plan.preview_row_limit),
        )
    }

    pub fn profile_sheet_columns(
        &self,
        source: &WorkbookSource,
        sheet: &str,
        sample_size: Option<usize>,
    ) -> Result<SheetColumnProfile, String> {
        let plan = self.inspect_plan();

        profile_sheet_columns(
            &self.csv,
            &self.xlsx,
            source,
            sheet,
            sample_size.unwrap_or(plan.profile_sample_size),
        )
    }

    pub fn csv_backend(&self) -> &CsvBackend {
        &self.csv
    }

    pub fn xlsx_backend(&self) -> &XlsxBackend {
        &self.xlsx
    }
}

#[cfg(test)]
mod tests {
    use super::WorkbookEngine;
    use crate::models::WorkbookFormat;
    use crate::workbook::preview::PreviewStrategy;
    use crate::workbook::source::WorkbookSource;

    #[test]
    fn reports_selected_libraries() {
        let engine = WorkbookEngine::default();
        let libraries = engine.selected_libraries();

        assert_eq!(libraries.csv_crate, "csv");
        assert_eq!(libraries.xlsx_crate, "calamine");
    }

    #[test]
    fn keeps_csv_as_the_only_write_preview_path() {
        let engine = WorkbookEngine::default();
        let csv_source = WorkbookSource::new("/tmp/input.csv", WorkbookFormat::Csv);
        let xlsx_source = WorkbookSource::new("/tmp/input.xlsx", WorkbookFormat::Xlsx);

        assert_eq!(
            engine.preview_strategy(&csv_source),
            PreviewStrategy::CsvTransform
        );
        assert_eq!(
            engine.preview_strategy(&xlsx_source),
            PreviewStrategy::InspectOnly
        );
    }
}
