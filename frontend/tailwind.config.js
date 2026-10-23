/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: { 50: '#f0fdf4', 100: '#dcfce7', 600: '#16803c', 700: '#166534' },
      },
    },
  },
  plugins: [],
};
