use std::collections::HashSet;

use serde_json::Value;

const MAX_INLINE_TOOL_OBJECT_LEN_BYTES: usize = 1_048_576;
pub(crate) const FALLBACK_TOOL_SENTINEL_KEY: &str = "relay_tool_call";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FallbackSentinelPolicy {
    Enforce,
    ObserveOnly,
}

pub(crate) fn fallback_sentinel_policy() -> FallbackSentinelPolicy {
    match std::env::var("RELAY_FALLBACK_SENTINEL_POLICY")
        .ok()
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("observe" | "warn" | "compat") => FallbackSentinelPolicy::ObserveOnly,
        _ => FallbackSentinelPolicy::Enforce,
    }
}

pub(crate) fn has_inline_whitelisted_tool_candidate<F>(
    text: &str,
    whitelist: &HashSet<String>,
    parse_one_valid: F,
) -> bool
where
    F: Fn(&Value) -> bool + Copy,
{
    !extract_mvp_tool_object_spans(text, whitelist, parse_one_valid).is_empty()
}

pub(crate) fn parse_fallback_payloads<T, F>(
    payloads: &[String],
    whitelist: &HashSet<String>,
    sentinel_policy: FallbackSentinelPolicy,
    source_label: &str,
    parse_one: F,
) -> Vec<T>
where
    F: Fn(&Value) -> Option<T> + Copy,
{
    let mut out = Vec::new();
    for payload in payloads {
        let v: Value = match serde_json::from_str(payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("[CdpApiClient] skip invalid fallback JSON: {e}");
                continue;
            }
        };
        parse_fallback_value(
            &v,
            whitelist,
            sentinel_policy,
            source_label,
            parse_one,
            &mut out,
        );
    }
    out
}

fn parse_fallback_value<T, F>(
    v: &Value,
    whitelist: &HashSet<String>,
    sentinel_policy: FallbackSentinelPolicy,
    source_label: &str,
    parse_one: F,
    out: &mut Vec<T>,
) where
    F: Fn(&Value) -> Option<T> + Copy,
{
    match v {
        Value::Array(arr) => {
            for item in arr {
                parse_fallback_value(
                    item,
                    whitelist,
                    sentinel_policy,
                    source_label,
                    parse_one,
                    out,
                );
            }
        }
        Value::Object(obj) => {
            let Some(name) = obj.get("name").and_then(Value::as_str) else {
                return;
            };
            if !whitelist.contains(name) {
                tracing::debug!(
                    name = %name,
                    "[CdpApiClient] skipped fallback tool call: not in MVP catalog"
                );
                return;
            }
            let has_sentinel = obj
                .get(FALLBACK_TOOL_SENTINEL_KEY)
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !has_sentinel {
                tracing::warn!(
                    name = %name,
                    policy = ?sentinel_policy,
                    source = %source_label,
                    "[CdpApiClient] fallback tool candidate missing `{}` sentinel key",
                    FALLBACK_TOOL_SENTINEL_KEY
                );
                if sentinel_policy == FallbackSentinelPolicy::Enforce {
                    return;
                }
            }
            if let Some(call) = parse_one(v) {
                out.push(call);
            }
        }
        _ => tracing::warn!("[CdpApiClient] fallback JSON must be object or array"),
    }
}

pub(crate) fn canonicalize_json_fence_tool_payload<F>(
    value: &Value,
    whitelist: &HashSet<String>,
    parse_one_valid: F,
) -> Option<Value>
where
    F: Fn(&Value) -> bool + Copy,
{
    match value {
        Value::Array(items) => {
            let normalized = items
                .iter()
                .map(|item| canonicalize_json_fence_tool_payload(item, whitelist, parse_one_valid))
                .collect::<Option<Vec<_>>>()?;
            Some(Value::Array(normalized))
        }
        Value::Object(obj) => {
            let name = obj.get("name").and_then(Value::as_str)?;
            if !whitelist.contains(name) {
                return None;
            }
            if !obj.get("input").is_none_or(Value::is_object) {
                return None;
            }
            let mut normalized = obj.clone();
            normalized.insert(FALLBACK_TOOL_SENTINEL_KEY.to_string(), Value::Bool(true));
            let value = Value::Object(normalized);
            parse_one_valid(&value).then_some(value)
        }
        _ => None,
    }
}

