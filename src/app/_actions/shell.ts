"use server";

// Server actions behind the shell's forms: sign out, collapse/expand the sidebar, star a space.
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { NotFoundError } from "@/domain/errors";
import { clearSessionCookie, readSessionToken, requireUser } from "@/server/authz/current-user";
import { logout } from "@/server/usecases/session";
import { setFavourite, setSidebarCollapsedFor } from "@/server/usecases/spaces";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export async function signOutAction(): Promise<void> {
  await logout(await readSessionToken());
  await clearSessionCookie();
  redirect("/login");
}

export async function setSidebarCollapsedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const collapsed = bool.parse(formData.get("collapsed"));
  await setSidebarCollapsedFor(user, collapsed);
  revalidatePath("/", "layout");
}

export async function setFavouriteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = z.object({ spaceKey: z.string().max(40), favourite: bool }).parse({
    spaceKey: formData.get("spaceKey"),
    favourite: formData.get("favourite"),
  });
  try {
    await setFavourite(user, input.spaceKey, input.favourite);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  revalidatePath("/", "layout");
}
