import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

const MD_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "a",
  "hr",
];

/**
 * Copilot often returns markdown; sanitize for innerHTML (user bubbles stay plain text).
 */
export function assistantMarkdownToSafeHtml(src: string): string {
  const t = String(src ?? "").trim();
  if (!t) return "";
  const raw = marked(t, { async: false });
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "rel", "target"],
    ADD_ATTR: ["target"],
  });
}
