import type { Metadata } from "next";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";

export const metadata: Metadata = { title: t("globalSearch.title") };

// 10 §2: global search over page titles and requirement keys. There are neither yet (slices 1
// and 2), so every query honestly finds nothing; the box, the route and the empty state are real.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? "").slice(0, 200).trim();

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold text-slate-900">{t("globalSearch.title")}</h1>
      {q ? <p className="text-slate-600">{t("globalSearch.none", { q })}</p> : null}
    </section>
  );
}
