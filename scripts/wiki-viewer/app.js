const groupColors = {
  "stock-hub": "#3f6072",
  "topic-note": "#39766d",
  "source-note": "#a56a24",
  "cross-stock": "#735b86",
  "query-note": "#9b4e5e",
  "wiki-note": "#5f675f",
};

const state = {
  graph: null,
  pages: [],
  pageById: new Map(),
  adjacency: new Map(),
  graphNodes: [],
  graphEdges: [],
  visibleGroups: new Set(),
  selectedId: null,
  query: "",
  searchMatches: new Set(),
  pathNodes: new Set(),
  pathEdges: new Set(),
  recentIds: [],
  transform: { x: 0, y: 0, scale: 1 },
  width: 900,
  height: 650,
};

const els = {
  search: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  searchResults: document.getElementById("searchResults"),
  filters: document.getElementById("groupFilters"),
  pathFrom: document.getElementById("pathFrom"),
  pathTo: document.getElementById("pathTo"),
  findPath: document.getElementById("findPath"),
  swapPath: document.getElementById("swapPath"),
  pathStatus: document.getElementById("pathStatus"),
  pathExamples: document.getElementById("pathExamples"),
  graphStats: document.getElementById("graphStats"),
  reset: document.getElementById("resetButton"),
  focus: document.getElementById("focusLabel"),
  svg: document.getElementById("graphSvg"),
  viewport: document.getElementById("graphViewport"),
  edgeLayer: document.getElementById("edgeLayer"),
  nodeLayer: document.getElementById("nodeLayer"),
  graphEmpty: document.getElementById("graphEmpty"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
  zoomIn: document.getElementById("zoomIn"),
  trailItems: document.getElementById("trailItems"),
  trailStatus: document.getElementById("trailStatus"),
  readerGroup: document.getElementById("readerGroup"),
  readerTitle: document.getElementById("readerTitle"),
  readerTicker: document.getElementById("readerTicker"),
  readerMeta: document.getElementById("readerMeta"),
  readerBody: document.getElementById("readerBody"),
  outbound: document.getElementById("outboundLinks"),
  backlinks: document.getElementById("backlinks"),
  outboundCount: document.getElementById("outboundCount"),
  backlinkCount: document.getElementById("backlinkCount"),
  connectionTabs: document.querySelector(".connection-tabs"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
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

function edgeKey(source, target) {
  return [source, target].sort().join("|");
}

function formatDate(value) {
  if (!value) return "Undated";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function pageName(page) {
  return page.displayTitle || page.title;
}

function searchScore(page, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const title = `${page.title} ${page.displayTitle} ${page.graphLabel}`.toLowerCase();
  const ticker = String(page.ticker || "").toLowerCase();
  const path = page.path.toLowerCase();
  const body = `${page.kicker} ${page.groupLabel} ${page.plainText}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (![title, ticker, path, body].some((value) => value.includes(term))) return 0;
    if (ticker === term) score += 12;
    if (title.startsWith(term)) score += 7;
    else if (title.includes(term)) score += 5;
    if (path.includes(term)) score += 2;
    if (body.includes(term)) score += 1;
  }
  return score;
}

function searchPages(query) {
  return state.pages
    .map((page) => ({ page, score: searchScore(page, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.page.degree - a.page.degree || pageName(a.page).localeCompare(pageName(b.page)))
    .map(({ page }) => page);
}

function excerptFor(page, query) {
  const text = page.plainText || page.excerpt || "";
  const term = query.toLowerCase().split(/\s+/).find(Boolean) || "";
  const index = text.toLowerCase().indexOf(term);
  const start = Math.max(0, index > -1 ? index - 42 : 0);
  const excerpt = text.slice(start, start + 118).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${text.length > start + 118 ? "…" : ""}`;
}

function renderSearch() {
  const query = state.query.trim();
  if (!query) {
    state.searchMatches.clear();
    els.searchResults.replaceChildren();
    updateGraphState();
    return;
  }

  const matches = searchPages(query).slice(0, 8);
  state.searchMatches = new Set(matches.map((page) => page.id));
  els.searchResults.innerHTML = matches.length
    ? matches.map((page) => `
        <button class="search-result${page.id === state.selectedId ? " active" : ""}" type="button" data-id="${escapeHtml(page.id)}">
          <strong>${escapeHtml(pageName(page))}</strong>
          <span>${escapeHtml(page.kicker || page.groupLabel)} · ${escapeHtml(excerptFor(page, query))}</span>
        </button>
      `).join("")
    : '<p class="status-text">No matching research notes.</p>';
  updateGraphState();
}

function buildIndexes() {
  state.pageById = new Map(state.pages.map((page) => [page.id, page]));
  state.adjacency = new Map(state.pages.map((page) => [page.id, []]));
  state.graph.edges.forEach((edge) => {
    state.adjacency.get(edge.source)?.push({ edge, neighbor: edge.target });
    state.adjacency.get(edge.target)?.push({ edge, neighbor: edge.source });
  });
}

function renderFilters() {
  els.filters.innerHTML = state.graph.groups.map((group) => `
    <label>
      <input type="checkbox" value="${escapeHtml(group.id)}" ${state.visibleGroups.has(group.id) ? "checked" : ""}>
      <span class="dot ${escapeHtml(group.id)}" aria-hidden="true"></span>
      <span>${escapeHtml(group.label)}</span>
      <em>${group.count}</em>
    </label>
  `).join("");
}

function populatePathControls() {
  const ordered = [...state.pages].sort((a, b) => {
    const aHub = a.group === "stock-hub" ? 0 : 1;
    const bHub = b.group === "stock-hub" ? 0 : 1;
    return aHub - bHub || pageName(a).localeCompare(pageName(b));
  });
  const options = [
    '<option value="">Choose a note</option>',
    ...ordered.map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(pageName(page))}</option>`),
  ].join("");
  els.pathFrom.innerHTML = options;
  els.pathTo.innerHTML = options;

  const pairs = [
    ["PANW", "ZS", "PANW → ZS"],
    ["ASML", "PL", "ASML → PL"],
    ["IBM", "NOW", "IBM → NOW"],
    ["CBRS", "GTLB", "CBRS → GTLB"],
  ];
  els.pathExamples.innerHTML = pairs.map(([fromTicker, toTicker, label]) => {
    const from = state.pages.find((page) => page.group === "stock-hub" && page.ticker === fromTicker);
    const to = state.pages.find((page) => page.group === "stock-hub" && page.ticker === toTicker);
    if (!from || !to) return "";
    return `<button class="path-example" type="button" data-from="${escapeHtml(from.id)}" data-to="${escapeHtml(to.id)}">${escapeHtml(label)}</button>`;
  }).join("");
}

function graphSize() {
  const rect = els.svg.getBoundingClientRect();
  state.width = Math.max(420, rect.width || 900);
  state.height = Math.max(380, rect.height || 650);
  els.svg.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
}

function initializePositions(nodes) {
  const centerX = state.width / 2;
  const centerY = state.height / 2;
  const hubPages = nodes.filter((node) => node.group === "stock-hub").sort((a, b) => a.ticker.localeCompare(b.ticker));
  const radiusX = Math.max(120, state.width * .34);
  const radiusY = Math.max(100, state.height * .32);
  const anchors = new Map();

  hubPages.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(hubPages.length, 1)) * Math.PI * 2;
    node.x = centerX + Math.cos(angle) * radiusX;
    node.y = centerY + Math.sin(angle) * radiusY;
    node.anchorX = node.x;
    node.anchorY = node.y;
    anchors.set(node.ticker, { x: node.x, y: node.y });
  });

  nodes.forEach((node, index) => {
    if (node.group === "stock-hub") return;
    if (node.group === "wiki-note") {
      node.x = centerX;
      node.y = centerY;
      node.anchorX = centerX;
      node.anchorY = centerY;
    } else if (node.group === "cross-stock") {
      node.x = centerX;
      node.y = Math.max(64, centerY - radiusY * .62);
      node.anchorX = node.x;
      node.anchorY = node.y;
    } else {
      const anchor = anchors.get(node.ticker) || { x: centerX, y: centerY };
      const direction = node.group === "source-note" ? 1 : -1;
      const angle = (index % 7) * .72 + direction * .55;
      const distance = node.group === "source-note" ? 72 : 54;
      node.x = anchor.x + Math.cos(angle) * distance;
      node.y = anchor.y + Math.sin(angle) * distance;
      node.anchorX = node.x;
      node.anchorY = node.y;
    }
    node.vx = 0;
    node.vy = 0;
  });
  hubPages.forEach((node) => { node.vx = 0; node.vy = 0; });
}

function simulateLayout(nodes, edges) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  for (let step = 0; step < 210; step += 1) {
    const alpha = 1 - step / 210;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const distance2 = Math.max(dx * dx + dy * dy, 50);
        const distance = Math.sqrt(distance2);
        const force = Math.min(2.2, 650 / distance2) * alpha;
        dx /= distance;
        dy /= distance;
        a.vx -= dx * force;
        a.vy -= dy * force;
        b.vx += dx * force;
        b.vy += dy * force;
      }
    }

    edges.forEach((edge) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const desired = source.ticker && source.ticker === target.ticker ? 68 : 118;
      const force = (distance - desired) * .0016 * alpha;
      source.vx += (dx / distance) * force;
      source.vy += (dy / distance) * force;
      target.vx -= (dx / distance) * force;
      target.vy -= (dy / distance) * force;
    });

    nodes.forEach((node) => {
      node.vx += (node.anchorX - node.x) * .0045 * alpha;
      node.vy += (node.anchorY - node.y) * .0045 * alpha;
      node.vx *= .82;
      node.vy *= .82;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(44, Math.min(state.width - 44, node.x));
      node.y = Math.max(44, Math.min(state.height - 44, node.y));
    });
  }
}

function nodeRadius(node) {
  if (node.group === "stock-hub") return 10 + Math.min(5, Math.sqrt(node.degree || 1));
  if (node.group === "wiki-note") return 11;
  if (node.group === "cross-stock") return 10;
  return 6 + Math.min(4, Math.sqrt(node.degree || 1));
}

function renderGraph() {
  graphSize();
  state.graphNodes = state.pages.map((page) => ({ ...page, vx: 0, vy: 0 }));
  state.graphEdges = state.graph.edges.map((edge) => ({ ...edge }));
  initializePositions(state.graphNodes);
  simulateLayout(state.graphNodes, state.graphEdges);

  els.edgeLayer.replaceChildren();
  els.nodeLayer.replaceChildren();

  state.graphEdges.forEach((edge) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("edge");
    line.dataset.source = edge.source;
    line.dataset.target = edge.target;
    edge.element = line;
    els.edgeLayer.append(line);
  });

  state.graphNodes.forEach((node) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("node");
    group.dataset.id = node.id;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${pageName(node)}, ${node.groupLabel}`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const radius = nodeRadius(node);
    circle.setAttribute("r", radius);
    circle.setAttribute("fill", groupColors[node.group] || groupColors["wiki-note"]);
    group.append(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const labelOnLeft = node.x > state.width * .72;
    const labelX = labelOnLeft ? -(radius + 5) : radius + 5;
    label.setAttribute("x", labelX);
    label.setAttribute("y", "-2");
    if (labelOnLeft) label.setAttribute("text-anchor", "end");
    const main = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    main.textContent = String(node.graphLabel || pageName(node)).slice(0, 29);
    label.append(main);
    const sub = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    sub.classList.add("node-label-sub");
    sub.setAttribute("x", labelX);
    sub.setAttribute("dy", "12");
    sub.textContent = node.kicker || node.groupLabel;
    label.append(sub);
    group.append(label);

    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!node.wasDragged) selectPage(node.id, true, false);
      node.wasDragged = false;
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPage(node.id, true, true);
      }
    });
    installNodeDrag(group, node);
    node.element = group;
    els.nodeLayer.append(group);
  });

  renderPositions();
  updateGraphState();
  applyTransform();
}

