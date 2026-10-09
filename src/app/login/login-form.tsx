"use client";

import { useActionState } from "react";
import { t } from "@/copy";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = { error: null, email: "" };

export function LoginForm({ next }: { readonly next: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          {t("auth.email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
          autoFocus
          className="rf-input"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
          {t("auth.password")}
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="rf-input" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-lozenge-critical">
          {state.error === "throttled" ? t("auth.throttled") : t("auth.error")}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="rf-btn-primary w-full">
        {t("auth.submit")}
      </button>
    </form>
  );
}
