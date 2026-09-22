import { describe, expect, it } from 'vitest';
import { renderHtml } from '@/domain/doc';
import { collectImageSources, hasImages, rewriteImageSources } from '../images';

/** spec: 05-baselines-and-diff.md §3.2 step 7; RD-012 */

const body = (html: string) => `<p>Before</p>${html}<p>After</p>`;

describe('collectImageSources', () => {
  it('finds every image in a body', () => {
    const html = body('<img src="https://example.test/a.png" alt="" /><img src="https://example.test/b.png" alt="" />');
    expect(collectImageSources(html)).toEqual(['https://example.test/a.png', 'https://example.test/b.png']);
  });

  it('reports a repeated source once — content-addressed storage keeps one copy', () => {
    const one = '<img src="https://example.test/a.png" alt="" />';
    expect(collectImageSources(body(one + one))).toEqual(['https://example.test/a.png']);
  });

  it('finds an image inside a table cell', () => {
    const html = '<table><tr><td><img src="https://example.test/c.png" alt="" /></td></tr></table>';
    expect(collectImageSources(html)).toEqual(['https://example.test/c.png']);
  });

  it('decodes what the renderer escaped, so the URL fetched is the URL written', () => {
    const html = '<img src="https://example.test/a.png?w=1&amp;h=2" alt="" />';
    expect(collectImageSources(html)).toEqual(['https://example.test/a.png?w=1&h=2']);
  });

  it('is not disturbed by a previous call — the regex carries no state', () => {
    // A shared global regex keeps `lastIndex` between uses and `matchAll` inherits it,
    // so this order used to return nothing and freeze a body still pointing outside.
    const html = body('<img src="https://example.test/a.png" alt="" />');
    expect(hasImages(html)).toBe(true);
    expect(collectImageSources(html)).toEqual(['https://example.test/a.png']);
    expect(hasImages(html)).toBe(true);
    expect(collectImageSources(html)).toEqual(['https://example.test/a.png']);
  });

  it('finds nothing in a body with no images', () => {
    expect(collectImageSources('<p>Just words.</p>')).toEqual([]);
    expect(hasImages('<p>Just words.</p>')).toBe(false);
  });

  it('reads what the real renderer emits', () => {
    // The shape this module parses is the shape domain/doc/html.ts produces — pinned
    // here so a change to the renderer breaks this rather than the freeze.
    const html = renderHtml({
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: 'https://example.test/real.png', alt: 'A picture' } }],
    });
    expect(collectImageSources(html)).toEqual(['https://example.test/real.png']);
    expect(hasImages(html)).toBe(true);
  });
});

describe('rewriteImageSources', () => {
  const replacements = new Map([['https://example.test/a.png', '/s/SJ/images/abc123']]);

  it('points a materialised image at its immutable URL', () => {
    const html = body('<img src="https://example.test/a.png" alt="A" />');
    expect(rewriteImageSources(html, replacements)).toContain('<img src="/s/SJ/images/abc123" alt="A" />');
  });

  it('rewrites every occurrence of the same source', () => {
    const one = '<img src="https://example.test/a.png" alt="" />';
    const out = rewriteImageSources(body(one + one), replacements);
    expect(out.match(/\/s\/SJ\/images\/abc123/g)).toHaveLength(2);
  });

  it('leaves a source with no replacement alone — the caller decides what that means', () => {
    const html = body('<img src="https://elsewhere.test/z.png" alt="" />');
    expect(rewriteImageSources(html, replacements)).toBe(html);
  });

  it('is a no-op with nothing to replace', () => {
    const html = body('<img src="https://example.test/a.png" alt="" />');
    expect(rewriteImageSources(html, new Map())).toBe(html);
  });

  it('escapes the replacement, so a URL cannot break out of the attribute', () => {
    const sneaky = new Map([['https://example.test/a.png', '/x" onerror="alert(1)']]);
    const out = rewriteImageSources(body('<img src="https://example.test/a.png" alt="" />'), sneaky);
    expect(out).not.toContain('onerror="alert(1)"');
    expect(out).toContain('&quot;');
  });

  it('round-trips: what it collects is what it can rewrite', () => {
    const html = body('<img src="https://example.test/a.png?w=1&amp;h=2" alt="" />');
    const [source] = collectImageSources(html);
    const out = rewriteImageSources(html, new Map([[source!, '/s/SJ/images/deadbeef']]));
    expect(collectImageSources(out)).toEqual(['/s/SJ/images/deadbeef']);
  });
});
