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

function extractTitle(markdown, relPath, frontmatter) {
  if (frontmatter.title) return frontmatter.title;
  const body = stripFrontmatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path.basename(relPath, ".md").replace(/-/g, " ");
}

function plainTextFromMarkdown(markdown) {
  return stripFrontmatter(markdown)
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
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
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
});

const resolveLink = buildResolvers(pages);
const pageById = new Map(pages.map((page) => [page.id, page]));
const brokenLinkSet = new Set();
const edges = [];

for (const page of pages) {
  const outbound = new Set();
  let match;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(page.markdown)) !== null) {
    if (isPrivateTarget(match[1])) continue;
    const target = resolveLink(match[1]);
    if (target && target !== page.id) {
      outbound.add(target);
      edges.push({ source: page.id, target });
    } else if (!target) {
      brokenLinkSet.add(`${page.id} -> ${match[1]}`);
    }
  }
  page.outboundLinks = [...outbound].sort();
}

for (const page of pages) {
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

const activityPage = pages.find((page) => page.id === "wiki/_system/Operational Log");
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
  activity: activityPage
    ? activityPage.plainText
        .split(/(?=\d{4}-\d{2}-\d{2})/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(-8)
    : [],
};

const search = {
  generatedAt: graph.generatedAt,
  records: pages.map((page) => ({
    id: page.id,
    title: page.title,
    path: page.path,
    ticker: page.ticker,
    type: page.type,
    group: page.group,
    updated: page.updated,
    text: [page.title, page.ticker, page.path, page.groupLabel, page.plainText].filter(Boolean).join(" "),
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
