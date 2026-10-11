import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/copy";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { openSpace } from "@/server/usecases/spaces";

type Props = { params: Promise<{ spaceKey: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Metadata runs without recording a visit; an unknown space simply gets the default title.
  const { spaceKey } = await params;
  return { title: spaceKey.toUpperCase() };
}

// One empty space page (PLAN.md slice 0). Opening it is what puts the space in `Spaces ▾`.
export default async function SpacePage({ params }: Props) {
  const user = await requireUser();
  const { spaceKey } = await params;
  const space = await openSpace(user, spaceKey).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-slate-900">{space.name}</h1>
      <p className="text-slate-600">{t("space.empty")}</p>
    </section>
  );
}
