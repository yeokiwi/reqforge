import type ExcelJS from 'exceljs';
import { classificationBanner, highest, type ClassificationLabel } from '@/domain/classification';

/**
 * Stamps an exported workbook with its classification.
 * spec: 07-permissions-and-limits.md §2.3 — labels are "displayed … on every exported
 * file's header/footer, and in the xlsx export's first sheet", and "every export carries
 * the label of the highest-classified content it contains" (RD-060).
 *
 * The label is only known once every page has been read — a later page may hold content
 * from a more highly classified document — so the handlers track it as they go and stamp
 * the workbook last.
 */
export class LabelTracker {
  private best: ClassificationLabel | null = null;

  see(label: ClassificationLabel | null | undefined): void {
    this.best = highest([this.best, label]);
  }

  /** The label to print: the highest seen, else the space's label the job was queued with. */
  name(fallback: string | null): string | null {
    return this.best?.name ?? fallback;
  }
}

/**
 * Puts the banner in the first two rows of `first` (unless the handler already wrote the
 * same banner there) and in the header and footer of **every** sheet, so a single printed
 * page still says how it must be handled.
 */
export function stampWorkbook(
  workbook: ExcelJS.Workbook,
  first: ExcelJS.Worksheet,
  label: string | null,
  firstRowHolds: string | null,
): void {
  const banner = classificationBanner(label === null ? null : { id: '', name: label, rank: 0 });
  if (banner === null) return;

  if (firstRowHolds !== null) {
    first.getCell('A1').value = banner;
  } else {
    first.spliceRows(1, 0, [banner], []);
    // A frozen header moved down two rows with everything else.
    first.views = first.views.map((view) =>
      view.state === 'frozen' ? { ...view, ySplit: (view.ySplit ?? 0) + 2 } : view,
    );
  }

  for (const sheet of workbook.worksheets) {
    // `&C` centres the text; `cleanLabelName` refuses `&` in a label so it prints as written.
    sheet.headerFooter.oddHeader = `&C${banner}`;
    sheet.headerFooter.oddFooter = `&C${banner}`;
    sheet.headerFooter.evenHeader = `&C${banner}`;
    sheet.headerFooter.evenFooter = `&C${banner}`;
  }
}