function renderPositions() {
  const nodeMap = new Map(state.graphNodes.map((node) => [node.id, node]));
  state.graphEdges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return;
    edge.element.setAttribute("x1", source.x);
    edge.element.setAttribute("y1", source.y);
    edge.element.setAttribute("x2", target.x);
    edge.element.setAttribute("y2", target.y);
  });
  state.graphNodes.forEach((node) => node.element.setAttribute("transform", `translate(${node.x} ${node.y})`));
}

function visibleNodeIds() {
  return new Set(state.pages
    .filter((page) => state.visibleGroups.has(page.group))
    .map((page) => page.id));
}

function updateGraphState() {
  if (!state.graphNodes.length) return;
  const visible = visibleNodeIds();
  const related = new Set([state.selectedId]);
  (state.adjacency.get(state.selectedId) || []).forEach(({ neighbor }) => related.add(neighbor));
  let visibleCount = 0;

  state.graphNodes.forEach((node) => {
    const isVisible = visible.has(node.id);
    let isDimmed = false;
    if (state.pathNodes.size) isDimmed = !state.pathNodes.has(node.id);
    else if (state.query) isDimmed = !state.searchMatches.has(node.id);
    else if (state.selectedId && state.selectedId !== "wiki/Stock Knowledge Wiki") isDimmed = !related.has(node.id);
    node.element.classList.toggle("hidden", !isVisible);
    node.element.classList.toggle("dim", isDimmed);
    node.element.classList.toggle("selected", node.id === state.selectedId);
    node.element.classList.toggle("path", state.pathNodes.has(node.id));
    if (isVisible && !isDimmed) visibleCount += 1;
  });

  state.graphEdges.forEach((edge) => {
    const isVisible = visible.has(edge.source) && visible.has(edge.target);
    const key = edgeKey(edge.source, edge.target);
    let isDimmed = false;
    if (state.pathNodes.size) isDimmed = !state.pathEdges.has(key);
    else if (state.query) isDimmed = !state.searchMatches.has(edge.source) || !state.searchMatches.has(edge.target);
    else if (state.selectedId && state.selectedId !== "wiki/Stock Knowledge Wiki") {
      isDimmed = edge.source !== state.selectedId && edge.target !== state.selectedId;
    }
    edge.element.classList.toggle("hidden", !isVisible);
    edge.element.classList.toggle("dim", isDimmed);
    edge.element.classList.toggle("focused", state.pathEdges.has(key) || (state.selectedId && (edge.source === state.selectedId || edge.target === state.selectedId)));
  });
  els.graphEmpty.hidden = visibleCount !== 0;
}

