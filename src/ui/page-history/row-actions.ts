// What each Page History row offers in its Actions column (10 section 23, RD-060, 07 section 2.4).
// Pure: the permission and pin rules are tested without rendering. The server enforces them again;
// this only decides what is shown.
//
//   current version        nothing (the video's CURRENT row has no actions)
//   Restore                space EDIT
//   Delete                 space ADMIN; for a pinned version it is shown DISABLED with the tooltip
//                          "Pinned by baseline <n>"; without ADMIN it is not shown at all
// spec: docs/specs/10-ui-reference.md section 23; docs/specs/09-decision-log.md section RD-060; docs/specs/07-permissions-and-limits.md section 2.4
import { t } from "@/copy";

export type DeleteAction =
  | { readonly kind: "hidden" }
  | { readonly kind: "enabled" }
  /** Shown, aria-disabled, with `reason` as its tooltip and description. */
  | { readonly kind: "disabled"; readonly reason: string };

export interface RowActions {
  readonly restore: boolean;
  readonly delete: DeleteAction;
}

/**
 * The tooltip of a pinned version's disabled Delete. The video's wording names the baseline;
 * until baselines ship (slice 13) the API says only `pinned: true`, and then the wording is
 * "Pinned by a baseline". Several baselines are listed in order, comma-separated.
 */
// spec: docs/specs/10-ui-reference.md section 23 (Delete disabled with the tooltip "Pinned by baseline <n>"); 08 section 3.1 (pinnedBy)
export function pinnedReason(pinnedBy: readonly number[] | undefined): string {
  if (pinnedBy === undefined || pinnedBy.length === 0) return t("history.pinned.unknown");
  return t("history.pinned", { n: pinnedBy.join(", ") });
}

/**
 * The actions of one version for a viewer with `permissions`. A space ADMIN who cannot EDIT
 * (permissions do not imply each other, RD-051) gets Delete without Restore.
 */
// spec: docs/specs/09-decision-log.md section RD-060 (Restore needs EDIT; Delete needs ADMIN, never current or pinned); 07 section 2.4
export function rowActions(
  version: { readonly current: boolean; readonly pinned: boolean; readonly pinnedBy?: readonly number[] | undefined },
  permissions: { readonly canEdit: boolean; readonly canAdmin: boolean },
): RowActions {
  if (version.current) return { restore: false, delete: { kind: "hidden" } };
  const restore = permissions.canEdit;
  if (!permissions.canAdmin) return { restore, delete: { kind: "hidden" } };
  if (version.pinned) return { restore, delete: { kind: "disabled", reason: pinnedReason(version.pinnedBy) } };
  return { restore, delete: { kind: "enabled" } };
}
