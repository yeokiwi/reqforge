import type { Config } from "tailwindcss";

// Colour roles from docs/specs/10-ui-reference.md §1.1. The hex values are seeds
// sampled from the vendor screencast; the roles are the contract (10 §0).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        chrome: { nav: "#093E9B" },
        action: { create: "#0D5BFD", primary: "#0B48B1" },
        surface: {
          page: "#FFFFFF",
          sidebar: "#F2F0F3",
          "sidebar-selected": "#D9DADE",
        },
        table: { header: "#F0F1F3" },
        pill: { key: "#EDEDF2" },
        chip: { macro: "#E9E9E9" },
        badge: {
          original: "#198B5A",
          parent: "#444964",
          child: "#626878",
          link: "#DD8A34",
          external: "#5A4AA3",
        },
        lozenge: { critical: "#A11911", medium: "#EE841C" },
        link: "#0B5BD3",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
