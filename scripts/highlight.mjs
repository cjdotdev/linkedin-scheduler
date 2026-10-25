// node scripts/highlight.mjs <file> [lang]   Prints the file as highlighted HTML (Shiki, the VS Code engine).
import { readFileSync } from "node:fs";
import { codeToHtml } from "shiki";

const [file, lang = file.split(".").pop()] = process.argv.slice(2);
const html = await codeToHtml(readFileSync(file, "utf8").replace(/\n+$/, ""), { lang, theme: "vitesse-dark" });
process.stdout.write(html);
