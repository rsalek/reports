import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

const directories = {
  docs: (html) => html.includes('class="page"') && html.includes('class="kicker"')
    ? "monitor"
    : /<(header class="topbar"|header class="report-header")/.test(html) ? "company" : "legacy",
  kpi: (html) => html.includes('<main class="narrative"') ? "thesis" : "dashboard",
  thesis: () => "thesis",
  archive: () => "archive",
};
const originalWordmark = /<img src="\/assets\/brand\/biotechvision-(?:wordmark|logo-dark)\.svg" alt="BiotechVision" height="22">/g;
const wordmark = '<span class="bv-report-wordmark">Biotech<span>Vision</span></span>';
const stylesheet = '<link rel="stylesheet" href="../assets/report.css">';
const masthead = '<a class="bv-home" href="/">' + wordmark + '</a>';
const navigation = '<nav class="bv-report-back" aria-label="BiotechVision"><a href="/">BiotechVision</a><a href="../">Reports library</a></nav>';

for (const [directory, getLayout] of Object.entries(directories)) {
  const folder = new URL(`${directory}/`, root);
  if (directory === "archive" && !existsSync(folder)) continue;
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".html"))) {
    const path = fileURLToPath(new URL(encodeURIComponent(file), folder));
    const original = readFileSync(path, "utf8");
    const layout = getLayout(original);
    if (!/<html\b[^>]*>/i.test(original) || !/<\/head>/i.test(original) || !/<body\b[^>]*>/i.test(original)) {
      throw new Error(`Missing HTML root or head in ${directory}/${file}`);
    }
    let html = original
      .replaceAll('class="bv-home" href="https://biotechvision.co.uk/"', 'class="bv-home" href="/"')
      .replace(originalWordmark, wordmark)
      .replace(/<html\b([^>]*)>/i, (_, attributes) =>
        `<html${attributes.replace(/ data-bv-report="[^"]+"/, "")} data-bv-report="${layout}">`)
      .replace(/^[ \t]*<link rel="stylesheet" href="\.\.\/assets\/report\.css">\r?\n/m, "")
      .replace(/([ \t]*)<\/head>/i, (_, indent, offset, document) => {
        const prefix = document.slice(0, offset).endsWith("\n") ? "" : "\n";
        return `${prefix}${indent}  ${stylesheet}\n${indent}</head>`;
      });
    // Preserve the report body and scripts while adding library navigation to
    // documents that lack an existing masthead.
    if (!html.includes(navigation) && layout === "monitor") {
      html = html.replace(/<main class="page">/, (tag) => `${tag}\n  ${navigation}`);
    }
    if (layout === "legacy" && !html.includes(navigation)) {
      html = html.replace(/<body\b[^>]*>(?:\s*<!-- legacy-format-label:start -->[\s\S]*?<!-- legacy-format-label:end -->)?/i,
        (tag) => `${tag}\n  ${navigation}`);
    }
    if (!html.includes('class="bv-home"') && ["company", "dashboard", "thesis"].includes(layout)) {
      html = html.replace(/<header class="(?:topbar|thesis-topbar)">\s*(<a\b[^>]*>[\s\S]*?<\/a>)/,
        (match, link) => match.replace(link, `<div class="bv-home-cluster">${masthead}${link}</div>`));
    }
    if (!html.includes(stylesheet)) throw new Error(`Style missing from ${directory}/${file}`);
    if (html !== original) writeFileSync(path, html);
  }
}
