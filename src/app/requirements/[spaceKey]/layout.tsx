import type { ReactNode } from "react";
import { AppFrame } from "../../_components/app-frame";

export default async function RequirementsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ spaceKey: string }>;
}) {
  const { spaceKey } = await params;
  return (
    <AppFrame spaceKey={spaceKey} section="requirements">
      {children}
    </AppFrame>
  );
}
