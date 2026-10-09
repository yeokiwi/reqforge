"use server";

import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/domain/auth/redirect";
import { InvalidCredentialsError, ThrottledError } from "@/domain/errors";
import { setSessionCookie } from "@/server/authz/current-user";
import { login } from "@/server/usecases/login";

/** `email` is echoed back because React resets the form after an action: without it a mistyped
 *  password would also wipe the email field. The password is deliberately never echoed. */
export type LoginState = { readonly error: "invalid" | "throttled" | null; readonly email: string };

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.slice(0, 254) : "";
  try {
    const { token, expiresAt } = await login({
      email,
      password: formData.get("password"),
    });
    await setSessionCookie(token, expiresAt);
  } catch (error) {
    if (error instanceof ThrottledError) return { error: "throttled", email };
    if (error instanceof InvalidCredentialsError) return { error: "invalid", email };
    throw error;
  }
  // redirect() works by throwing, so it stays outside the try block.
  const next = formData.get("next");
  redirect(safeRedirectPath(typeof next === "string" ? next : null));
}
