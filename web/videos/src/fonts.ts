import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** The same two variable fonts the site ships (next/font latin subsets, copied from the production build). */
export const fontsReady = Promise.all([
  loadFont({ family: "Hanken Grotesk", url: staticFile("fonts/hanken-grotesk-latin.woff2"), weight: "100 900", format: "woff2" }),
  loadFont({ family: "Literata", url: staticFile("fonts/literata-latin.woff2"), weight: "400 900", format: "woff2" }),
]);
