import { redirect } from "next/navigation";
import { requireUser } from "@/server/authz/current-user";
import { chooseLandingSpace } from "@/server/usecases/spaces";

// "/" sends you to where you were: the last space you opened, else a starred one, else the
// first by name; with no spaces at all, to the space list and its explanation.
export default async function Home() {
  const user = await requireUser();
  const space = await chooseLandingSpace(user);
  redirect(space ? `/spaces/${space.key}` : "/spaces");
}
