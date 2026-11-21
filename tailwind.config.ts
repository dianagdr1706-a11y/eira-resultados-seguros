import type { Config } from "tailwindcss";

/**
 * Design tokens aligned with the PaDi / EIRA reference UI:
 * pink #F693A7 · magenta #D24C7F · berry #B8185A · plum #4A1D3D · blush #FFF1F3 · pale #FFD7DE · peach #FDD7C7
 * Poppins (UI) + JetBrains Mono (folios / hashes), pill buttons, 28–34px rounded cards, soft plum shadows.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        eira: {
          50: "#FFF1F3", // blush
          100: "#FFE4EA",
          200: "#FFD7DE", // pale
          300: "#F9B9C6",
          400: "#F693A7", // pink
          500: "#D24C7F", // magenta
          600: "#B8185A", // berry (primary)
          700: "#9C1450",
          800: "#7A1442",
          900: "#4A1D3D", // plum
          950: "#2E1126",
        },
        padi: {
          pink: "#F693A7",
          mag: "#D24C7F",
          berry: "#B8185A",
          rose: "#B13E5D",
          peach: "#FDD7C7",
          blush: "#FFF1F3",
          pale: "#FFD7DE",
          ink: "#1A1A1A",
          plum: "#4A1D3D",
          muted: "#6B5457",
          line: "#F0EAEA",
          coral: "#FF7B9C",
        },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "Poppins", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
        "4xl": "2.25rem",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(74,29,61,.05), 0 8px 20px -14px rgba(74,29,61,.22)",
        DEFAULT: "0 1px 2px rgba(74,29,61,.05), 0 14px 34px -18px rgba(74,29,61,.28)",
        md: "0 1px 2px rgba(74,29,61,.05), 0 14px 34px -18px rgba(74,29,61,.28)",
        lg: "0 2px 4px rgba(74,29,61,.06), 0 30px 60px -24px rgba(184,24,90,.38)",
        xl: "0 2px 4px rgba(74,29,61,.06), 0 30px 60px -24px rgba(184,24,90,.38)",
        berry: "0 14px 28px -14px rgba(184,24,90,.8)",
      },
      transitionTimingFunction: {
        padi: "cubic-bezier(.22,.61,.36,1)",
        spring: "cubic-bezier(.34,1.4,.64,1)",
      },
    },
  },
  plugins: [],
};
export default config;
