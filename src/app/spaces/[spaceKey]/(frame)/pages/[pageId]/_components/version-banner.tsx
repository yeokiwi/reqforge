// The banner over a past version (10 section 11: "read-only, with a banner back to current";
// RD-060). A status region, so arriving at a past version is announced.
// spec: docs/specs/10-ui-reference.md section 11 (Page version); docs/specs/09-decision-log.md section RD-060
import Link from "next/link";
import { t } from "@/copy";

export interface VersionBannerProps {
  readonly version: number;
  /** The page view, current version. */
  readonly currentHref: string;
}

// spec: docs/specs/09-decision-log.md section RD-060 (a past version is viewed read-only, with a banner linking back to current)
export function VersionBanner({ version, currentHref }: VersionBannerProps) {
  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-300 bg-surface-sidebar px-4 py-2 text-sm text-slate-800"
      data-testid="version-banner"
    >
      <span>{t("pageView.version.banner", { n: version })}</span>
      <Link href={currentHref}>{t("pageView.version.current")}</Link>
    </div>
  );
}
