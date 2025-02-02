/** @type {import('tailwindcss').Config} */
export default {
  important: true, // needed due to tailwind injection order when importing reactive
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  plugins: [],
  presets: [require("@adriansteffan/reactive/tailwind.config.js")],
};
