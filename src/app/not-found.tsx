import Link from "next/link";
import { t } from "@/copy";

export default function NotFound() {
  return (
    <main className="mx-auto mt-24 max-w-md px-4 text-center">
      <p className="text-lg text-slate-800">{t("error.notFound")}</p>
      <p className="mt-4">
        <Link href="/spaces">{t("shell.spaces.viewAll")}</Link>
      </p>
    </main>
  );
}
