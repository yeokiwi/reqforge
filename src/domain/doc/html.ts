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
 * Renders a node to HTML. Custom nodes (`requirement`, `requirementLink`,
 * `propertyConfig`) register renderers here so the indexer, the read-only version view
 * and the requirement popup all produce the same markup.
 *
 * Deliberately *not* ProseMirror's own `DOMSerializer`: this runs on the server with no
 * DOM, and the indexer (spec 03 §3, "pure") must not pull in a browser shim.
 */
export type CustomRenderer = (node: PMNode, renderChildren: (node: PMNode) => string) => string | null;

const customRenderers = new Map<string, CustomRenderer>();

export function registerNodeRenderer(type: string, renderer: CustomRenderer): void {
  customRenderers.set(type, renderer);
}

export function renderHtml(node: PMNode): string {
  const custom = customRenderers.get(node.type);
  if (custom) {
    const rendered = custom(node, renderHtml);
    if (rendered !== null) return rendered;
  }

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
