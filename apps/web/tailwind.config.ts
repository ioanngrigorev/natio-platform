import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0E1320",
          900: "#0E1320",
          800: "#1B2233",
          700: "#2B3446",
          600: "#3F4A5F",
          500: "#5B6678",
          400: "#7C8798",
          300: "#A5ADBA",
          200: "#D2D7DF",
          100: "#E8EBF0",
          50: "#F4F6F9",
        },
        brand: {
          DEFAULT: "#1E3A8A",
          700: "#1B3277",
          600: "#1E3A8A",
          500: "#2B4BA8",
          100: "#E3E9F7",
          50: "#F1F4FB",
        },
        ok: { DEFAULT: "#1F7A4D", bg: "#E7F4EC" },
        warn: { DEFAULT: "#9A6700", bg: "#FBF1D9" },
        bad: { DEFAULT: "#B42318", bg: "#FBE9E7" },
        info: { DEFAULT: "#1E5AA8", bg: "#E5EEF9" },
        muted: { DEFAULT: "#5B6678", bg: "#EEF0F4" },

        /* --- Dark marketing/docs surface (public site + /docs only) ---------
           The merchant dashboard and admin stay on the light `ink` scale above:
           dense financial tables read better on light. These tokens are for the
           public brand surface. Contrast vs #08090C: mist-50 18:1, mist-200 12:1,
           mist-400 6.4:1, iris 7.4:1, lime 13:1, aqua 10:1. */
        night: {
          DEFAULT: "#08090C",
          950: "#08090C",
          900: "#0B0D12",
          850: "#101319",
          800: "#151922",
          700: "#1D2230",
          600: "#2A3040",
          500: "#3A4152",
        },
        mist: {
          50: "#F5F6F8",
          200: "#C6CAD4",
          400: "#8A91A0",
          600: "#5C6373",
        },
        iris: { DEFAULT: "#7C8CFF", 400: "#9AA6FF", 600: "#6070F0", dim: "#2B3160" },
        lime: { DEFAULT: "#C2F04B", dim: "#3A4A18" },
        aqua: { DEFAULT: "#56C8F0", dim: "#17384A" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(14,19,32,0.06), 0 0 0 1px rgba(14,19,32,0.06)",
        glow: "0 0 0 1px rgba(124,140,255,0.16), 0 24px 60px -28px rgba(124,140,255,0.35)",
        lift: "0 24px 70px -34px rgba(0,0,0,0.9)",
      },
      backgroundImage: {
        /* Faint blueprint grid used behind dark sections. */
        grid: "linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
      },
      backgroundSize: { grid: "72px 72px" },
    },
  },
  plugins: [require("@tailwindcss/forms")({ strategy: "class" })],
};

export default config;
