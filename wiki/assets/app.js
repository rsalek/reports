const groupColors = {
  "stock-hub": "#2563eb",
  "topic-note": "#16a34a",
  "source-note": "#d97706",
  "cross-stock": "#7c3aed",
  "query-note": "#0ea5e9",
  "system-note": "#64748b",
  "wiki-note": "#475569",
};

const state = {
  graph: null,
  pages: [],
  pageById: new Map(),
  selectedId: null,
  activeGroup: "all",
  query: "",
  pageListExpanded: false,
  svg: null,
  width: 900,
  height: 700,
};

const collapsedPageLimit = 5;

const els = {
  pages: document.getElementById("stat-pages"),
  links: document.getElementById("stat-links"),
  stocks: document.getElementById("stat-stocks"),
  updated: document.getElementById("stat-updated"),
  search: document.getElementById("searchInput"),
  filters: document.getElementById("groupFilters"),
  pageList: document.getElementById("pageList"),
  focus: document.getElementById("focusLabel"),
  reset: document.getElementById("resetButton"),
  svg: document.getElementById("graphSvg"),
  readerGroup: document.getElementById("readerGroup"),
  readerTitle: document.getElementById("readerTitle"),
  readerTicker: document.getElementById("readerTicker"),
  readerMeta: document.getElementById("readerMeta"),
  readerBody: document.getElementById("readerBody"),
  outbound: document.getElementById("outboundLinks"),
  backlinks: document.getElementById("backlinks"),
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "--";
  return value.length > 10 ? value.slice(0, 10) : value;
}

function routeFor(id) {
  return `#/${encodeURIComponent(id)}`;
}

function idFromHash() {
  if (!location.hash.startsWith("#/")) return null;
  try {
    return decodeURIComponent(location.hash.slice(2));
  } catch {
    return null;
  }
}

function scorePage(page, query) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const haystack = [page.title, page.displayTitle, page.graphLabel, page.kicker, page.ticker, page.path, page.groupLabel, page.plainText].join(" ").toLowerCase();
  if (!haystack.includes(q)) return 0;
  let score = 1;
  if (page.ticker && page.ticker.toLowerCase() === q) score += 6;
  if (page.title.toLowerCase().includes(q)) score += 4;
  if (page.path.toLowerCase().includes(q)) score += 2;
  return score;
}

function filteredPages() {
  return state.pages
    .map((page) => ({ page, score: scorePage(page, state.query) }))
    .filter(({ page, score }) => score > 0 && (state.activeGroup === "all" || page.group === state.activeGroup))
    .sort((a, b) => b.score - a.score || b.page.degree - a.page.degree || a.page.title.localeCompare(b.page.title))
    .map(({ page }) => page);
}

function renderStats() {
  els.pages.textContent = state.graph.stats.pages;
  els.links.textContent = state.graph.stats.links;
  els.stocks.textContent = state.graph.stats.stocks;
  els.updated.textContent = formatDate(state.graph.stats.latestUpdated);
}

function renderFilters() {
  const filters = [{ id: "all", label: "All", count: state.pages.length }, ...state.graph.groups];
  els.filters.innerHTML = filters
    .map((group) => {
      const active = group.id === state.activeGroup ? " active" : "";
      return `<button class="filter-button${active}" type="button" data-group="${group.id}">${escapeHtml(group.label)} ${group.count}</button>`;
    })
    .join("");
}

function renderPageList() {
  const pages = filteredPages();
  if (!pages.length) {
    els.pageList.innerHTML = '<div class="muted">No matching notes.</div>';
    return;
  }
  const visiblePages = state.pageListExpanded ? pages : pages.slice(0, collapsedPageLimit);
  const remaining = pages.length - visiblePages.length;
  const pageButtons = visiblePages
    .map((page) => {
      const active = page.id === state.selectedId ? " active" : "";
      const ticker = page.ticker ? ` · ${escapeHtml(page.ticker)}` : "";
      return `
        <button class="page-item${active}" type="button" data-id="${escapeHtml(page.id)}">
          <span class="page-title">${escapeHtml(page.displayTitle || page.title)}${ticker}</span>
          <span class="page-kicker">${escapeHtml(page.kicker || page.groupLabel)}</span>
          <span class="page-path">${escapeHtml(page.path)}</span>
        </button>
      `;
    })
    .join("");
  const toggle = pages.length > collapsedPageLimit
    ? `<button class="page-list-toggle" type="button" data-action="toggle-pages">${state.pageListExpanded ? "Show fewer" : `Show all ${pages.length}`}</button>`
    : "";
  const count = !state.pageListExpanded && remaining > 0
    ? `<div class="page-list-count">${remaining} more notes hidden</div>`
    : "";
  els.pageList.innerHTML = `${pageButtons}${toggle}${count}`;
}

