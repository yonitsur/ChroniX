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
      }
    },
  },
  plugins: [],
}
