/** EkCode design tokens. Colours, type and radii used by templates, components and the JavaScript views. */
module.exports = {
  content: ["./templates/**/*.html", "./frontend/src/js/**/*.js"],
  theme: {
    extend: {
      colors: {
        ek: {
          bg: "#06101C", panel: "rgba(7,18,32,.82)", panel2: "rgba(12,28,48,.9)",
          ink: "#E6EEF8", ink2: "#A3B5CB", ink3: "#6E8299",
          amber: "#FFB547", "amber-ink": "#2B1B00", lime: "#9BE36B", sky: "#7CC4FF", rose: "#FF9EC7", red: "#FF6B6B",
          line: "rgba(140,172,210,.15)", line2: "rgba(140,172,210,.30)",
          ref: "#FF7A45", stl: "#4EA8FF", pwr: "#2FD6C3", min: "#C08BFF",
        },
      },
      fontFamily: {
        display: ['"Barlow Condensed"', "Barlow", "system-ui", "sans-serif"],
        body: ["Barlow", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      borderRadius: { r1: "6px", r2: "10px", r3: "16px" },
    },
  },
  plugins: [],
};