function addToTrail(id) {
  state.recentIds = [id, ...state.recentIds.filter((item) => item !== id)].slice(0, 8);
  renderTrail();
}

function renderTrail() {
  const pages = state.recentIds.map((id) => state.pageById.get(id)).filter(Boolean);
  els.trailStatus.textContent = pages.length ? `${pages.length} note${pages.length === 1 ? "" : "s"} in this session` : "Recently opened notes appear here";
  els.trailItems.innerHTML = pages.length
    ? pages.map((page) => `
        <button class="trail-item ${escapeHtml(page.group)}" type="button" data-id="${escapeHtml(page.id)}">
          <strong>${escapeHtml(pageName(page))}</strong>
          <span>${escapeHtml(page.kicker || page.groupLabel)}${page.updated ? ` · ${escapeHtml(formatDate(page.updated))}` : ""}</span>
        </button>
      `).join("")
    : '<div class="trail-empty">Your reading path will build as you explore.</div>';
}

function linkButton(id) {
  const page = state.pageById.get(id);
  if (!page) return "";
  return `<button type="button" data-id="${escapeHtml(id)}">${escapeHtml(pageName(page))}</button>`;
}

function renderConnections(page) {
  els.outboundCount.textContent = page.outboundLinks.length;
  els.backlinkCount.textContent = page.backlinks.length;
  els.outbound.innerHTML = page.outboundLinks.length
    ? page.outboundLinks.map(linkButton).join("")
    : '<div class="link-empty">No outbound links.</div>';
  els.backlinks.innerHTML = page.backlinks.length
    ? page.backlinks.map(linkButton).join("")
    : '<div class="link-empty">No backlinks.</div>';
}

