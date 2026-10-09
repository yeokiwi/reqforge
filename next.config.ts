import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma's engine must stay outside the server bundle.
  serverExternalPackages: ["@prisma/client"],
  typedRoutes: false,
};

export default config;
