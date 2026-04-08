//! Merge and split PDFs using `lopdf`. See `docs/IMPLEMENTATION.md` for limits and caveats.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::PathBuf;

use lopdf::{Document, Object};

use crate::file_ops::{normalize_path, normalize_path_allow_missing};

/// Maximum number of input PDFs for a single `merge_pdfs` call.
pub const MAX_MERGE_INPUTS: usize = 32;
/// Maximum number of output segments for a single `split_pdf` call.
pub const MAX_SPLIT_SEGMENTS: usize = 16;
/// Maximum sum of page selections across all segments (each page counted per segment).
pub const MAX_SPLIT_PAGES_TOUCHED: usize = 64;
/// Reject merge/split when total input file size exceeds this (bytes).
pub const MAX_TOTAL_INPUT_BYTES: u64 = 200 * 1024 * 1024;

/// One output segment for [`split_pdf`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfSplitSegment {
    pub output_path: String,
    pub pages: String,
}

fn map_lopdf(err: lopdf::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, err)
}

fn ensure_not_encrypted(doc: &Document) -> io::Result<()> {
    if doc.trailer.get(b"Encrypt").is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "encrypted PDFs are not supported by pdf_merge/pdf_split in this version",
        ));
    }
    Ok(())
}

/// Parse a 1-based page list like `read_file` / `LiteParse`: `"1"`, `"1-3,5"` (comma-separated, ranges inclusive).
pub(crate) fn parse_pdf_pages_spec(spec: &str, max_page: u32) -> io::Result<BTreeSet<u32>> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pages string must not be empty",
        ));
    }
    let mut out = BTreeSet::new();
    for raw in spec.split(',') {
        let part = raw.trim();
        if part.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid empty segment in pages specification",
            ));
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: u32 = a.trim().parse().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("invalid page range start in {spec:?}"),
                )
            })?;
            let end: u32 = b.trim().parse().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("invalid page range end in {spec:?}"),
                )
            })?;
            if start == 0 || end == 0 || start > end {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("invalid page range {start}-{end}"),
                ));
            }
            if end > max_page {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("page range exceeds document (max page {max_page})"),
                ));
            }
            for p in start..=end {
                out.insert(p);
            }
        } else {
            let n: u32 = part.parse().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("invalid page number in {spec:?}"),
                )
            })?;
            if n == 0 || n > max_page {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("page {n} out of range (max {max_page})"),
                ));
            }
            out.insert(n);
        }
    }
    if out.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pages specification selected no pages",
        ));
    }
    Ok(out)
}

fn total_input_bytes(paths: &[PathBuf]) -> io::Result<u64> {
    let mut sum = 0u64;
    for p in paths {
        let m = fs::metadata(p)?;
        sum = sum.saturating_add(m.len());
        if sum > MAX_TOTAL_INPUT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("total input size exceeds limit of {MAX_TOTAL_INPUT_BYTES} bytes"),
            ));
        }
    }
    Ok(sum)
}

fn merge_load_input_documents(
    paths: &[PathBuf],
) -> io::Result<(
    BTreeMap<lopdf::ObjectId, Object>,
    BTreeMap<lopdf::ObjectId, Object>,
)> {
    let mut max_id = 1_u32;
    let mut documents_pages = BTreeMap::new();
    let mut documents_objects = BTreeMap::new();

    for path in paths {
        let mut doc = Document::load(path).map_err(map_lopdf)?;
        ensure_not_encrypted(&doc)?;

        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        let pages = doc.get_pages();
        pages
            .into_values()
            .map(|object_id| {
                let value = doc
                    .get_object(object_id)
                    .map_err(map_lopdf)?
                    .clone();
                Ok::<_, io::Error>((object_id, value))
            })
            .try_for_each(|res| {
                let (key, value) = res?;
                documents_pages.insert(key, value);
                Ok::<_, io::Error>(())
            })?;

        documents_objects.extend(doc.objects);
    }

    Ok((documents_pages, documents_objects))
}