function selectPage(id, updateHash = true, center = false) {
  const page = state.pageById.get(id);
  if (!page) return;
  state.selectedId = id;
  state.visibleGroups.add(page.group);
  const checkbox = els.filters.querySelector(`input[value="${CSS.escape(page.group)}"]`);
  if (checkbox) checkbox.checked = true;
  els.focus.textContent = pageName(page);
  els.readerGroup.textContent = page.groupLabel;
  els.readerTitle.textContent = pageName(page);
  els.readerMeta.textContent = `${page.path}${page.updated ? ` · updated ${formatDate(page.updated)}` : ""}`;
  els.readerBody.innerHTML = page.html;
  els.readerBody.scrollTop = 0;

  if (page.ticker) {
    els.readerTicker.hidden = false;
    els.readerTicker.textContent = page.ticker;
  } else {
    els.readerTicker.hidden = true;
    els.readerTicker.textContent = "";
  }

  renderConnections(page);
  addToTrail(id);
  renderSearch();
  updateGraphState();
  if (center) centerNode(id);
  if (updateHash && location.hash !== routeFor(id)) history.replaceState(null, "", routeFor(id));
}

function findPath(startId, endId) {
  const distances = new Map([[startId, 0]]);
  const previous = new Map([[startId, null]]);
  const pending = new Set(state.pages.map((page) => page.id));

  while (pending.size) {
    let current = null;
    let currentDistance = Infinity;
    pending.forEach((id) => {
      const distance = distances.get(id) ?? Infinity;
      if (distance < currentDistance) {
        current = id;
        currentDistance = distance;
      }
    });
    if (current === null || current === endId) break;
    pending.delete(current);

    for (const { neighbor } of state.adjacency.get(current) || []) {
      if (!pending.has(neighbor)) continue;
      const usesGlobalIndex = current === "wiki/Stock Knowledge Wiki" || neighbor === "wiki/Stock Knowledge Wiki";
      const candidate = currentDistance + (usesGlobalIndex ? 4 : 1);
      if (candidate < (distances.get(neighbor) ?? Infinity)) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, current);
      }
    }
  }
  if (!previous.has(endId)) return null;
  const nodes = [endId];
  let cursor = endId;
  while (cursor !== startId) {
    cursor = previous.get(cursor);
    nodes.push(cursor);
  }
  nodes.reverse();
  return {
    nodes,
    edges: nodes.slice(1).map((id, index) => edgeKey(nodes[index], id)),
  };
}

