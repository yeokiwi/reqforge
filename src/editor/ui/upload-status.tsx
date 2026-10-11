"use client";

// The editor's file-upload region, above the footer: one line per upload in flight (an
// indeterminate progress bar — fetch reports no upload progress — and `Uploading "name"…`) and
// one per failed upload, in the copy deck's words for its problem, with a Dismiss button. A live
// region, so a screen reader hears an upload start and fail.
// spec: docs/specs/10-ui-reference.md section 5.5 (Files and images); docs/specs/09-decision-log.md sections RD-058 and RD-071
import { t } from "@/copy";
import { secondaryButtonClass } from "./dialog";
import type { Upload } from "./use-uploads";

export interface UploadStatusProps {
  readonly uploads: readonly Upload[];
  readonly onDismiss: (id: string) => void;
}

// spec: docs/specs/09-decision-log.md section RD-058
export function UploadStatus({ uploads, onDismiss }: UploadStatusProps) {
  return (
    <section aria-label={t("editor.upload.region")} data-testid="upload-status" className={uploads.length > 0 ? "border-t border-slate-200 bg-white px-4 py-2" : "sr-only"}>
      <ul role="status" aria-live="polite" className="space-y-1">
        {uploads.map((upload) =>
          upload.status === "uploading" ? (
            <li key={upload.id} className="flex items-center gap-3 text-sm text-slate-700">
              <progress className="h-1.5 w-24" aria-label={t("editor.upload.uploading", { name: upload.name })} />
              <span>{t("editor.upload.uploading", { name: upload.name })}</span>
            </li>
          ) : (
            <li key={upload.id} className="flex items-center gap-3 text-sm text-red-700" data-upload-failed="">
              <span className="flex-1">{upload.message}</span>
              <button type="button" className={secondaryButtonClass} onClick={() => onDismiss(upload.id)}>
                {t("editor.upload.dismiss")}
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
