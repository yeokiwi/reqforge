import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });

// CLAUDE.md "Code conventions". Dependency direction is one-way:
//   app → server → domain → db
// and the Prisma client is imported only from src/server/repositories/**.
const PRISMA = {
  group: ["@prisma/client", "@prisma/client/*"],
  message: "Database access goes through src/server/repositories/** (CLAUDE.md).",
};
const REPOSITORIES = {
  group: ["@/server/repositories", "@/server/repositories/*"],
  message: "Only src/server/** use cases may call repositories; route handlers and components call use cases.",
};
const APP_LAYER = {
  group: ["@/app", "@/app/*", "@/ui", "@/ui/*"],
  message: "Dependency direction is app → server → domain → db; this layer may not import upward.",
};
const SERVER_LAYER = {
  group: ["@/server", "@/server/*"],
  message: "domain may not import from server (app → server → domain → db).",
};
const EDITOR_ALL = {
  group: ["@/editor", "@/editor/*"],
  message: "src/domain and src/server/repositories never import the editor. The server may use @/editor/schema and @/editor/render only.",
};
const EDITOR_UI = {
  group: ["@/editor/ui", "@/editor/ui/*"],
  message: "The editor's client UI is not importable from the server. Use @/editor/schema or @/editor/render.",
};
const SERVER_ALL = {
  group: ["@/server", "@/server/*"],
  message: "The editor runs in the browser: it must not import server code. Talk to the REST API (spec 08 §3).",
};
const APP_ONLY = {
  group: ["@/app", "@/app/*"],
  message: "src/editor may not import from src/app (app → server → domain; editor sits beside them).",
};
const SCHEMA_PURE = {
  group: ["react", "react-dom", "react/*", "next", "next/*", "@/ui", "@/ui/*", "@/editor/ui", "@/editor/ui/*", "@/editor/render", "@/editor/render/*"],
  message: "src/editor/schema is headless: no React, no Next, no UI, no renderer. The server imports it.",
};

const REACT_AND_NEXT = {
  group: ["react", "react-dom", "react/*", "next", "next/*"],
  message: "src/domain is pure logic: no React and no Next imports.",
};

const restrict = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // No default exports except Next.js pages/layouts/route handlers (CLAUDE.md).
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports except Next.js pages, layouts and route handlers." },
      ],
    },
  },
  // Layer boundaries -------------------------------------------------------------------
  { files: ["src/domain/**/*.{ts,tsx}"], rules: restrict(PRISMA, APP_LAYER, SERVER_LAYER, REACT_AND_NEXT, EDITOR_ALL) },
  {
    files: ["src/server/**/*.{ts,tsx}"],
    ignores: ["src/server/repositories/**"],
    rules: restrict(PRISMA, APP_LAYER, EDITOR_UI),
  },
  { files: ["src/server/repositories/**/*.ts"], rules: restrict(APP_LAYER, EDITOR_ALL) },
  // The editor runs in the browser (or renders headlessly): never server code, never Prisma.
  { files: ["src/editor/**/*.{ts,tsx}"], rules: restrict(PRISMA, SERVER_ALL, APP_ONLY) },
  { files: ["src/editor/schema/**/*.{ts,tsx}"], rules: restrict(PRISMA, SERVER_ALL, APP_ONLY, SCHEMA_PURE) },
  { files: ["src/app/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"], rules: restrict(PRISMA, REPOSITORIES) },
  // RD-037: user-facing strings come from the copy deck and are never inlined in components.
  // Text children must be t("...") calls; only decorative glyphs may appear literally.
  {
    files: ["src/app/**/*.tsx", "src/ui/**/*.tsx", "src/editor/ui/**/*.tsx", "src/editor/render/**/*.tsx"],
    ignores: ["**/__tests__/**"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { allowedStrings: ["·", "/", "|", "•", "›", "‹", "«", "»", "▾", "…", "—", "–", "-", ":"] },
      ],
    },
  },
  // Next.js entry points are the only sanctioned default exports ---------------------------
  {
    files: [
      "src/app/**/{page,layout,template,loading,error,global-error,not-found,default}.tsx",
      "src/app/**/route.ts",
      "src/app/**/{opengraph-image,icon,apple-icon}.tsx",
      "*.config.{ts,mjs,js}",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  // Tests and scripts may reach into anything.
  {
    files: ["**/__tests__/**", "e2e/**", "scripts/**", "prisma/**", "src/test-support/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
