import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/copy";
import { safeRedirectPath } from "@/domain/auth/redirect";
import { currentUser } from "@/server/authz/current-user";
import { LogoMark } from "@/ui/icons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("auth.submit") };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeRedirectPath((await searchParams).next);
  if (await currentUser()) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-sidebar px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-chrome-nav">
          <LogoMark size={26} className="text-chrome-nav" />
        </div>
        <h1 className="mb-6 text-xl font-semibold text-slate-900">{t("auth.title", { app: t("app.name") })}</h1>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
