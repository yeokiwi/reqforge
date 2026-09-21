import { attr, childrenOf, numericAttr, type PMMark, type PMNode } from './types';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only these protocols survive rendering; anything else loses its href. */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  return null;
}

function wrapMarks(html: string, marks: PMMark[] | undefined): string {
  if (!marks?.length) return html;
  return marks.reduce((inner, mark) => {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        return `<strong>${inner}</strong>`;
      case 'italic':
      case 'em':
        return `<em>${inner}</em>`;
      case 'strike':
        return `<s>${inner}</s>`;
      case 'code':
        return `<code>${inner}</code>`;
      case 'underline':
        return `<u>${inner}</u>`;
      case 'link': {
        const href = safeUrl(typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined);
        return href
          ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>`
          : inner;
      }
      default:
        return inner;
    }
  }, html);
}

/**
 * Renders a node to HTML, including the three custom nodes of spec 03 §1, so that the
 * indexer, the read-only version view and the requirement popup all produce the same
 * markup.
 *
 * Deliberately *not* ProseMirror's own `DOMSerializer`: this runs on the server with no
 * DOM, and the indexer (spec 03 §3, "pure") must not pull in a browser shim.
 */
export function renderHtml(node: PMNode): string {
  if (typeof node.text === 'string') {
    return wrapMarks(escapeHtml(node.text), node.marks);
  }

  const inner = childrenOf(node).map(renderHtml).join('');

  switch (node.type) {
    case 'doc':
      return inner;
    case 'paragraph':
      return `<p>${inner}</p>`;
    case 'heading': {
      const level = Math.min(Math.max(numericAttr(node, 'level') ?? 1, 1), 6);
      return `<h${level}>${inner}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${inner}</ul>`;
    case 'orderedList':
      return `<ol>${inner}</ol>`;
    case 'listItem':
      return `<li>${inner}</li>`;
    case 'blockquote':
      return `<blockquote>${inner}</blockquote>`;
    case 'codeBlock': {
      const language = attr(node, 'language');
      const open = language ? `<pre><code class="language-${escapeHtml(language)}">` : '<pre><code>';
      return `${open}${inner}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr />';
    case 'hardBreak':
      return '<br />';
    case 'table':
      return `<table>${inner}</table>`;
    case 'tableRow':
      return `<tr>${inner}</tr>`;
    case 'tableHeader':
      return `<th${spanAttrs(node)}>${inner}</th>`;
    case 'tableCell':
      return `<td${spanAttrs(node)}>${inner}</td>`;
    case 'requirement': {
      // spec: 03-authoring-and-indexing.md §1.1 — "Rendered inline as a lozenge."
      const key = escapeHtml(attr(node, 'key') ?? '');
      return `<span class="rf-req" data-key="${key}">${key}</span>`;
    }
    case 'requirementLink': {
      // spec: 03-authoring-and-indexing.md §1.2
      const key = escapeHtml(attr(node, 'key') ?? '');
      const space = attr(node, 'spaceKey');
      const baseline = numericAttr(node, 'baselineNumber');
      const label = space ? `${escapeHtml(space)}/${key}` : key;
      const suffix = baseline !== undefined ? `@${baseline}` : '';
      return `<span class="rf-req-link" data-key="${key}"${
        space ? ` data-space="${escapeHtml(space)}"` : ''
      }>${label}${suffix}</span>`;
    }
    case 'report': {
      // spec 04 §5 — a report renders live rows at view time, which a pure renderer
      // cannot do. The read-only view shows what is embedded, not stale rows.
      const query = attr(node, 'query') ?? '';
      const label = attr(node, 'useLastRequirement') === 'true' ? 'the last requirement' : query;
      return `<div class="rf-embed" data-report="${escapeHtml(attr(node, 'id') ?? '')}">Report: ${escapeHtml(label)}</div>`;
    }
    case 'savedMatrix': {
      // spec 04 §2.3 — an embed renders live data at view time, which a pure renderer
      // cannot do. The read-only view shows what is embedded rather than stale rows.
      const name = attr(node, 'name') ?? attr(node, 'id') ?? '';
      return `<div class="rf-embed" data-saved-matrix="${escapeHtml(attr(node, 'id') ?? '')}">Traceability matrix: ${escapeHtml(name)}</div>`;
    }
    case 'propertyConfig': {
      // spec: 03-authoring-and-indexing.md §1.3 — configuration, not content. The column
      // header's own text renders; the configuration itself is invisible in the excerpt.
      return inner;
    }
    case 'image': {
      const src = safeUrl(attr(node, 'src'));
      if (!src) return '';
      const alt = escapeHtml(attr(node, 'alt') ?? '');
      return `<img src="${escapeHtml(src)}" alt="${alt}" />`;
    }
    default:
      // Unknown node types render their children rather than vanishing, so a document
      // written by a newer editor build degrades instead of losing text.
      return inner;
  }
}

function spanAttrs(node: PMNode): string {
  const colspan = numericAttr(node, 'colspan');
  const rowspan = numericAttr(node, 'rowspan');
  let out = '';
  if (colspan && colspan > 1) out += ` colspan="${colspan}"`;
  if (rowspan && rowspan > 1) out += ` rowspan="${rowspan}"`;
  return out;
}
