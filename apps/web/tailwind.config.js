/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Manrope for headings/display — geometric and confident, reads
        // as infrastructure tooling rather than a marketing site.
        // Inter for body/UI text — excellent legibility at the small
        // sizes a data-dense dashboard lives at. Mono for anything
        // literally technical (IDs, durations, cron expressions, JSON) —
        // functional here, not a decorative flourish.
        display: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f4f5ff',
          100: '#e8eaff',
          200: '#d1d5ff',
          300: '#b3b8ff',
          400: '#8a8ff5',
          500: '#5b5ff0',
          600: '#4548d6',
          700: '#3638ab',
          800: '#2b2c85',
          900: '#232466',
        },
        // A dedicated, functional status palette — used consistently for
        // badges, chart segments, and sidebar counts everywhere in the
        // app, rather than picking colors ad hoc per component. Someone
        // learns this color language once (section 33: "status badges").
        status: {
          pending: '#94a3b8', // slate — not yet queued
          queued: '#f59e0b', // amber — waiting its turn
          running: '#3b82f6', // blue — actively executing
          completed: '#10b981', // emerald — succeeded
          failed: '#ef4444', // red — terminal failure
          retrying: '#f97316', // orange — failed, but trying again
          cancelled: '#64748b', // slate, darker — user-stopped
          deadletter: '#a855f7', // purple — exhausted retries, needs attention
        },
      },
      keyframes: {
        // The one deliberate motion touch in this app: toasts and live
        // progress bars ease in when state actually changes (a WebSocket
        // event landing), not on a timer or hover — motion tied to real
        // events, not decoration.
        'slide-in': {
          '0%': { transform: 'translateY(0.5rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