pub(crate) fn cdp_json_fence_whitelist() -> HashSet<String> {
    tools::cdp_tool_specs_for_visibility(tools::CdpToolVisibility::Core)
        .into_iter()
        .chain(tools::cdp_tool_specs_for_visibility(
            tools::CdpToolVisibility::Conditional,
        ))
        .map(|spec| spec.name.to_string())
        .collect()
}

pub(crate) fn find_generic_markdown_fence_inner_end(body: &str) -> Option<usize> {
    if let Some(i) = body.find("\n```") {
        return Some(i);
    }
    if body.starts_with("```") {
        return Some(0);
    }
    body.rfind("```")
}

pub(crate) fn extract_fallback_markdown_fences<F>(
    text: &str,
    whitelist: &HashSet<String>,
    parse_one_valid: F,
) -> (String, Vec<String>)
where
    F: Fn(&Value) -> bool + Copy,
{
    const OPEN: &str = "```";
    let json_fence_whitelist = cdp_json_fence_whitelist();
    let mut display = String::new();
    let mut payloads = Vec::new();
    let mut rest = text;

    while let Some(idx) = rest.find(OPEN) {
        display.push_str(&rest[..idx]);
        let after_ticks = &rest[idx + OPEN.len()..];

        let (info, body_start) = match after_ticks.find('\n') {
            Some(nl) => {
                let fl = after_ticks[..nl].trim();
                if fl.starts_with('{') {
                    ("", 0usize)
                } else {
                    (fl, nl + 1)
                }
            }
            None => {
                if after_ticks.starts_with('{') {
                    ("", 0usize)
                } else {
                    display.push_str(OPEN);
                    display.push_str(after_ticks);
                    rest = "";
                    break;
                }
            }
        };

        let body_region = &after_ticks[body_start..];
        let Some(inner_end) = find_generic_markdown_fence_inner_end(body_region) else {
            display.push_str(OPEN);
            display.push_str(after_ticks);
            rest = "";
            break;
        };
        let inner = body_region[..inner_end].trim();
        let after_inner = &body_region[inner_end..];
        let rest_after_fence = if let Some(tail) = after_inner.strip_prefix("\n```") {
            tail
        } else if let Some(tail) = after_inner.strip_prefix("\r\n```") {
            tail
        } else if let Some(tail) = after_inner.strip_prefix("```") {
            tail
        } else {
            display.push_str(OPEN);
            display.push_str(after_ticks);
            rest = "";
            break;
        };
        let rest_after_fence = rest_after_fence
            .strip_prefix('\n')
            .or_else(|| rest_after_fence.strip_prefix("\r\n"))
            .unwrap_or(rest_after_fence);

        if info == "relay_tool" {
            rest = rest_after_fence;
            continue;
        }

        if !inner.is_empty() {
            if info.eq_ignore_ascii_case("json") {
                if let Ok(value) = serde_json::from_str::<Value>(inner) {
                    if let Some(normalized) = canonicalize_json_fence_tool_payload(
                        &value,
                        &json_fence_whitelist,
                        parse_one_valid,
                    ) {
                        payloads.push(
                            serde_json::to_string(&normalized)
                                .unwrap_or_else(|_| inner.to_string()),
                        );
                    } else {
                        payloads.push(inner.to_string());
                    }
                } else if inner.contains(FALLBACK_TOOL_SENTINEL_KEY) {
                    for (_, _, p) in
                        extract_mvp_tool_object_spans(inner, whitelist, parse_one_valid)
                    {
                        payloads.push(p);
                    }
                }
            } else if serde_json::from_str::<Value>(inner).is_ok() {
                payloads.push(inner.to_string());
            } else {
                for (_, _, p) in extract_mvp_tool_object_spans(inner, whitelist, parse_one_valid) {
                    payloads.push(p);
                }
            }
        }

        rest = rest_after_fence;
    }
    display.push_str(rest);
    (display, payloads)
}

