use std::path::{Path, PathBuf};

use crate::models::WorkbookFormat;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkbookSource {
    path: PathBuf,
    format: WorkbookFormat,
}

impl WorkbookSource {
    pub fn new(path: impl Into<PathBuf>, format: WorkbookFormat) -> Self {
        Self {
            path: path.into(),
            format,
        }
    }

    pub fn detect(path: impl Into<PathBuf>) -> Result<Self, String> {
        let path = path.into();
        let format = detect_workbook_source(&path)?;

        Ok(Self { path, format })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn format(&self) -> WorkbookFormat {
        self.format
    }

    pub fn default_output_path(&self) -> PathBuf {
        default_output_path_path(&self.path)
    }
}

pub fn detect_workbook_source(path: impl AsRef<Path>) -> Result<WorkbookFormat, String> {
    let path = path.as_ref();
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| {
            format!(
                "workbook source `{}` is missing a supported extension",
                path.display()
            )
        })?;

    match extension.as_str() {
        "csv" => Ok(WorkbookFormat::Csv),
        "xlsx" | "xlsm" | "xlam" => Ok(WorkbookFormat::Xlsx),
        _ => Err(format!(
            "workbook source `{}` is unsupported for the MVP workbook engine",
            path.display()
        )),
    }
}

pub fn default_output_path(source_path: &str) -> String {
    default_output_path_path(Path::new(source_path))
        .to_string_lossy()
        .into_owned()
}

fn default_output_path_path(path: &Path) -> PathBuf {
    let file_stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("relay-agent-output");

    match path.extension().and_then(|ext| ext.to_str()) {
        Some(extension) if !extension.is_empty() => {
            path.with_file_name(format!("{file_stem}.relay-copy.{extension}"))
        }
        _ => path.with_file_name(format!("{}.relay-copy", path.to_string_lossy())),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{default_output_path, detect_workbook_source, WorkbookSource};
    use crate::models::WorkbookFormat;

    #[test]
    fn detects_csv_sources() {
        assert_eq!(
            detect_workbook_source("/tmp/revenue.csv").unwrap(),
            WorkbookFormat::Csv
        );
    }

    #[test]
    fn detects_xlsx_family_sources() {
        assert_eq!(
            detect_workbook_source("/tmp/revenue.xlsx").unwrap(),
            WorkbookFormat::Xlsx
        );
        assert_eq!(
            detect_workbook_source("/tmp/revenue.xlsm").unwrap(),
            WorkbookFormat::Xlsx
        );
    }

    #[test]
    fn derives_save_copy_paths_from_source_paths() {
        let csv_output = default_output_path("/tmp/revenue.csv");
        let csv_output_path = Path::new(&csv_output);
        assert_eq!(
            csv_output_path.file_name().and_then(|name| name.to_str()),
            Some("revenue.relay-copy.csv")
        );
        assert_eq!(csv_output_path.parent(), Some(Path::new("/tmp")));

        let workbook_output =
            WorkbookSource::new("/tmp/revenue.xlsx", WorkbookFormat::Xlsx).default_output_path();
        assert_eq!(
            workbook_output.file_name().and_then(|name| name.to_str()),
            Some("revenue.relay-copy.xlsx")
        );
        assert_eq!(workbook_output.parent(), Some(Path::new("/tmp")));
    }
}
