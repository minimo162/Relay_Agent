use std::{fs::File, io::BufReader, path::Path};

use calamine::{open_workbook_auto, Error, Sheets};

#[derive(Debug, Default, Clone, Copy)]
pub struct XlsxBackend;

impl XlsxBackend {
    pub fn open(path: impl AsRef<Path>) -> Result<Sheets<BufReader<File>>, Error> {
        open_workbook_auto(path)
    }
}
