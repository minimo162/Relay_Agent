use std::fs::File;
use std::io::{self, Cursor};
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{read_zip_part, validate_zip_archive, AnchoredText, Deadline, OfficeLimits};

pub(crate) fn extract(
    path: &Path,
    limits: &OfficeLimits,
    deadline: &Deadline,
) -> io::Result<Vec<AnchoredText>> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?;
    validate_zip_archive(&mut archive, limits)?;
    let mut produced = 0u64;
    let mut slide_numbers = (0..archive.len())
        .filter_map(|i| {
            let name = archive.by_index(i).ok()?.name().to_string();
            slide_number(&name, "ppt/slides/slide", ".xml")
        })
        .collect::<Vec<_>>();
    slide_numbers.sort_unstable();
    slide_numbers.dedup();
    if slide_numbers.len() > limits.pptx_max_slides {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "pptx slides exceed RELAY_OFFICE_PPTX_MAX_SLIDES={}",
                limits.pptx_max_slides
            ),
        ));
    }

    let mut anchors = Vec::new();
    for slide in slide_numbers {
        deadline.check()?;
        let name = format!("ppt/slides/slide{slide}.xml");
        let bytes = read_zip_part(&mut archive, &name, limits, &mut produced)?;
        let text = parse_text_runs(&bytes, limits, deadline)?;
        if !text.trim().is_empty() {
            anchors.push(AnchoredText {
                anchor: format!("slide{slide}"),
                text,
            });
        }
        let notes_name = format!("ppt/notesSlides/notesSlide{slide}.xml");
        if archive.by_name(&notes_name).is_ok() {
            match read_zip_part(&mut archive, &notes_name, limits, &mut produced)
                .and_then(|bytes| parse_text_runs(&bytes, limits, deadline))
            {
                Ok(notes) if !notes.trim().is_empty() => anchors.push(AnchoredText {
                    anchor: format!("slide{slide}:notes"),
                    text: notes,
                }),
                Ok(_) | Err(_) => {}
            }
        }
    }
    Ok(anchors)
}

fn slide_number(name: &str, prefix: &str, suffix: &str) -> Option<u32> {
    name.strip_prefix(prefix)?
        .strip_suffix(suffix)?
        .parse::<u32>()
        .ok()
}

fn parse_text_runs(xml: &[u8], limits: &OfficeLimits, deadline: &Deadline) -> io::Result<String> {
    let mut reader = Reader::from_reader(Cursor::new(xml));
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut stack = Vec::<String>::new();
    let mut out = String::new();
    // Buffers text runs for the *current* `<a:p>` so multi-run paragraphs become a single
    // line in the output. Earlier code emitted a `\n` between every `<a:t>` event, which
    // shredded paragraphs whenever Office split a styled phrase across runs.
    let mut paragraph = String::new();
    let mut events = 0u64;
    loop {
        deadline.check()?;
        events += 1;
        if events > limits.xml_max_events {
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
                stack.push(local_name(event.name().as_ref()));
                if stack.len() > limits.xml_max_depth {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "xml depth exceeds RELAY_OFFICE_XML_MAX_DEPTH={}",
                            limits.xml_max_depth
                        ),
                    ));
                }
            }
            Event::Text(event) if stack.last().is_some_and(|name| name == "t") => {
                let text = event
                    .unescape()
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error.to_string()))?
                    .into_owned();
                paragraph.push_str(&text);
            }
            Event::End(event) => {
                let name = local_name(event.name().as_ref());
                if name == "p" {
                    let trimmed = paragraph.trim();
                    if !trimmed.is_empty() {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(trimmed);
                    }
                    paragraph.clear();
                }
                stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

fn local_name(name: &[u8]) -> String {
    let raw = std::str::from_utf8(name).unwrap_or_default();
    raw.rsplit(':').next().unwrap_or(raw).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn multi_run_paragraph_joins_into_single_line() {
        let xml = br#"
            <p:txBody xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
                <a:p>
                    <a:r><a:t>Quarterly </a:t></a:r>
                    <a:r><a:t>revenue </a:t></a:r>
                    <a:r><a:t>summary</a:t></a:r>
                </a:p>
                <a:p>
                    <a:r><a:t>Region details</a:t></a:r>
                </a:p>
            </p:txBody>
        "#;
        let limits = OfficeLimits::from_env();
        let deadline = Deadline::from_now(Duration::from_secs(5));

        let text = parse_text_runs(xml, &limits, &deadline).expect("parse runs");
        assert_eq!(text, "Quarterly revenue summary\nRegion details");
    }
}