function tracePath() {
  const from = els.pathFrom.value;
  const to = els.pathTo.value;
  if (!from || !to) {
    els.pathStatus.textContent = "Choose both a starting note and a destination.";
    return;
  }
  const result = findPath(from, to);
  state.pathNodes.clear();
  state.pathEdges.clear();
  if (!result) {
    els.pathStatus.textContent = "No connection was found in the published graph.";
  } else {
    result.nodes.forEach((id) => {
      state.pathNodes.add(id);
      const page = state.pageById.get(id);
      if (page) state.visibleGroups.add(page.group);
    });
    result.edges.forEach((key) => state.pathEdges.add(key));
    const names = result.nodes.map((id) => pageName(state.pageById.get(id)));
    els.pathStatus.textContent = `${result.edges.length} hop${result.edges.length === 1 ? "" : "s"}: ${names.join(" → ")}`;
    renderFilters();
    selectPage(to, true, true);
  }
  updateGraphState();
}

function clearDiscoveryState() {
  state.query = "";
  state.searchMatches.clear();
  state.pathNodes.clear();
  state.pathEdges.clear();
  state.selectedId = null;
  state.visibleGroups = new Set(state.graph.groups.map((group) => group.id));
  els.search.value = "";
  els.pathFrom.value = "";
  els.pathTo.value = "";
  els.pathStatus.textContent = "Choose two notes to reveal the shortest link between them.";
  els.focus.textContent = "All published notes";
  renderFilters();
  renderSearch();
  resetTransform();
  const index = state.pageById.get("wiki/Stock Knowledge Wiki");
  if (index) selectPage(index.id, true, false);
}