function linkButton(id) {
  const page = state.pageById.get(id);
  if (!page) return "";
  const ticker = page.ticker ? ` · ${escapeHtml(page.ticker)}` : "";
  return `<button type="button" data-id="${escapeHtml(id)}">${escapeHtml(page.displayTitle || page.title)}${ticker}</button>`;
}

function renderLinkLists(page) {
  if (!page.outboundLinks.length) {
    els.outbound.className = "link-list muted";
    els.outbound.textContent = "None yet.";
  } else {
    els.outbound.className = "link-list";
    els.outbound.innerHTML = page.outboundLinks.map(linkButton).join("");
  }

  if (!page.backlinks.length) {
    els.backlinks.className = "link-list muted";
    els.backlinks.textContent = "None yet.";
  } else {
    els.backlinks.className = "link-list";
    els.backlinks.innerHTML = page.backlinks.map(linkButton).join("");
  }
}

function selectPage(id, updateHash = true) {
  const page = state.pageById.get(id);
  if (!page) return;
  state.selectedId = id;
  els.focus.textContent = page.displayTitle || page.title;
  els.readerGroup.textContent = page.groupLabel;
  els.readerTitle.textContent = page.displayTitle || page.title;
  els.readerMeta.textContent = `${page.path}${page.updated ? ` · updated ${page.updated}` : ""}`;
  els.readerBody.classList.remove("empty-state");
  els.readerBody.innerHTML = page.html;

  if (page.ticker) {
    els.readerTicker.hidden = false;
    els.readerTicker.textContent = page.ticker;
  } else {
    els.readerTicker.hidden = true;
    els.readerTicker.textContent = "";
  }

  renderLinkLists(page);
  renderPageList();
  updateGraphFocus();
  if (updateHash && location.hash !== routeFor(id)) history.replaceState(null, "", routeFor(id));
}

function resetSelection() {
  state.selectedId = null;
  state.query = "";
  state.activeGroup = "all";
  state.pageListExpanded = false;
  els.search.value = "";
  els.focus.textContent = "All notes";
  els.readerGroup.textContent = "Select a note";
  els.readerTitle.textContent = "Open a page from the graph or list";
  els.readerTicker.hidden = true;
  els.readerMeta.textContent = "";
  els.readerBody.className = "reader-body empty-state";
  els.readerBody.textContent = "Search or click a node to read the compiled wiki note here.";
  els.outbound.className = "link-list muted";
  els.outbound.textContent = "None yet.";
  els.backlinks.className = "link-list muted";
  els.backlinks.textContent = "None yet.";
  history.replaceState(null, "", location.pathname);
  renderFilters();
  renderPageList();
  updateGraphFocus();
}

function graphSize() {
  const rect = els.svg.getBoundingClientRect();
  state.width = Math.max(360, rect.width || 900);
  state.height = Math.max(420, rect.height || 700);
  els.svg.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
}

function initializeNodePositions(nodes) {
  const centerX = state.width / 2;
  const centerY = state.height / 2;
  const radius = Math.min(state.width, state.height) * 0.34;
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    node.x = centerX + Math.cos(angle) * radius * (0.65 + (index % 5) * 0.07);
    node.y = centerY + Math.sin(angle) * radius * (0.65 + (index % 7) * 0.05);
    node.vx = 0;
    node.vy = 0;
  });
}

function simulateLayout(nodes, edges) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const centerX = state.width / 2;
  const centerY = state.height / 2 + 22;
  const iterations = 260;

  for (let step = 0; step < iterations; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = 1;
          dy = 1;
          distSq = 2;
        }
        const force = Math.min(18, 900 / distSq);
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = 135;
      const force = (dist - desired) * 0.015;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of nodes) {
      node.vx += (centerX - node.x) * 0.004;
      node.vy += (centerY - node.y) * 0.004;
      node.vx *= 0.76;
      node.vy *= 0.76;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(42, Math.min(state.width - 42, node.x));
      node.y = Math.max(96, Math.min(state.height - 42, node.y));
    }
  }
}

function nodeRadius(node) {
  return Math.max(7, Math.min(23, 7 + Math.sqrt(node.degree || 1) * 3.2));
}

