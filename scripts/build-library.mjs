import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "data", "library.json");
const indexPath = path.join(root, "index.html");
const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function tone(stance) {
  const value = stance.toLowerCase();
  if (value.includes("sell") || value.includes("avoid")) return "red";
  if (value.includes("hold") || value.includes("watch")) return "blue";
  if (value.includes("buy")) return "green";
  return "amber";
}

function sourceUrl(relativePath) {
  return `https://github.com/rsalek/reports/blob/main/${relativePath}`;
}

function card(item, kind) {
  const legacy = item.format_status === "legacy" ? '<span class="pill legacy-pill">Legacy format</span>' : "";
  const metadata = kind === "report"
    ? `<span class="pill">Generated ${escapeHtml(item.date)}</span><span class="pill">${escapeHtml(item.phase)}</span><span class="pill">Rating: ${escapeHtml(item.stance)}</span>${legacy}`
    : `<span class="pill">${escapeHtml(item.baseline)}</span><span class="pill">Updated ${escapeHtml(item.date)}</span><span class="pill">${escapeHtml(item.valuation)}</span>${legacy}`;
  const primaryLabel = kind === "report" ? "Open report" : "Open dashboard";
  const related = item.related_url ? `<a class="link-btn" href="${escapeHtml(item.related_url)}">${escapeHtml(item.related_label)}</a>` : "";
  return `        <article class="card" data-format-status="${escapeHtml(item.format_status)}">
          <div class="card-top"><div><span class="ticker ${tone(item.stance)}">${escapeHtml(item.ticker)}</span><h3>${escapeHtml(item.company)}</h3></div></div>
          <div class="meta">${metadata}</div>
          <div class="summary">${escapeHtml(item.summary)}</div>
          <div class="card-actions"><a class="link-btn primary" href="${escapeHtml(item.url)}">${primaryLabel}</a>${related}<a class="link-btn" href="${sourceUrl(item.url)}">View source</a></div>
        </article>`;
}

function replaceBlock(document, name, content) {
  const start = `<!-- library:${name}:start -->`;
  const end = `<!-- library:${name}:end -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(document)) throw new Error(`Missing generated block: ${name}`);
  return document.replace(pattern, `${start}\n${content}\n        ${end}`);
}

function labelLegacyPage(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Missing legacy artifact: ${relativePath}`);
  let document = fs.readFileSync(filePath, "utf8");
  const label = '<!-- legacy-format-label:start --><div role="note" style="position:relative;z-index:9999;padding:9px 16px;background:#fff7df;border-bottom:1px solid #e5c76b;color:#664d03;font:600 13px/1.4 system-ui,sans-serif;text-align:center">Legacy format — current research may use the newer report workflow. This page remains available for reference.</div><!-- legacy-format-label:end -->';
  const pattern = /<!-- legacy-format-label:start -->[\s\S]*?<!-- legacy-format-label:end -->/;
  if (pattern.test(document)) document = document.replace(pattern, label);
  else document = document.replace(/<body([^>]*)>/i, `<body$1>${label}`);
  fs.writeFileSync(filePath, document);
}

const allItems = [...data.reports, ...data.kpis];
for (const item of allItems) {
  if (!item.ticker || !item.company || !item.url || !["current", "legacy"].includes(item.format_status)) {
    throw new Error(`Invalid library item: ${JSON.stringify(item)}`);
  }
  if (!fs.existsSync(path.join(root, item.url))) throw new Error(`Missing artifact: ${item.url}`);
}

let index = fs.readFileSync(indexPath, "utf8");
index = replaceBlock(index, "reports", data.reports.map((item) => card(item, "report")).join("\n\n"));
index = replaceBlock(index, "kpis", data.kpis.map((item) => card(item, "kpi")).join("\n\n"));
index = index.replace(/(<div class="value" data-library-metric="reports">)\d+(<\/div>)/, `$1${data.reports.length}$2`);
index = index.replace(/(<div class="value" data-library-metric="kpis">)\d+(<\/div>)/, `$1${data.kpis.length}$2`);
index = index.replace(/(<div class="value" data-library-metric="wiki">)\d+(<\/div>)/, `$1${data.wiki_notes}$2`);
index = index.replace(/(<div class="value" data-library-metric="companies">)\d+(<\/div>)/, `$1${new Set(allItems.map((item) => item.ticker)).size}$2`);
fs.writeFileSync(indexPath, index);

for (const item of allItems.filter((entry) => entry.format_status === "legacy")) {
  labelLegacyPage(item.url);
  if (item.related_url && !item.related_url.startsWith("http")) labelLegacyPage(item.related_url);
}
console.log(`Built ${data.reports.length} reports and ${data.kpis.length} KPI cards from data/library.json`);