fn merge_partition_catalog_and_pages(
    document: &mut Document,
    documents_objects: BTreeMap<lopdf::ObjectId, Object>,
) -> io::Result<(
    (lopdf::ObjectId, Object),
    (lopdf::ObjectId, Object),
)> {
    let mut catalog_object: Option<(lopdf::ObjectId, Object)> = None;
    let mut pages_object: Option<(lopdf::ObjectId, Object)> = None;

    for (object_id, object) in documents_objects {
        match object.type_name().unwrap_or(b"") {
            b"Catalog" => {
                catalog_object = Some((
                    if let Some((id, _)) = catalog_object {
                        id
                    } else {
                        object_id
                    },
                    object,
                ));
            }
            b"Pages" => {
                if let Ok(dictionary) = object.as_dict() {
                    let mut dictionary = dictionary.clone();
                    if let Some((_, ref prev_pages)) = pages_object {
                        if let Ok(old_dictionary) = prev_pages.as_dict() {
                            dictionary.extend(old_dictionary);
                        }
                    }
                    pages_object = Some((
                        if let Some((id, _)) = pages_object {
                            id
                        } else {
                            object_id
                        },
                        Object::Dictionary(dictionary),
                    ));
                }
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                document.objects.insert(object_id, object);
            }
        }
    }

    let pages_root = pages_object.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "merged PDFs: Pages root not found",
        )
    })?;
    let catalog_root = catalog_object.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "merged PDFs: Catalog root not found",
        )
    })?;
    Ok((pages_root, catalog_root))
}

/// Concatenate PDFs in order into `output_path`. Inputs must exist; parent dirs for output are created.
///
/// Follows the merge approach described in the `lopdf` crate examples (object renumbering, page collection,
/// rebuilt catalog/pages). Encrypted inputs are rejected. See [lopdf merge caveats](https://github.com/J-F-Liu/lopdf/issues/424).
pub fn merge_pdfs(output_path: &str, input_paths: &[String]) -> io::Result<PathBuf> {
    if input_paths.len() < 2 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pdf_merge requires at least two input PDFs",
        ));
    }
    if input_paths.len() > MAX_MERGE_INPUTS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("pdf_merge supports at most {MAX_MERGE_INPUTS} input files"),
        ));
    }

    let mut resolved_inputs = Vec::with_capacity(input_paths.len());
    for s in input_paths {
        resolved_inputs.push(normalize_path(s)?);
    }

    total_input_bytes(&resolved_inputs)?;

    let out = normalize_path_allow_missing(output_path)?;
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut document = Document::with_version("1.5");
    let (documents_pages, documents_objects) = merge_load_input_documents(&resolved_inputs)?;
    let ((page_id, pages_root_obj), (catalog_id, catalog_object)) =
        merge_partition_catalog_and_pages(&mut document, documents_objects)?;

    for (object_id, object) in &documents_pages {
        if let Ok(dictionary) = object.as_dict() {
            let mut dictionary = dictionary.clone();
            dictionary.set("Parent", page_id);
            document
                .objects
                .insert(*object_id, Object::Dictionary(dictionary));
        }
    }

    if let Ok(dictionary) = pages_root_obj.as_dict() {
        let mut dictionary = dictionary.clone();
        let page_count = u32::try_from(documents_pages.len()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "merged PDF: page count does not fit in u32",
            )
        })?;
        dictionary.set("Count", page_count);
        dictionary.set(
            "Kids",
            documents_pages
                .keys()
                .copied()
                .map(Object::Reference)
                .collect::<Vec<_>>(),
        );
        document
            .objects
            .insert(page_id, Object::Dictionary(dictionary));
    }

    if let Ok(dictionary) = catalog_object.as_dict() {
        let mut dictionary = dictionary.clone();
        dictionary.set("Pages", page_id);
        dictionary.remove(b"Outlines");
        document
            .objects
            .insert(catalog_id, Object::Dictionary(dictionary));
    }

    document.trailer.set("Root", catalog_id);
    document.max_id = u32::try_from(document.objects.len()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "merged PDF: object count does not fit in u32",
        )
    })?;
    document.renumber_objects();
    document.compress();

    document.save(&out)?;
    Ok(out)
}

