/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Heebo', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Frank Ruhl Libre"', '"Cinzel"', 'Georgia', 'serif'],
        display: ['"Plus Jakarta Sans"', 'Heebo', 'sans-serif'],
        cinzel: ['"Cinzel"', 'serif'],
      },
      colors: {
        // ── Semantic surface / text / line tokens ──────────────────────────
        // Channels are defined as CSS variables in index.css (space-separated
        // RGB) so Tailwind opacity modifiers (e.g. bg-surface/70) keep working.
        // The dark ramp is near-neutral (zinc-derived), correcting the former
        // blue-tinted slate surfaces.
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
          active: 'rgb(var(--surface-active) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--ink-subtle) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          ring: 'rgb(var(--accent-ring) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          hover: 'rgb(var(--danger-hover) / <alpha-value>)',
          fg: 'rgb(var(--danger-fg) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          hover: 'rgb(var(--success-hover) / <alpha-value>)',
          fg: 'rgb(var(--success-fg) / <alpha-value>)',
          soft: 'rgb(var(--success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          hover: 'rgb(var(--warning-hover) / <alpha-value>)',
          fg: 'rgb(var(--warning-fg) / <alpha-value>)',
          soft: 'rgb(var(--warning-soft) / <alpha-value>)',
        },
        // Brand ramp kept for logo / marketing accents.
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc7fc',
          400: '#38a8f8',
          500: '#1d8cf2',
          600: '#156edb',
          700: '#1357b2',
          800: '#144991',
          900: '#153e74',
          950: '#0d264a',
        },
        archival: {
          50: '#faf8f5',
          100: '#f3ede4',
          200: '#e6d8c5',
          300: '#d5be9f',
          400: '#c2a17a',
          500: '#ad865c',
          600: '#976e4b',
          700: '#7c573d',
          800: '#654734',
          900: '#533b2c',
          950: '#2c1e16',
        }
      },
      borderRadius: {
        // Semantic radii — consistent rounding language across the app.
        control: '0.5rem',   // 8px — buttons, inputs, chips
        panel: '0.75rem',    // 12px — cards, dropdowns
        sheet: '1rem',       // 16px — modals, drawers
      },
      boxShadow: {
        // Semantic elevation — disciplined, calm neutral shadows (no colored glow).
        control: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        pop: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.04)',
        panel: '0 12px 32px -8px rgb(0 0 0 / 0.16)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
