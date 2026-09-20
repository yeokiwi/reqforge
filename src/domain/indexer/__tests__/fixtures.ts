import type { PMNode } from '@/domain/doc';

export const text = (value: string): PMNode => ({ type: 'text', text: value });
export const para = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
export const marker = (key: string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'requirement',
  attrs: { key, uid: `uid-${key}`, ...attrs },
});
export const link = (key: string, attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'requirementLink',
  attrs: { key, ...attrs },
});
export const th = (...content: PMNode[]): PMNode => ({ type: 'tableHeader', content });
export const td = (...content: PMNode[]): PMNode => ({ type: 'tableCell', content });
export const row = (...content: PMNode[]): PMNode => ({ type: 'tableRow', content });
export const table = (...content: PMNode[]): PMNode => ({ type: 'table', content });
export const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

/** A horizontal table: header row, then one requirement per row (spec 03 §2). */
export const horizontalTable = doc(
  table(
    row(th(para(text('Title'))), th(para(text('Category'))), th(para(text('Key')))),
    row(
      td(para(text('The system shall log every access.'))),
      td(para(text('Security'))),
      td(para(marker('FN-001'))),
    ),
    row(td(para(text('The system shall rotate keys.'))), td(para(text('Security'))), td(para(marker('FN-002')))),
  ),
);

/** A vertical table: the first column holds the property names (spec 03 §2). */
export const verticalTable = doc(
  table(
    row(th(para(text('Title'))), td(para(text('Log every access'))), td(para(text('Rotate keys')))),
    row(th(para(text('Category'))), td(para(text('Security'))), td(para(text('Security')))),
    row(th(para(text('Key'))), td(para(marker('VR-001'))), td(para(marker('VR-002')))),
  ),
);

export const paragraphLayout = doc(
  para(marker('PR-001'), text(' The system shall expose a health endpoint.')),
  { type: 'bulletList', content: [{ type: 'listItem', content: [para(marker('PR-002'), text(' Bullet requirement.'))] }] },
);
