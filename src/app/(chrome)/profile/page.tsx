import type { Metadata } from "next";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";

export const metadata: Metadata = { title: t("profile.title") };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">{t("profile.title")}</h1>
      <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-3 text-sm">
        <dt className="text-slate-500">{t("profile.name")}</dt>
        <dd>{user.name}</dd>
        <dt className="text-slate-500">{t("profile.email")}</dt>
        <dd>{user.email}</dd>
      </dl>
    </section>
  );
}
