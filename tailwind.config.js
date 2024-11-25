/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './dist/**/*.{js,ts,jsx,tsx}'],
  theme: {
    fontFamily: {
      sans: ['Atkinson Hyperlegible', 'sans-serif'],
      atkinson: ['Atkinson Hyperlegible', 'sans-serif'],
    },
    extend: {
      keyframes: {
        slideDown: {
          '0%': {
            transform: 'translateY(-10px)',
            opacity: '0',
          },
          '100%': {
            transform: 'translateY(0)',
            opacity: '1',
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.8s ease-out forwards',
        fadeIn: 'fadeIn 0.5s ease-out forwards',
      },
    },
  },
  plugins: [],
};
