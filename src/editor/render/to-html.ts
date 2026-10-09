// The rendered HTML fragment of a document, for `GET /pages/{id}?format=html` (`08` §3).
// The same DocumentView the page uses, so the API and the page cannot disagree. It is
// serialised by renderStaticMarkup rather than react-dom/server: the endpoint is a route
// handler, and Next bundles route handlers in the react-server layer, where react-dom/server
// throws on import.
// spec: docs/specs/08-api-surface.md section 3; docs/specs/10-ui-reference.md section 4.2
import { createElement } from "react";
import { DocumentView, type NodeRenderers } from "./document-view";
import { renderStaticMarkup } from "./static-markup";

export interface RenderHtmlOptions {
  className?: string;
  nodeRenderers?: NodeRenderers;
  /** Heading id prefix; see DocumentViewProps.idPrefix. */
  idPrefix?: string;
}

/** Canonical content to an HTML string: `<div class="rf-content">…</div>`, every value escaped. */
// spec: docs/specs/08-api-surface.md section 3 (?format=html)
export function renderDocumentHtml(content: unknown, options: RenderHtmlOptions = {}): string {
  return renderStaticMarkup(createElement(DocumentView, { content, ...options }));
}