function applyTransform() {
  els.viewport.setAttribute("transform", `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.scale})`);
  els.zoomReset.textContent = `${Math.round(state.transform.scale * 100)}%`;
}

function changeZoom(factor, origin = null) {
  const rect = els.svg.getBoundingClientRect();
  const point = origin || { x: rect.width / 2, y: rect.height / 2 };
  const oldScale = state.transform.scale;
  const newScale = Math.min(2.5, Math.max(.38, oldScale * factor));
  const worldX = (point.x - state.transform.x) / oldScale;
  const worldY = (point.y - state.transform.y) / oldScale;
  state.transform.x = point.x - worldX * newScale;
  state.transform.y = point.y - worldY * newScale;
  state.transform.scale = newScale;
  applyTransform();
}

function resetTransform() {
  state.transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
}

function centerNode(id) {
  const node = state.graphNodes.find((item) => item.id === id);
  if (!node) return;
  const rect = els.svg.getBoundingClientRect();
  state.transform.x = rect.width / 2 - node.x * state.transform.scale;
  state.transform.y = rect.height / 2 - node.y * state.transform.scale;
  applyTransform();
}

function installNodeDrag(element, node) {
  let drag = null;
  element.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    drag = { x: event.clientX, y: event.clientY, nx: node.x, ny: node.y, moved: false };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = (event.clientX - drag.x) / state.transform.scale;
    const dy = (event.clientY - drag.y) / state.transform.scale;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    node.x = drag.nx + dx;
    node.y = drag.ny + dy;
    node.vx = 0;
    node.vy = 0;
    renderPositions();
  });
  element.addEventListener("pointerup", () => {
    node.wasDragged = Boolean(drag?.moved);
    drag = null;
  });
}

function installPanAndZoom() {
  let pan = null;
  els.svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".node")) return;
    pan = { x: event.clientX, y: event.clientY, tx: state.transform.x, ty: state.transform.y };
    els.svg.setPointerCapture(event.pointerId);
  });
  els.svg.addEventListener("pointermove", (event) => {
    if (!pan) return;
    state.transform.x = pan.tx + event.clientX - pan.x;
    state.transform.y = pan.ty + event.clientY - pan.y;
    applyTransform();
  });
  els.svg.addEventListener("pointerup", () => { pan = null; });
  els.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = els.svg.getBoundingClientRect();
    changeZoom(event.deltaY < 0 ? 1.12 : .89, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });
}

