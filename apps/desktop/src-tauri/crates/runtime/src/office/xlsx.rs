use std::io::{self, Cursor, Read};
use std::path::Path;

use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};

use super::{validate_zip_entry, AnchoredText, Deadline, OfficeLimits};

pub(crate) fn extract(
    path: &Path,
    limits: &OfficeLimits,
    deadline: &Deadline,
) -> io::Result<Vec<AnchoredText>> {
    let snapshot = read_snapshot(path, limits.xlsx_archive_max_bytes)?;
    preflight(&snapshot, limits, deadline)?;
    let cursor = Cursor::new(snapshot);
    let mut workbook: Xlsx<Cursor<Vec<u8>>> =
        open_workbook_from_rs::<Xlsx<Cursor<Vec<u8>>>, _>(cursor)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    let mut anchors = Vec::new();
    let mut cell_count = 0usize;
    let sheet_names = workbook.sheet_names().clone();
    for sheet_name in sheet_names {
        deadline.check()?;
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
        for (row_idx, row) in range.rows().enumerate() {
            if row_idx % 1_000 == 0 {
                deadline.check()?;
            }
            for (col_idx, cell) in row.iter().enumerate() {
                let text = cell_to_string(cell);
                if text.is_empty() {
                    continue;
                }
                cell_count += 1;
                if cell_count > limits.xlsx_max_cells {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "xlsx cells exceed RELAY_OFFICE_XLSX_MAX_CELLS={}",
                            limits.xlsx_max_cells
                        ),
                    ));
                }
                anchors.push(AnchoredText {
                    anchor: format!("{}!{}", sheet_name, a1(row_idx, col_idx)),
                    text,
                });
            }
        }
    }
    Ok(anchors)
}

#[cfg(windows)]
fn open_snapshot_file(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
}

#[cfg(not(windows))]
fn open_snapshot_file(path: &Path) -> io::Result<std::fs::File> {
    std::fs::OpenOptions::new().read(true).open(path)
}

fn read_snapshot(path: &Path, cap: usize) -> io::Result<Vec<u8>> {
    let mut file = open_snapshot_file(path)?;
    let mut buf = Vec::new();
    file.by_ref().take(cap as u64 + 1).read_to_end(&mut buf)?;
    if buf.len() > cap {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("xlsx archive exceeds RELAY_OFFICE_XLSX_ARCHIVE_MAX_BYTES={cap}"),
        ));
    }
    Ok(buf)
}

fn preflight(snapshot: &[u8], limits: &OfficeLimits, deadline: &Deadline) -> io::Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(snapshot))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    if archive.len() > limits.zip_max_entries {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "zip entries exceed RELAY_OFFICE_ZIP_MAX_ENTRIES={}",
                limits.zip_max_entries
            ),
        ));
    }
    // Single sweep validates each entry and bounds decompressed bytes per part.
    // The previous implementation also called `validate_zip_archive`, which walked
    // the same entries again — pure duplicate work.
    let mut produced = 0u64;
    for i in 0..archive.len() {
        deadline.check()?;
        let mut file = archive
            .by_index(i)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
        let name = file.name().to_string();
        validate_zip_entry(&name, file.size(), file.compressed_size(), limits)?;
        let mut bytes = 0u64;
        let mut buf = [0u8; 16 * 1024];
        loop {
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            produced += n as u64;
            bytes += n as u64;
            if produced > limits.zip_max_expanded_bytes {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "zip expanded bytes exceed RELAY_OFFICE_ZIP_MAX_EXPANDED_BYTES={}",
                        limits.zip_max_expanded_bytes
                    ),
                ));
            }
            if name == "xl/sharedStrings.xml" && bytes > limits.xlsx_shared_strings_max_bytes {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "sharedStrings exceeds RELAY_OFFICE_XLSX_SHARED_STRINGS_MAX_BYTES={}",
                        limits.xlsx_shared_strings_max_bytes
                    ),
                ));
            }
            // OPC part names are case-sensitive; differently cased names are not worksheet parts.
            #[allow(clippy::case_sensitive_file_extension_comparisons)]
            let is_worksheet_xml =
                name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml");
            if is_worksheet_xml && bytes > limits.xlsx_sheet_xml_max_bytes {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "worksheet XML exceeds RELAY_OFFICE_XLSX_SHEET_XML_MAX_BYTES={}",
                        limits.xlsx_sheet_xml_max_bytes
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) | Data::DateTimeIso(value) | Data::DurationIso(value) => value.clone(),
        Data::Float(value) => value.to_string(),
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::Error(value) => format!("{value:?}"),
        // ExcelDateTime's Display impl writes the raw 1900-epoch f64 (e.g. `45000.5`),
        // which is useless for plaintext search. Render an ISO 8601 string instead so
        // queries like `2026-04-20` actually hit calendar cells.
        Data::DateTime(value) => value.as_datetime().map_or_else(
            || value.to_string(),
            |dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string(),
        ),
    }
}

fn a1(row: usize, col: usize) -> String {
    let mut n = col + 1;
    let mut letters = Vec::new();
    while n > 0 {
        let rem = (n - 1) % 26;
        let rem = u8::try_from(rem).expect("column remainder is always < 26");
        letters.push((b'A' + rem) as char);
        n = (n - 1) / 26;
    }
    letters.iter().rev().collect::<String>() + &(row + 1).to_string()
}
