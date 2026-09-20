import { describe, expect, it } from 'vitest';
import { analyseTable, cellAt } from '../table';
import { plainText, textOf } from '../text';
import { renderHtml, escapeHtml } from '../html';
import { nodeAt, walk, type PMNode } from '../types';

const doc: PMNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Scope' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The system shall ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'log' },
        { type: 'text', text: ' every access.' },
      ],
    },
  ],
};

describe('document text', () => {
  it('flattens to plain text without gluing blocks together', () => {
    expect(plainText(doc)).toBe('Scope The system shall log every access.');
  });

  it('keeps raw text of a single text node untouched', () => {
    expect(textOf({ type: 'text', text: '  spaced  ' })).toBe('  spaced  ');
  });
});

describe('html rendering', () => {
  it('renders headings, marks and links', () => {
    expect(renderHtml(doc)).toBe(
      '<h2>Scope</h2><p>The system shall <strong>log</strong> every access.</p>',
    );
  });

  it('escapes text and attributes', () => {
    const hostile: PMNode = {
      type: 'paragraph',
      content: [{ type: 'text', text: '<script>alert("x")</script>' }],
    };
    expect(renderHtml(hostile)).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
    expect(escapeHtml(`a&b'c`)).toBe('a&amp;b&#39;c');
  });

  it('drops javascript: links but keeps their text', () => {
    const link: PMNode = {
      type: 'paragraph',
      content: [{ type: 'text', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }], text: 'click' }],
    };
    expect(renderHtml(link)).toBe('<p>click</p>');
  });

  it('renders unknown node types as their children rather than dropping text', () => {
    const future: PMNode = { type: 'somethingNew', content: [{ type: 'text', text: 'kept' }] };
    expect(renderHtml(future)).toBe('kept');
  });
});

describe('anchor paths', () => {
  it('addresses nodes by child index', () => {
    const paths = [...walk(doc)].map((entry) => entry.path);
    expect(paths.slice(0, 4)).toEqual(['', '0', '0.0', '1']);
    expect(nodeAt(doc, '1.1')?.text).toBe('log');
    expect(nodeAt(doc, '9')).toBeUndefined();
  });
});

describe('table shape', () => {
  const table: PMNode = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Title' }] }] },
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Category' }] }] },
        ],
      },
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Log access' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Security' }] }] },
        ],
      },
    ],
  };

  it('detects a header row', () => {
    const shape = analyseTable(table);
    expect(shape.hasHeaderRow).toBe(true);
    expect(shape.hasHeaderColumn).toBe(false);
    expect(shape.columnCount).toBe(2);
    expect(plainText(cellAt(shape, 1, 1)!.node)).toBe('Security');
  });

  it('resolves colspan into grid coordinates', () => {
    const spanned: PMNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'text', text: 'wide' }] },
            { type: 'tableCell', content: [{ type: 'text', text: 'third' }] },
          ],
        },
      ],
    };
    const shape = analyseTable(spanned);
    expect(shape.columnCount).toBe(3);
    expect(plainText(cellAt(shape, 0, 1)!.node)).toBe('wide');
    expect(plainText(cellAt(shape, 0, 2)!.node)).toBe('third');
  });

  it('detects a header column for the vertical layout', () => {
    const vertical: PMNode = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'text', text: 'Title' }] },
            { type: 'tableCell', content: [{ type: 'text', text: 'Log access' }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'text', text: 'Category' }] },
            { type: 'tableCell', content: [{ type: 'text', text: 'Security' }] },
          ],
        },
      ],
    };
    const shape = analyseTable(vertical);
    expect(shape.hasHeaderColumn).toBe(true);
    expect(shape.hasHeaderRow).toBe(false);
  });
});
