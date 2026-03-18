/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./client/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/typography")],
};
