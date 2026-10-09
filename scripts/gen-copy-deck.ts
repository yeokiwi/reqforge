import { readFileSync, writeFileSync } from "node:fs";
import { parseCopyDeck, renderDeckModule } from "./copy-deck/parse";

const SPEC = "docs/specs/10-ui-reference.md";
const OUT = "src/copy/deck.generated.ts";

const rendered = renderDeckModule(parseCopyDeck(readFileSync(SPEC, "utf8")));

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== rendered) {
    console.error(`${OUT} is out of date with ${SPEC} §13. Run \`pnpm copy:gen\`.`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date.`);
} else {
  writeFileSync(OUT, rendered);
  console.log(`Wrote ${OUT} (${Object.keys(parseCopyDeck(readFileSync(SPEC, "utf8"))).length} strings).`);
}
