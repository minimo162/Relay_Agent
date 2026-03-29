use csv::{ReaderBuilder, WriterBuilder};

#[derive(Clone, Debug)]
pub struct CsvBackend {
    has_headers: bool,
    flexible: bool,
}

impl Default for CsvBackend {
    fn default() -> Self {
        Self {
            has_headers: true,
            flexible: false,
        }
    }
}

impl CsvBackend {
    pub fn reader_builder(&self) -> ReaderBuilder {
        let mut builder = ReaderBuilder::new();
        builder.has_headers(self.has_headers);
        builder.flexible(self.flexible);
        builder
    }

    pub fn writer_builder(&self) -> WriterBuilder {
        let mut builder = WriterBuilder::new();
        builder.has_headers(self.has_headers);
        builder
    }
}
