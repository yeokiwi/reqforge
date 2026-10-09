import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/copy";
import { requireUser } from "@/server/authz/current-user";
import { listMySpaces } from "@/server/usecases/spaces";
import { StarIcon } from "@/ui/icons";

export const metadata: Metadata = { title: t("spaces.title") };

export default async function SpacesPage() {
  const user = await requireUser();
  const spaces = await listMySpaces(user);

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">{t("spaces.title")}</h1>
      {spaces.length === 0 ? (
        <p className="text-slate-600">{t("spaces.none")}</p>
      ) : (
        <ul className="grid max-w-4xl gap-3 sm:grid-cols-2">
          {spaces.map((space) => (
            <li key={space.key}>
              <Link
                href={`/spaces/${space.key}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-slate-900 no-underline hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-chrome-nav text-base font-bold text-white"
                >
                  {Array.from(space.name)[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{space.name}</span>
                  <span className="block text-xs text-slate-500">{space.key}</span>
                </span>
                {space.favourite ? <StarIcon filled className="text-lozenge-medium" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