function renderGraph() {
  graphSize();
  const nodes = state.pages.map((page) => ({ ...page }));
  const edges = state.graph.edges.map((edge) => ({ ...edge }));
  initializeNodePositions(nodes);
  simulateLayout(nodes, edges);

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeMarkup = edges
    .map((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return "";
      return `<line class="edge" data-source="${escapeHtml(edge.source)}" data-target="${escapeHtml(edge.target)}" x1="${source.x.toFixed(1)}" y1="${source.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}"></line>`;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const color = groupColors[node.group] || groupColors["wiki-note"];
      const r = nodeRadius(node);
      const label = node.graphLabel || node.displayTitle || node.title;
      const sublabel = node.kicker || node.groupLabel || "";
      return `
        <g class="node" data-id="${escapeHtml(node.id)}" transform="translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})">
          <title>${escapeHtml(node.displayTitle || node.title)}</title>
          <circle r="${r.toFixed(1)}" fill="${color}"></circle>
          <text x="${(r + 7).toFixed(1)}" y="-2">
            <tspan class="node-label-main">${escapeHtml(label)}</tspan>
            <tspan class="node-label-sub" x="${(r + 7).toFixed(1)}" dy="13">${escapeHtml(sublabel)}</tspan>
          </text>
        </g>
      `;
    })
    .join("");

  els.svg.innerHTML = `<g class="edges">${edgeMarkup}</g><g class="nodes">${nodeMarkup}</g>`;
  updateGraphFocus();
}

function updateGraphFocus() {
  const visible = new Set(filteredPages().map((page) => page.id));
  const connected = new Set();

  if (state.selectedId) {
    connected.add(state.selectedId);
    for (const edge of state.graph.edges) {
      if (edge.source === state.selectedId) connected.add(edge.target);
      if (edge.target === state.selectedId) connected.add(edge.source);
    }
  }

  els.svg.querySelectorAll(".node").forEach((nodeEl) => {
    const id = nodeEl.dataset.id;
    const shouldShow = visible.has(id) && (!state.selectedId || connected.has(id));
    nodeEl.classList.toggle("dim", !shouldShow);
  });

  els.svg.querySelectorAll(".edge").forEach((edgeEl) => {
    const source = edgeEl.dataset.source;
    const target = edgeEl.dataset.target;
    const selectedEdge = state.selectedId && (source === state.selectedId || target === state.selectedId);
    const shouldShow = visible.has(source) && visible.has(target) && (!state.selectedId || selectedEdge);
    edgeEl.classList.toggle("dim", !shouldShow);
    edgeEl.classList.toggle("focused", Boolean(selectedEdge));
  });
}

function bindEvents() {
  els.filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    state.activeGroup = button.dataset.group;
    state.pageListExpanded = false;
    renderFilters();
    renderPageList();
    updateGraphFocus();
  });

  els.pageList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-action='toggle-pages']");
    if (toggle) {
      state.pageListExpanded = !state.pageListExpanded;
      renderPageList();
      return;
    }
    const button = event.target.closest("[data-id]");
    if (button) selectPage(button.dataset.id);
  });

  els.svg.addEventListener("click", (event) => {
    const node = event.target.closest(".node");
    if (node) selectPage(node.dataset.id);
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim();
    state.pageListExpanded = Boolean(state.query);
    renderPageList();
    updateGraphFocus();
  });

  els.reset.addEventListener("click", resetSelection);

  document.addEventListener("click", (event) => {
    const wikiLink = event.target.closest("[data-wiki-link]");
    if (wikiLink) {
      event.preventDefault();
      selectPage(wikiLink.dataset.wikiLink);
      return;
    }
    const drawerLink = event.target.closest(".link-list [data-id]");
    if (drawerLink) selectPage(drawerLink.dataset.id);
  });

  window.addEventListener("hashchange", () => {
    const id = idFromHash();
    if (id) selectPage(id, false);
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderGraph, 160);
  });
}

async function init() {
  const [graphResponse, searchResponse] = await Promise.all([
    fetch("data/graph.json"),
    fetch("data/search.json"),
  ]);
  state.graph = await graphResponse.json();
  const search = await searchResponse.json();
  const searchById = new Map(search.records.map((record) => [record.id, record]));
  state.pages = state.graph.nodes.map((page) => ({ ...page, ...(searchById.get(page.id) || {}) }));
  state.pageById = new Map(state.pages.map((page) => [page.id, page]));

  renderStats();
  renderFilters();
  renderPageList();
  renderGraph();
  bindEvents();

  const routedId = idFromHash();
  if (routedId && state.pageById.has(routedId)) {
    selectPage(routedId, false);
  } else {
    const indexPage = state.pageById.get("wiki/Stock Knowledge Wiki");
    if (indexPage) selectPage(indexPage.id, false);
  }
}

init().catch((error) => {
  console.error(error);
  els.readerBody.className = "reader-body empty-state";
  els.readerBody.textContent = "The wiki data could not be loaded. Rebuild the static wiki and try again.";
});
