import { t } from "@/copy";

/**
 * Holds the place of a screen whose slice has not shipped (PLAN.md). The route and its
 * permission gate exist so links in the shell never 404; the content arrives with the slice.
 */
export function Reserved({ title }: { readonly title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-3 text-slate-600">{t("reserved.body")}</p>
    </section>
  );
}
