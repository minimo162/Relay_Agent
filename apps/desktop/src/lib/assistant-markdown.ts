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

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function normalizeAssistantLinks(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const link of Array.from(template.content.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    try {
      const parsed = new URL(href, window.location.href);
      if (!SAFE_LINK_PROTOCOLS.has(parsed.protocol)) {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        continue;
      }
    } catch {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      continue;
    }

    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }

  return template.innerHTML;
}

/**
 * Copilot often returns markdown; sanitize for innerHTML (user bubbles stay plain text).
 */
export function assistantMarkdownToSafeHtml(src: string): string {
  const t = String(src ?? "").trim();
  if (!t) return "";
  const raw = marked(t, { async: false });
  const safe = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "rel", "target"],
    ADD_ATTR: ["target"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  return normalizeAssistantLinks(safe);
}