/// Write one PDF per segment; each `pages` string uses the same 1-based grammar as `read_file` for PDFs.
pub fn split_pdf(input_path: &str, segments: &[PdfSplitSegment]) -> io::Result<Vec<PathBuf>> {
    if segments.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "pdf_split requires at least one segment",
        ));
    }
    if segments.len() > MAX_SPLIT_SEGMENTS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("pdf_split supports at most {MAX_SPLIT_SEGMENTS} segments"),
        ));
    }

    let mut outs_normalized = Vec::new();
    let mut seen = BTreeSet::new();
    for seg in segments {
        let p = normalize_path_allow_missing(&seg.output_path)?;
        if !seen.insert(p.clone()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "duplicate output_path in pdf_split segments",
            ));
        }
        outs_normalized.push(p);
    }

    let input = normalize_path(input_path)?;
    total_input_bytes(std::slice::from_ref(&input))?;

    let mut pages_touched: usize = 0;
    for seg in segments {
        let doc = Document::load(&input).map_err(map_lopdf)?;
        ensure_not_encrypted(&doc)?;
        let max_page = u32::try_from(doc.get_pages().len()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "input PDF: page count does not fit in u32",
            )
        })?;
        if max_page == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "input PDF has no pages",
            ));
        }
        let wanted = parse_pdf_pages_spec(&seg.pages, max_page)?;
        pages_touched = pages_touched.saturating_add(wanted.len());
        if pages_touched > MAX_SPLIT_PAGES_TOUCHED {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "pdf_split: at most {MAX_SPLIT_PAGES_TOUCHED} page selections total across segments"
                ),
            ));
        }
    }

    let mut written = Vec::new();
    for (seg, out) in segments.iter().zip(outs_normalized.iter()) {
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut doc = Document::load(&input).map_err(map_lopdf)?;
        ensure_not_encrypted(&doc)?;
        let max_page = u32::try_from(doc.get_pages().len()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "input PDF: page count does not fit in u32",
            )
        })?;
        let wanted = parse_pdf_pages_spec(&seg.pages, max_page)?;
        let to_delete: Vec<u32> = (1..=max_page).filter(|p| !wanted.contains(p)).collect();
        doc.delete_pages(&to_delete);
        let _removed = doc.prune_objects();
        doc.renumber_objects();
        doc.compress();
        doc.save(out)?;
        written.push(out.clone());
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Object, Stream};

    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("relay-pdf-manip-{name}-{unique}"))
    }

    fn minimal_pdf(label: &str) -> Document {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! {
                "F1" => font_id,
            },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 48.into()]),
                Operation::new("Td", vec![100.into(), 600.into()]),
                Operation::new("Tj", vec![Object::string_literal(label)]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().expect("encode content"),
        ));
        let page_object_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_object_id.into()],
            "Count" => 1,
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc
    }

    #[test]
    fn merge_two_one_page_pdfs() {
        let dir = temp_dir("merge");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let a = dir.join("a.pdf");
        let b = dir.join("b.pdf");
        let out = dir.join("merged.pdf");
        minimal_pdf("A").save(&a).expect("save a");
        minimal_pdf("B").save(&b).expect("save b");

        let paths = vec![
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        ];
        let got = merge_pdfs(out.to_str().unwrap(), &paths).expect("merge");
        assert_eq!(got, out);
        assert!(out.is_file());

        let merged = Document::load(&out).expect("load merged");
        assert_eq!(merged.get_pages().len(), 2);
    }

    #[test]
    fn split_two_page_doc() {
        let dir = temp_dir("split");
        std::fs::create_dir_all(&dir).expect("mkdir");
        let src = dir.join("src.pdf");
        let out1 = dir.join("p1.pdf");
        let out2 = dir.join("p2.pdf");

        let p1 = dir.join("t1.pdf");
        let p2 = dir.join("t2.pdf");
        minimal_pdf("P1").save(&p1).expect("t1");
        minimal_pdf("P2").save(&p2).expect("t2");
        merge_pdfs(
            src.to_str().unwrap(),
            &[
                p1.to_string_lossy().into_owned(),
                p2.to_string_lossy().into_owned(),
            ],
        )
        .expect("build two-page");

        split_pdf(
            src.to_str().unwrap(),
            &[
                PdfSplitSegment {
                    output_path: out1.to_string_lossy().into_owned(),
                    pages: "1".into(),
                },
                PdfSplitSegment {
                    output_path: out2.to_string_lossy().into_owned(),
                    pages: "2".into(),
                },
            ],
        )
        .expect("split");

        assert!(out1.is_file());
        assert!(out2.is_file());
        let d1 = Document::load(&out1).expect("load out1");
        let d2 = Document::load(&out2).expect("load out2");
        assert_eq!(d1.get_pages().len(), 1);
        assert_eq!(d2.get_pages().len(), 1);
    }

    #[test]
    fn parse_pages_spec_comma_and_range() {
        let s = parse_pdf_pages_spec("1-2,4", 5).expect("parse");
        assert_eq!(s, BTreeSet::from([1, 2, 4]));
    }
}
