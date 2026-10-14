import { build } from "esbuild";

await build({
  entryPoints: ["frontend/src/js/app.js"],
  outfile: "static/js/app.js",
  bundle: false,
  minify: true,
  target: ["es2020"],
  legalComments: "none",
});
console.log("built static/js/app.js");
