import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(
  new URL("../public/icon.svg", import.meta.url),
  "utf8",
);
for (const width of [192, 512]) {
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    ...(width === 512 ? { background: "#e8623e" } : {}),
  });
  await writeFile(
    new URL(`../public/icon-${width}.png`, import.meta.url),
    image.render().asPng(),
  );
}
