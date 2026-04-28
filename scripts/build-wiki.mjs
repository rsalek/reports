#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultSource = "/Users/rezasalek/Documents/Obsidian Vault/LLM-wiki/wiki";
const sourceRoot = path.resolve(process.env.WIKI_SOURCE || defaultSource);
const outRoot = path.resolve(process.env.WIKI_OUT || path.join(repoRoot, "wiki"));
const templateRoot = path.join(__dirname, "wiki-viewer");
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const HIDDEN_PAGE_IDS = new Set([
  "wiki/_system/Operational Log",
  "wiki/_system/Durable Queries",
  "wiki/_system/Cross-Stock Map",
]);

function readDirRecursive(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readDirRecursive(fullPath, predicate));
    } else if (!predicate || predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function withoutMd(value) {
  return value.replace(/\.md$/i, "");
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

function redactPrivatePaths(value) {
  return value.replace(/raw\/(?:stocks|inbox)(?:\/[^`\n)<]*)?/g, "[private raw source]");
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return {};
  const result = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyValue) {
      currentKey = keyValue[1];
      const value = keyValue[2].trim();
      if (!value) {
        result[currentKey] = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        result[currentKey] = value
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        result[currentKey] = value.replace(/^["']|["']$/g, "");
      }
      continue;
    }

    const listValue = line.match(/^\s*-\s+(.+)$/);
    if (listValue && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(listValue[1].trim().replace(/^["']|["']$/g, ""));
    }
  }

  return result;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isPrivateTarget(value) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === "raw" || normalized.startsWith("raw/");
}

function isHiddenTarget(value) {
  const normalized = withoutMd(value.trim().replace(/\\/g, "/").replace(/^\/+/, ""));
  const normalizedWithWiki = `wiki/${normalized.replace(/^wiki\//, "")}`;
  return normalized.startsWith("wiki/_system/") || HIDDEN_PAGE_IDS.has(normalized) || HIDDEN_PAGE_IDS.has(normalizedWithWiki);
}

function hasHiddenWikilink(line) {
  const re = new RegExp(WIKILINK_RE.source, "g");
  let match;
  while ((match = re.exec(line)) !== null) {
    if (isHiddenTarget(match[1])) return true;
    if (isPrivateTarget(match[1])) return true;
  }
  return false;
}

function removeHiddenReferences(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !hasHiddenWikilink(line))
    .filter((line) => !/^##\s+(Durable Queries|Operations)\s*$/.test(line.trim()))
    .filter((line) => !/`raw\/` is immutable/.test(line))
    .join("\n");
}

function classifyPage(id, frontmatter) {
  if (frontmatter.type === "stock-hub") return "stock-hub";
  if (frontmatter.type === "source-note") return "source-note";
  if (frontmatter.type === "comparison") return "cross-stock";
  if (id.includes("/topics/")) return "topic-note";
  if (id.startsWith("wiki/cross-stock/")) return "cross-stock";
  if (id.startsWith("wiki/_system/")) return "system-note";
  if (id.startsWith("wiki/queries/")) return "query-note";
  return "wiki-note";
}

function labelForGroup(group) {
  return {
    "stock-hub": "Stock Hubs",
    "source-note": "Source Notes",
    "topic-note": "Topic Notes",
    "cross-stock": "Cross-Stock",
    "system-note": "System Notes",
    "query-note": "Query Notes",
    "wiki-note": "Wiki Notes",
  }[group] || "Wiki Notes";
}

function tickerFromPath(id) {
  const match = id.match(/^wiki\/stocks\/([^/]+)\//);
  return match ? match[1] : "";
}

function sourceDateFromId(id) {
  const match = id.match(/\/(\d{4}-\d{2}-\d{2})\s+/);
  return match ? match[1] : "";
}

function shortCompanyName(title, ticker) {
  return title.replace(new RegExp(`\\s*\\(${ticker}\\)$`), "").trim();
}

function curatedLabels(page) {
  const ticker = page.ticker || tickerFromPath(page.id);
  if (page.group === "stock-hub") {
    return {
      displayTitle: page.title,
      graphLabel: ticker || shortCompanyName(page.title, ticker),
      kicker: "Stock hub",
    };
  }
  if (page.group === "topic-note") {
    const label = page.title.toLowerCase().includes("thesis") ? "Thesis" : page.title.replace(/\s+-\s+.+$/, "");
    return {
      displayTitle: `${ticker} ${label}`,
      graphLabel: `${ticker} ${label}`,
      kicker: "Topic note",
    };
  }
  if (page.group === "source-note") {
    const date = sourceDateFromId(page.id);
    const sourceKind = page.title.toLowerCase().includes("earnings") ? "Earnings update" : "Source report";
    return {
      displayTitle: `${ticker} ${sourceKind}${date ? ` (${date})` : ""}`,
      graphLabel: `${ticker} ${sourceKind}`,
      kicker: date || "Source note",
    };
  }
  if (page.group === "cross-stock") {
    return {
      displayTitle: page.title,
      graphLabel: page.title.replace(" - Moat, Growth, and Valuation Framing", ""),
      kicker: "Cross-stock comparison",
    };
  }
  return {
    displayTitle: page.title,
    graphLabel: page.title,
    kicker: page.groupLabel,
  };
}

function extractTitle(markdown, relPath, frontmatter) {
  if (frontmatter.title) return frontmatter.title;
  const body = stripFrontmatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path.basename(relPath, ".md").replace(/-/g, " ");
}

function plainTextFromMarkdown(markdown) {
  return removeHiddenReferences(stripFrontmatter(markdown))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(WIKILINK_RE, (_, target, alias) => alias || target)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/raw\/(?:stocks|inbox)(?:\/\S*)?/g, "[private raw source]");
}

function buildResolvers(pages) {
  const exact = new Map();
  const basename = new Map();
  const title = new Map();

  for (const page of pages) {
    const keys = new Set([
      page.id,
      page.path,
      withoutMd(page.path),
      page.id.replace(/^wiki\//, ""),
      page.path.replace(/^wiki\//, ""),
      withoutMd(page.path.replace(/^wiki\//, "")),
    ]);

    for (const key of keys) exact.set(key.toLowerCase(), page.id);

    const base = path.posix.basename(page.id).toLowerCase();
    if (!basename.has(base)) basename.set(base, page.id);
    title.set(page.title.toLowerCase(), page.id);
  }

  return function resolveLink(rawTarget) {
    const target = rawTarget.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
    const candidates = [
      target,
      `wiki/${target}`,
      target.replace(/^\/+/, ""),
      `wiki/${target.replace(/^wiki\//, "")}`,
    ];

    for (const candidate of candidates) {
      const found = exact.get(candidate.toLowerCase()) || exact.get(`${candidate}.md`.toLowerCase());
      if (found) return found;
    }

    const base = path.posix.basename(target).toLowerCase();
    return basename.get(base) || title.get(target.toLowerCase()) || null;
  };
}

function renderInline(text, resolveLink, brokenLinks) {
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="external-path">$1</span>');

  html = html.replace(WIKILINK_RE, (full, target, alias) => {
    if (isPrivateTarget(target)) {
      const label = alias || path.posix.basename(target);
      return `<span class="external-path" title="Private source reference">${escapeHtml(label)}</span>`;
    }
    if (isHiddenTarget(target)) {
      const label = alias || path.posix.basename(target);
      return `<span class="external-path" title="Hidden from public wiki">${escapeHtml(label)}</span>`;
    }
    const resolved = resolveLink(target);
    const label = alias || path.posix.basename(target);
    if (!resolved) {
      brokenLinks.add(target);
      return `<span class="broken-link">${escapeHtml(label)}</span>`;
    }
    return `<a href="#/${encodeURIComponent(resolved)}" data-wiki-link="${escapeHtml(resolved)}">${escapeHtml(label)}</a>`;
  });

  return html;
}

function renderMarkdown(markdown, resolveLink, brokenLinks) {
  const lines = removeHiddenReferences(stripFrontmatter(markdown)).split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listType = null;
  let blockquote = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "), resolveLink, brokenLinks)}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  function flushBlockquote() {
    if (!blockquote.length) return;
    html.push(`<blockquote>${blockquote.map((line) => `<p>${renderInline(line, resolveLink, brokenLinks)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  }

  function flushCode() {
    if (!inCode) return;
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    html.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    inCode = false;
    codeLang = "";
    codeLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      if (inCode) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        flushBlockquote();
        inCode = true;
        codeLang = fence[1] || "";
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushBlockquote();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const level = heading[1].length;
      const text = renderInline(heading[2].trim(), resolveLink, brokenLinks);
      const id = slugify(heading[2].replace(WIKILINK_RE, "$2"));
      html.push(`<h${level} id="${id}">${text}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushBlockquote();
      html.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushBlockquote();
      const nextListType = unordered ? "ul" : "ol";
      if (listType !== nextListType) {
        flushList();
        listType = nextListType;
        html.push(`<${listType}>`);
      }
      html.push(`<li>${renderInline((unordered || ordered)[1], resolveLink, brokenLinks)}</li>`);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(line.trim());
  }

  flushCode();
  flushParagraph();
  flushList();
  flushBlockquote();
  return redactPrivatePaths(html.join("\n"));
}

if (!fs.existsSync(sourceRoot)) {
  console.error(`Wiki source not found: ${sourceRoot}`);
  process.exit(1);
}

const markdownFiles = readDirRecursive(sourceRoot, (file) => file.endsWith(".md")).sort();
const pages = markdownFiles.map((filePath) => {
  const markdown = fs.readFileSync(filePath, "utf8");
  const rel = toPosix(path.relative(sourceRoot, filePath));
  const wikiPath = `wiki/${rel}`;
  const id = withoutMd(wikiPath);
  const frontmatter = parseFrontmatter(markdown);
  const title = extractTitle(markdown, rel, frontmatter);
  const group = classifyPage(id, frontmatter);
  return {
    id,
    path: wikiPath,
    title,
    type: frontmatter.type || group,
    ticker: frontmatter.ticker || "",
    updated: frontmatter.updated || "",
    group,
    groupLabel: labelForGroup(group),
    frontmatter,
    markdown,
    plainText: plainTextFromMarkdown(markdown),
    outboundLinks: [],
    backlinks: [],
  };
}).filter((page) => !isHiddenTarget(page.id));

for (const page of pages) {
  Object.assign(page, curatedLabels(page));
}

const resolveLink = buildResolvers(pages);
const pageById = new Map(pages.map((page) => [page.id, page]));
const brokenLinkSet = new Set();
const edges = [];
const edgeKeys = new Set();

function addEdge(source, target) {
  if (!source || !target || source === target) return;
  if (!pageById.has(source) || !pageById.has(target)) return;
  const key = `${source} -> ${target}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ source, target });
}

for (const page of pages) {
  const outbound = new Set();
  let match;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(page.markdown)) !== null) {
    if (isPrivateTarget(match[1])) continue;
    if (isHiddenTarget(match[1])) continue;
    const target = resolveLink(match[1]);
    if (target && target !== page.id) {
      outbound.add(target);
      addEdge(page.id, target);
    } else if (!target) {
      brokenLinkSet.add(`${page.id} -> ${match[1]}`);
    }
  }
  page.outboundLinks = [...outbound].sort();
}

const stockHubByTicker = new Map(pages.filter((page) => page.group === "stock-hub" && page.ticker).map((page) => [page.ticker, page.id]));
const stockNotesByTicker = new Map();
for (const page of pages) {
  if (!page.ticker || page.group === "stock-hub") continue;
  if (!stockNotesByTicker.has(page.ticker)) stockNotesByTicker.set(page.ticker, []);
  stockNotesByTicker.get(page.ticker).push(page);
}

for (const [ticker, hubId] of stockHubByTicker.entries()) {
  const stockNotes = stockNotesByTicker.get(ticker) || [];
  const topicNotes = stockNotes.filter((page) => page.group === "topic-note");
  const sourceNotes = stockNotes.filter((page) => page.group === "source-note");
  for (const note of stockNotes) {
    addEdge(hubId, note.id);
    const hub = pageById.get(hubId);
    if (hub && !hub.outboundLinks.includes(note.id)) hub.outboundLinks.push(note.id);
  }
  for (const topic of topicNotes) {
    for (const source of sourceNotes) {
      addEdge(topic.id, source.id);
      if (!topic.outboundLinks.includes(source.id)) topic.outboundLinks.push(source.id);
    }
  }
}

for (const page of pages) {
  page.outboundLinks.sort();
  page.html = renderMarkdown(page.markdown, resolveLink, brokenLinkSet);
  delete page.markdown;
}

for (const edge of edges) {
  const target = pageById.get(edge.target);
  if (target && !target.backlinks.includes(edge.source)) target.backlinks.push(edge.source);
}

for (const page of pages) {
  page.backlinks.sort();
  page.degree = page.outboundLinks.length + page.backlinks.length;
}

const groupOrder = ["stock-hub", "topic-note", "source-note", "cross-stock", "query-note", "system-note", "wiki-note"];
const groups = groupOrder
  .filter((group) => pages.some((page) => page.group === group))
  .map((group) => ({
    id: group,
    label: labelForGroup(group),
    count: pages.filter((page) => page.group === group).length,
  }));

const stockPages = pages.filter((page) => page.group === "stock-hub");
const latestUpdated = pages
  .map((page) => page.updated)
  .filter(Boolean)
  .sort()
  .at(-1) || "";

const graph = {
  generatedAt: new Date().toISOString(),
  source: "LLM-wiki/wiki",
  stats: {
    pages: pages.length,
    links: edges.length,
    stocks: stockPages.length,
    latestUpdated,
  },
  groups,
  nodes: pages.map(({ frontmatter, plainText, html, ...page }) => ({
    ...page,
    excerpt: plainText.slice(0, 220),
    plainText,
    html,
  })),
  edges,
  activity: [],
};

const search = {
  generatedAt: graph.generatedAt,
  records: pages.map((page) => ({
    id: page.id,
    title: page.title,
    displayTitle: page.displayTitle,
    graphLabel: page.graphLabel,
    kicker: page.kicker,
    path: page.path,
    ticker: page.ticker,
    type: page.type,
    group: page.group,
    updated: page.updated,
    text: [page.title, page.displayTitle, page.graphLabel, page.kicker, page.ticker, page.path, page.groupLabel, page.plainText].filter(Boolean).join(" "),
  })),
};

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outRoot, "assets"), { recursive: true });
fs.mkdirSync(path.join(outRoot, "data"), { recursive: true });

fs.copyFileSync(path.join(templateRoot, "index.html"), path.join(outRoot, "index.html"));
fs.copyFileSync(path.join(templateRoot, "styles.css"), path.join(outRoot, "assets", "styles.css"));
fs.copyFileSync(path.join(templateRoot, "app.js"), path.join(outRoot, "assets", "app.js"));
fs.writeFileSync(path.join(outRoot, "data", "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
fs.writeFileSync(path.join(outRoot, "data", "search.json"), `${JSON.stringify(search, null, 2)}\n`);

console.log(`Published ${pages.length} wiki pages and ${edges.length} resolved links to ${path.relative(repoRoot, outRoot)}/`);
if (brokenLinkSet.size) {
  console.warn(`Broken wikilinks (${brokenLinkSet.size}):`);
  for (const item of [...brokenLinkSet].sort()) console.warn(`- ${item}`);
}
