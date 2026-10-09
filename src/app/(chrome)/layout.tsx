import type { ReactNode } from "react";
import { AppFrame } from "../_components/app-frame";

// Screens that belong to no space: the space list, search, help, profile, administration.
export default function ChromeLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