function showConnectionPanel(panelId) {
  document.querySelectorAll(".connection-tab").forEach((tab) => {
    const active = tab.dataset.panel === panelId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  els.outbound.hidden = panelId !== "outboundLinks";
  els.backlinks.hidden = panelId !== "backlinks";
}

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim();
    renderSearch();
  });
  els.clearSearch.addEventListener("click", () => {
    state.query = "";
    els.search.value = "";
    renderSearch();
    els.search.focus();
  });
  els.searchResults.addEventListener("click", (event) => {
    const result = event.target.closest("[data-id]");
    if (result) selectPage(result.dataset.id, true, true);
  });
  els.filters.addEventListener("change", (event) => {
    const input = event.target.closest("input[type='checkbox']");
    if (!input) return;
    if (input.checked) state.visibleGroups.add(input.value);
    else state.visibleGroups.delete(input.value);
    updateGraphState();
  });
  els.findPath.addEventListener("click", tracePath);
  els.swapPath.addEventListener("click", () => {
    [els.pathFrom.value, els.pathTo.value] = [els.pathTo.value, els.pathFrom.value];
  });
  els.pathExamples.addEventListener("click", (event) => {
    const button = event.target.closest("[data-from][data-to]");
    if (!button) return;
    els.pathFrom.value = button.dataset.from;
    els.pathTo.value = button.dataset.to;
    tracePath();
  });
  els.reset.addEventListener("click", clearDiscoveryState);
  els.zoomIn.addEventListener("click", () => changeZoom(1.18));
  els.zoomOut.addEventListener("click", () => changeZoom(.84));
  els.zoomReset.addEventListener("click", resetTransform);
  els.trailItems.addEventListener("click", (event) => {
    const item = event.target.closest("[data-id]");
    if (item) selectPage(item.dataset.id, true, true);
  });
  document.addEventListener("click", (event) => {
    const wikiLink = event.target.closest("[data-wiki-link]");
    if (wikiLink) {
      event.preventDefault();
      selectPage(wikiLink.dataset.wikiLink, true, true);
      return;
    }
    const connection = event.target.closest(".link-list [data-id]");
    if (connection) selectPage(connection.dataset.id, true, true);
  });
  els.connectionTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-panel]");
    if (tab) showConnectionPanel(tab.dataset.panel);
  });
  window.addEventListener("hashchange", () => {
    const id = idFromHash();
    if (id && state.pageById.has(id)) selectPage(id, false, true);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      els.search.focus();
    }
    if (event.key === "Escape" && document.activeElement === els.search) {
      state.query = "";
      els.search.value = "";
      renderSearch();
      els.search.blur();
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resetTransform();
      renderGraph();
    }, 180);
  });
}

async function init() {
  const [graphResponse, searchResponse] = await Promise.all([
    fetch("data/graph.json", { cache: "no-store" }),
    fetch("data/search.json", { cache: "no-store" }),
  ]);
  if (!graphResponse.ok || !searchResponse.ok) throw new Error("Wiki data is unavailable");
  state.graph = await graphResponse.json();
  const search = await searchResponse.json();
  const searchById = new Map(search.records.map((record) => [record.id, record]));
  state.pages = state.graph.nodes.map((page) => ({ ...page, ...(searchById.get(page.id) || {}) }));
  state.visibleGroups = new Set(state.graph.groups.map((group) => group.id));
  buildIndexes();
  renderFilters();
  populatePathControls();
  renderTrail();
  renderGraph();
  installPanAndZoom();
  bindEvents();
  els.graphStats.textContent = `${state.graph.stats.pages} notes · ${state.graph.stats.links} links · ${state.graph.stats.stocks} stocks`;

  const routedId = idFromHash();
  const initialId = routedId && state.pageById.has(routedId) ? routedId : "wiki/Stock Knowledge Wiki";
  if (state.pageById.has(initialId)) selectPage(initialId, false, false);
}

init().catch((error) => {
  console.error(error);
  els.graphStats.textContent = "Wiki unavailable";
  els.graphEmpty.hidden = false;
  els.graphEmpty.textContent = "The published wiki data could not be loaded.";
  els.readerBody.innerHTML = '<p class="reader-placeholder">Rebuild the static wiki and reload this page.</p>';
});
