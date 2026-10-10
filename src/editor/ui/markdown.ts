// The Markup dialog's conversion (10 §5.5: "paste Markdown or HTML and convert"). Markdown is
// converted with `marked` (GitHub-flavoured: tables, task lists, fenced code with a language),
// then the HTML goes through the same sanitiser as a paste. The result is inserted through the
// editor's own paste pipeline, so the schema's parser decides what survives: a remote image is
// dropped (RD-058), a refused link keeps its text, raw HTML in the Markdown gets no special pass.
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup); docs/specs/09-decision-log.md sections RD-058, RD-068
import { Marked } from "marked";
import { sanitizeHtml, stripUnstorable } from "./paste";

export type MarkupFormat = "markdown" | "html";

const markdown = new Marked({ gfm: true, breaks: false, async: false });

/** Markdown to sanitised HTML, ready for the schema's parser. */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup: Markdown is converted)
export function markdownToHtml(source: string): string {
  const html = markdown.parse(stripUnstorable(source), { async: false });
  return sanitizeHtml(typeof html === "string" ? html : "", { taskLists: true });
}

/** The HTML the Markup dialog inserts for `source` written in `format`. */
// spec: docs/specs/10-ui-reference.md section 5.5 (Markup: paste Markdown or HTML and convert)
export function markupToHtml(source: string, format: MarkupFormat): string {
  return format === "markdown" ? markdownToHtml(source) : sanitizeHtml(source);
}
