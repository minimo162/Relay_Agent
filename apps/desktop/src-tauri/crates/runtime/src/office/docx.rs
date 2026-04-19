use std::fs::File;
use std::io::{self, Cursor};
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{read_zip_part, AnchoredText, Deadline, OfficeLimits};

pub(crate) fn extract(
    path: &Path,
    limits: &OfficeLimits,
    deadline: &Deadline,
) -> io::Result<Vec<AnchoredText>> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    let mut produced = 0u64;
    let mut anchors = Vec::new();
    let document = read_zip_part(&mut archive, "word/document.xml", limits, &mut produced)?;
    anchors.extend(parse_part(&document, "", limits, deadline)?);

    let mut names = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|file| file.name().to_string()))
        .collect::<Vec<_>>();
    names.sort();
    for name in names {
        if is_docx_header_footer(&name) {
            let bytes = read_zip_part(&mut archive, &name, limits, &mut produced)?;
            let prefix = part_prefix(&name);
            anchors.extend(parse_part(&bytes, &prefix, limits, deadline)?);
        }
    }
    Ok(anchors)
}

#[allow(clippy::case_sensitive_file_extension_comparisons)]
fn is_docx_header_footer(name: &str) -> bool {
    // OPC part names are case-sensitive; differently cased names are not the same part.
    (name.starts_with("word/header") || name.starts_with("word/footer"))
        && name.ends_with(".xml")
}

fn part_prefix(name: &str) -> String {
    let filename = name.rsplit('/').next().unwrap_or(name);
    let stem = filename.trim_end_matches(".xml");
    if let Some(number) = stem.strip_prefix("header") {
        format!("header{number}:")
    } else if let Some(number) = stem.strip_prefix("footer") {
        format!("footer{number}:")
    } else {
        String::new()
    }
}

#[derive(Default)]
struct ParseState {
    stack: Vec<String>,
    body_para_count: usize,
    table_count: usize,
    row_count: usize,
    in_deleted: usize,
    para_anchor: Option<String>,
    para_text: String,
    row_anchor: Option<String>,
    row_text: String,
    in_row_cell_count: usize,
    anchors: Vec<AnchoredText>,
    events: u64,
}

#[allow(clippy::too_many_lines)]
fn parse_part(
    xml: &[u8],
    part_prefix: &str,
    limits: &OfficeLimits,
    deadline: &Deadline,
) -> io::Result<Vec<AnchoredText>> {
    let mut reader = Reader::from_reader(Cursor::new(xml));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut state = ParseState::default();

    loop {
        deadline.check()?;
        state.events += 1;
        if state.events > limits.xml_max_events {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "xml events exceed RELAY_OFFICE_XML_MAX_EVENTS={}",
                    limits.xml_max_events
                ),
            ));
        }
        match reader
            .read_event_into(&mut buf)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?
        {
            Event::Start(event) => {
                let name = local_name(event.name().as_ref());
                state.stack.push(name.clone());
                if state.stack.len() > limits.xml_max_depth {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "xml depth exceeds RELAY_OFFICE_XML_MAX_DEPTH={}",
                            limits.xml_max_depth
                        ),
                    ));
                }
                match name.as_str() {
                    "del" => state.in_deleted += 1,
                    "tbl" => {
                        state.table_count += 1;
                    }
                    "tr" if inside_table(&state.stack) => {
                        state.row_count += 1;
                        state.in_row_cell_count = 0;
                        state.row_text.clear();
                        let table = state.table_count;
                        let row = state.row_count;
                        let anchor = if part_prefix.is_empty() {
                            format!("p{}:tbl{table}:row{row}", state.body_para_count)
                        } else {
                            format!(
                                "{}:tbl{table}:row{row}",
                                part_prefix.trim_end_matches(':')
                            )
                        };
                        state.row_anchor = Some(anchor);
                    }
                    "tc" if state.row_anchor.is_some() => {
                        if state.in_row_cell_count > 0 && !state.row_text.ends_with('\t') {
                            state.row_text.push('\t');
                        }
                        state.in_row_cell_count += 1;
                    }
                    "p" if is_body_paragraph(&state.stack) => {
                        state.body_para_count += 1;
                        if state.body_para_count > limits.docx_max_paragraphs {
                            return Err(io::Error::new(
                                io::ErrorKind::InvalidData,
                                format!(
                                    "docx paragraphs exceed RELAY_OFFICE_DOCX_MAX_PARAGRAPHS={}",
                                    limits.docx_max_paragraphs
                                ),
                            ));
                        }
                        state.para_text.clear();
                        state.para_anchor =
                            Some(format!("{part_prefix}p{}", state.body_para_count));
                    }
                    _ => {}
                }
            }
            Event::Text(event) => {
                if state.in_deleted == 0 && is_text_node(&state.stack) {
                    let text = event
                        .unescape()
                        .map_err(|error| {
                            io::Error::new(io::ErrorKind::InvalidData, error.to_string())
                        })?
                        .into_owned();
                    if state.row_anchor.is_some() {
                        state.row_text.push_str(&text);
                    } else if state.para_anchor.is_some() {
                        state.para_text.push_str(&text);
                    }
                }
            }
            Event::End(event) => {
                let name = local_name(event.name().as_ref());
                match name.as_str() {
                    "del" => state.in_deleted = state.in_deleted.saturating_sub(1),
                    "tr" => {
                        if let Some(anchor) = state.row_anchor.take() {
                            let text = state.row_text.trim().to_string();
                            if !text.is_empty() {
                                state.anchors.push(AnchoredText { anchor, text });
                            }
                            state.row_text.clear();
                        }
                    }
                    "p" => {
                        if let Some(anchor) = state.para_anchor.take() {
                            let text = state.para_text.trim().to_string();
                            if !text.is_empty() {
                                state.anchors.push(AnchoredText { anchor, text });
                            }
                            state.para_text.clear();
                        }
                    }
                    _ => {}
                }
                state.stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(state.anchors)
}

fn local_name(name: &[u8]) -> String {
    let raw = std::str::from_utf8(name).unwrap_or_default();
    raw.rsplit(':').next().unwrap_or(raw).to_string()
}

fn is_text_node(stack: &[String]) -> bool {
    stack.last().is_some_and(|name| name == "t")
}

fn inside_table(stack: &[String]) -> bool {
    stack.iter().any(|name| name == "tbl")
}

fn is_body_paragraph(stack: &[String]) -> bool {
    if stack.last().map(String::as_str) != Some("p") {
        return false;
    }
    if stack.iter().any(|name| matches!(name.as_str(), "tbl" | "tr" | "tc")) {
        return false;
    }
    let parent = stack
        .iter()
        .rev()
        .nth(1)
        .map(String::as_str)
        .unwrap_or_default();
    matches!(parent, "body" | "sdt" | "sdtContent" | "hdr" | "ftr")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn header_table_anchor_keeps_region_separator() {
        let xml = br#"
            <w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:tbl>
                    <w:tr>
                        <w:tc><w:p><w:r><w:t>Header cell</w:t></w:r></w:p></w:tc>
                    </w:tr>
                </w:tbl>
            </w:hdr>
        "#;
        let limits = OfficeLimits::from_env();
        let deadline = Deadline::from_now(Duration::from_secs(5));

        let anchors = parse_part(xml, "header1:", &limits, &deadline).expect("parse header table");

        assert_eq!(anchors.len(), 1);
        assert_eq!(anchors[0].anchor, "header1:tbl1:row1");
        assert_eq!(anchors[0].text, "Header cell");
    }
}
