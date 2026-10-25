import type { Config } from "tailwindcss";

// Palettes backed by CSS variables in client/src/index.css so they follow the
// light/dark theme.
const themedScale = (name: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      `rgb(var(--${name}-${step}) / <alpha-value>)`,
    ]),
  );

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Instrument Serif", "Iowan Old Style", "Georgia", "Cambria", "Times New Roman", "serif"],
        serif: ["Instrument Serif", "Iowan Old Style", "Georgia", "Cambria", "serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        paper: token("paper"),
        surface: { DEFAULT: token("surface"), raised: token("surface-raised") },
        ink: { DEFAULT: token("ink"), soft: token("ink-soft") },
        "muted-ink": token("muted-ink"),
        "faint-ink": token("faint-ink"),
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        bronze: { DEFAULT: token("bronze"), ink: token("bronze-ink"), wash: token("bronze-wash") },
        emerald: { DEFAULT: token("emerald"), wash: token("emerald-wash") },
        oxblood: { DEFAULT: token("oxblood"), wash: token("oxblood-wash") },
        slatewash: token("slate-wash"),

        // Legacy aliases (kept for untouched primitives / chart theming)
        "farm-blue": "hsl(var(--bronze))",
        "farm-green": "hsl(var(--emerald))",
        "farm-powder": "rgb(var(--farm-powder) / <alpha-value>)",
        "farm-tan": "rgb(var(--farm-tan) / <alpha-value>)",
        "farm-dark-green": "hsl(var(--emerald))",
        "farm-yellow": "hsl(var(--bronze))",
        neutral: themedScale("neutral"),
        gray: themedScale("gray"),
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      boxShadow: {
        quiet: "0 1px 2px hsl(220 20% 10% / 0.04), 0 8px 24px -16px hsl(220 20% 10% / 0.18)",
        lifted: "0 2px 4px hsl(220 20% 10% / 0.05), 0 24px 48px -24px hsl(220 20% 10% / 0.25)",
        insetline: "inset 0 0 0 1px hsl(var(--line))",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
