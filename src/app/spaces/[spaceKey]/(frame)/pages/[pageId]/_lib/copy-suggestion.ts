// The title the Copy dialog suggests: `Copy of <title>`, then `Copy of <title> 2`, … skipping
// every title a live page of the space already has, case-insensitively — what the server would
// pick itself (RD-056, RD-067). The wording is the copy deck's `page.copyOf`, the same string the
// server uses (RD-067: the caller passes it in). The database index still decides; a title taken
// meanwhile comes back as TITLE_TAKEN under the field.
// spec: docs/specs/09-decision-log.md sections RD-056 (Copy: `Copy of <title>`, made unique), RD-067 (made-up titles)
import { t } from "@/copy";
import { copyTitle } from "@/domain/documents/title";

export function suggestCopyTitle(original: string, pages: readonly { readonly title: string }[]): string {
  return copyTitle(
    original,
    pages.map((p) => p.title),
    (title) => t("page.copyOf", { title }),
  );
}
