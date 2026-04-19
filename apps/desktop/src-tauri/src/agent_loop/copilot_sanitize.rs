/// Remove M365 Copilot bracketed markers such as `【richwebanswer-…】` from visible prose.
fn strip_richwebanswer_spans(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '【' {
            out.push(c);
            continue;
        }
        let mut inner = String::new();
        inner.push(c);
        let mut closed = false;
        for c2 in chars.by_ref() {
            inner.push(c2);
            if c2 == '】' {
                closed = true;
                break;
            }
        }
        if closed && inner.contains("richwebanswer") {
            continue;
        }
        out.push_str(&inner);
    }
    out
}

fn strip_transient_copilot_status_fragments(s: &str) -> String {
    let mut cleaned = s.to_string();
    for marker in ["Loading image", "Image has been generated"] {
        cleaned = cleaned.replace(marker, "\n");
    }
    cleaned
}

fn dedupe_consecutive_lines(s: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut prev_nonempty: Option<String> = None;
    for line in s.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push(String::new());
            prev_nonempty = None;
            continue;
        }
        if prev_nonempty.as_deref() == Some(trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
        prev_nonempty = Some(trimmed.to_string());
    }
    out.join("\n")
}

/// Drop consecutive duplicate paragraphs (Copilot sometimes pastes the same block many times).
fn dedupe_consecutive_paragraphs(s: &str) -> String {
    let parts: Vec<&str> = s.split("\n\n").collect();
    let mut out: Vec<String> = Vec::new();
    for p in parts {
        let t = p.trim();
        if t.is_empty() {
            continue;
        }
        if out.last().is_some_and(|prev| prev.as_str() == t) {
            continue;
        }
        out.push(t.to_string());
    }
    out.join("\n\n")
}

/// Normalize Copilot assistant-visible text before persisting and before UI emission.
pub(crate) fn sanitize_copilot_visible_text(s: &str) -> String {
    let s = strip_richwebanswer_spans(s);
    let s = strip_transient_copilot_status_fragments(&s);
    let s = dedupe_consecutive_lines(&s);
    dedupe_consecutive_paragraphs(&s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_richwebanswer_markers() {
        let raw = "Hello 【richwebanswer-ac461e】 world";
        let s = sanitize_copilot_visible_text(raw);
        assert!(!s.to_lowercase().contains("richwebanswer"));
        assert!(s.contains("Hello"));
        assert!(s.contains("world"));
    }

    #[test]
    fn sanitize_dedupes_consecutive_paragraphs() {
        let raw = "A\n\nB\n\nB\n\nB\n\nC";
        let s = sanitize_copilot_visible_text(raw);
        assert_eq!(s, "A\n\nB\n\nC");
    }

    #[test]
    fn sanitize_strips_transient_image_status_lines() {
        let raw = "Loading image\nImage has been generated\nFinal answer";
        let s = sanitize_copilot_visible_text(raw);
        assert_eq!(s, "Final answer");
    }

    #[test]
    fn sanitize_dedupes_consecutive_lines_after_status_removal() {
        let raw = "了解しました。\nLoading image\n了解しました。\nFinal answer";
        let s = sanitize_copilot_visible_text(raw);
        assert_eq!(s, "了解しました。\n\n了解しました。\nFinal answer");
    }
}
