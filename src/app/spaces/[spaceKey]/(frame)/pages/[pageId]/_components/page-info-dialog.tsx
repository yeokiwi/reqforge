"use client";

// `···` → Page information (10 section 4.1, RD-059). The video shows only the menu item, so the
// dialog is ours and invents nothing: a read-only list of what PageDetail says about the page —
// title, id, space, who created it and when, who last changed it and when, the current version
// (a link to Page History, 10 section 23) and whether the viewer is watching it (RD-061).
// spec: docs/specs/10-ui-reference.md section 4.1 (`···` → Page information); docs/specs/09-decision-log.md section RD-059
import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import { Dialog } from "@/ui/dialog";
import { pageHistoryHref } from "@/ui/page-view/urls";
import { formatDateTime } from "@/ui/time";
import { DialogFooter, dialogSecondaryClass } from "./dialog-parts";

export interface PageInfoDialogProps {
  readonly space: { readonly key: string; readonly name: string };
  readonly page: PageDetail;
  readonly onClose: () => void;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children}</dd>
    </>
  );
}

function When({ iso }: { readonly iso: string }) {
  return <time dateTime={iso}>{formatDateTime(iso)}</time>;
}

// spec: docs/specs/09-decision-log.md section RD-059 (Page information is built)
export function PageInfoDialog({ space, page, onClose }: PageInfoDialogProps) {
  return (
    <Dialog title={t("pageInfo.title")} onDismiss={onClose} testId="page-info-dialog">
      <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="page-info">
        <Row label={t("pageInfo.pageTitle")}>{page.title}</Row>
        <Row label={t("pageInfo.id")}>
          <code className="font-mono text-xs">{page.id}</code>
        </Row>
        <Row label={t("pageInfo.space")}>{t("pageInfo.spaceValue", { name: space.name, key: space.key })}</Row>
        <Row label={t("pageInfo.createdBy")}>{page.createdBy.name}</Row>
        <Row label={t("pageInfo.created")}>
          <When iso={page.createdAt} />
        </Row>
        <Row label={t("pageInfo.lastModifiedBy")}>{page.lastModifiedBy.name}</Row>
        <Row label={t("pageInfo.lastModified")}>
          <When iso={page.lastModifiedAt} />
        </Row>
        <Row label={t("pageInfo.version")}>
          <Link href={pageHistoryHref(space.key, page.id)}>{t("pageInfo.versionValue", { n: page.currentVersion })}</Link>
        </Row>
        <Row label={t("pageInfo.watching")}>{page.watching ? t("pageInfo.watching.yes") : t("pageInfo.watching.no")}</Row>
      </dl>
      <DialogFooter>
        <button type="button" className={dialogSecondaryClass} onClick={onClose} data-autofocus="">
          {t("pageView.dialog.close")}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
