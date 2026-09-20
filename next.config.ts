import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: {
    // The editor bundles ProseMirror; keep server components lean.
    optimizePackageImports: ['@tiptap/react', '@tiptap/starter-kit'],
  },
};

export default nextConfig;