pub(crate) fn extract_unfenced_tool_json_candidates<F>(
    text: &str,
    whitelist: &HashSet<String>,
    parse_one_valid: F,
) -> (String, Vec<String>)
where
    F: Fn(&Value) -> bool + Copy,
{
    let spans = extract_mvp_tool_object_spans(text, whitelist, parse_one_valid);
    let mut ranges = Vec::with_capacity(spans.len());
    let mut payloads = Vec::with_capacity(spans.len());
    for (a, b, p) in spans {
        ranges.push((a, b));
        payloads.push(p);
    }

    ranges.sort_by_key(|(a, _)| *a);
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, b) in ranges {
        if let Some(last) = merged.last_mut() {
            if a <= last.1 {
                last.1 = last.1.max(b);
                continue;
            }
        }
        merged.push((a, b));
    }

    let mut display = String::with_capacity(text.len());
    let mut cursor = 0usize;
    for (a, b) in merged {
        if a > cursor {
            display.push_str(&text[cursor..a]);
        }
        cursor = b;
    }
    display.push_str(&text[cursor..]);
    (display, payloads)
}

fn skip_json_whitespace(s: &str, mut i: usize) -> usize {
    let bytes = s.as_bytes();
    while i < bytes.len() && matches!(bytes[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

fn brace_open_followed_by_name_key(s: &str, brace_idx: usize) -> bool {
    let bytes = s.as_bytes();
    if brace_idx >= bytes.len() || bytes[brace_idx] != b'{' {
        return false;
    }
    let after = skip_json_whitespace(s, brace_idx + 1);
    s.get(after..).is_some_and(|t| t.starts_with("\"name\""))
}

fn extract_mvp_tool_object_spans<F>(
    text: &str,
    whitelist: &HashSet<String>,
    parse_one_valid: F,
) -> Vec<(usize, usize, String)>
where
    F: Fn(&Value) -> bool + Copy,
{
    const MAX_MATCHES: usize = 12;
    let mut out = Vec::new();
    let mut search_start = 0usize;

    while search_start < text.len() && out.len() < MAX_MATCHES {
        let Some(rel) = text[search_start..].find('{') else {
            break;
        };
        let abs = search_start + rel;
        if !brace_open_followed_by_name_key(text, abs) {
            search_start = abs + 1;
            continue;
        }
        let sub = if let Some(sub) = extract_balanced_json_object(text, abs) {
            sub.to_string()
        } else if let Some(repaired) = text.get(abs..).and_then(autoclose_unbalanced_json_payload) {
            repaired
        } else {
            search_start = abs + 1;
            continue;
        };
        if sub.len() > MAX_INLINE_TOOL_OBJECT_LEN_BYTES {
            tracing::warn!(
                "[CdpApiClient] skip oversized inline tool-shaped JSON candidate (len={}, max={})",
                sub.len(),
                MAX_INLINE_TOOL_OBJECT_LEN_BYTES
            );
            search_start = abs + 1;
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&sub) else {
            search_start = abs + 1;
            continue;
        };
        let Some(obj) = v.as_object() else {
            search_start = abs + 1;
            continue;
        };
        let Some(name) = obj.get("name").and_then(|x| x.as_str()) else {
            search_start = abs + 1;
            continue;
        };
        if !whitelist.contains(name) {
            search_start = abs + 1;
            continue;
        }
        if !obj.get("input").is_none_or(Value::is_object) {
            search_start = abs + 1;
            continue;
        }
        if !parse_one_valid(&v) {
            search_start = abs + 1;
            continue;
        }
        let end = abs.saturating_add(sub.len()).min(text.len());
        out.push((abs, end, sub));
        search_start = end;
    }
    out
}

fn extract_balanced_json_object(s: &str, start: usize) -> Option<&str> {
    let slice = s.get(start..)?;
    if !slice.starts_with('{') {
        return None;
    }
    let mut depth = 0u32;
    let mut in_str = false;
    let mut escape = false;
    for (i, ch) in slice.char_indices() {
        if in_str {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&slice[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

fn autoclose_unbalanced_json_payload(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    if bytes.first().copied() != Some(b'{') {
        return None;
    }
    let mut depth = 0u32;
    let mut in_str = false;
    let mut escape = false;
    let mut end = 0usize;

    for (i, ch) in s.char_indices() {
        end = i + ch.len_utf8();
        if in_str {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(s[..end].to_string());
                }
            }
            _ => {}
        }
    }

    if in_str || depth == 0 {
        return None;
    }
    let mut repaired = s[..end].to_string();
    repaired.push_str(&"}".repeat(depth as usize));
    serde_json::from_str::<Value>(&repaired).ok()?;
    Some(repaired)
}
