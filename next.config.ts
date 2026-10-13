import type { NextConfig } from "next";

// Headers every response carries. `frame-ancestors 'none'` (and X-Frame-Options for browsers that
// predate it) stops the application being framed: a same-site page could otherwise iframe it
// under decoy buttons, and the session cookie (SameSite=Lax) would travel with the framed
// requests (RD-085). The attachment route sends its own stricter CSP; that one wins for its
// responses because a route's own header replaces a config one with the same name.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's engine must stay outside the server bundle.
  serverExternalPackages: ["@prisma/client"],
  typedRoutes: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
