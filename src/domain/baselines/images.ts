/**
 * Image materialisation, over the stored `bodyHtml`.
 * spec: 05-baselines-and-diff.md §3.2 step 7; `RD-012` — Requirement Yogi stores image
 * URLs only, and its own docs warn that swapping the image behind a URL changes what a
 * baselined requirement renders, then advise users not to put images in requirements
 * (research §5.3 leak 2). Advising users away from a feature is not a fix.
 *
 * Pure string work, no DOM — the same constraint `domain/doc/html.ts` writes under, and
 * it operates on the HTML that renderer produced, which is why the shape is known.
 */

/**
 * `<img src="...">` as `renderHtml` emits it: double-quoted, escaped, `src` first.
 *
 * Built fresh on every call rather than shared: a global regex carries `lastIndex`
 * between uses, and `matchAll` inherits it — so a shared one makes `collectImageSources`
 * silently miss images after a `test()`, which is exactly how a body could have been
 * frozen still pointing at the internet.
 */
const IMG_SRC = () => /<img\s+src="([^"]*)"/g;

/** Every distinct image source in a frozen body, in the order they appear. */
export function collectImageSources(bodyHtml: string): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];

  for (const match of bodyHtml.matchAll(IMG_SRC())) {
    const raw = match[1];
    if (!raw) continue;
    const src = decodeHtml(raw);
    if (src.length === 0 || seen.has(src)) continue;
    seen.add(src);
    sources.push(src);
  }

  return sources;
}

/**
 * Rewrites every image source that has a materialised replacement. A source with no entry
 * is left alone — the caller decides whether that is a refusal, and `freeze` does refuse
 * (`RD-043`), rather than quietly freezing a body that still points at the internet.
 */
export function rewriteImageSources(bodyHtml: string, replacements: ReadonlyMap<string, string>): string {
  if (replacements.size === 0) return bodyHtml;

  return bodyHtml.replace(IMG_SRC(), (whole, raw: string) => {
    const replacement = replacements.get(decodeHtml(raw));
    return replacement ? `<img src="${escapeHtml(replacement)}"` : whole;
  });
}

/** True when a body has at least one image, so a freeze can skip the work when it has none. */
export function hasImages(bodyHtml: string): boolean {
  return IMG_SRC().test(bodyHtml);
}

/** The renderer escapes on the way in; materialisation has to read the original URL back. */
function decodeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
