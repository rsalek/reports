# Equity Research Library

Public equity research reports, KPI dashboards, a generated stock knowledge wiki, and the operating guide for the local Equity Deep Dive workflow.

- [Live reports library](https://rsalek.github.io/reports/)
- [Equity Deep Dive help](https://rsalek.github.io/reports/help/)
- [KPI dashboards](https://rsalek.github.io/reports/#kpi)
- [Stock knowledge wiki](https://rsalek.github.io/reports/wiki/)

## Repository map

```text
reports/
├── index.html       # Public landing page and library navigation
├── docs/            # Full company research reports
├── kpi/             # KPI dashboards and linked thesis notes
├── wiki/            # Generated public wiki application and data
├── help/            # Equity Deep Dive operator guide
├── archive/         # Preserved earlier public pages
└── scripts/         # Wiki builder and viewer templates
```

## Published surfaces

### Reports

The `docs/` directory contains the complete company research reports linked from the landing page. Report cards should use repository-hosted HTML where possible and retain a separate GitHub source link.

### KPI dashboards

The `kpi/` directory contains decision-focused operating dashboards and concise thesis pages. Add new dashboards to the dedicated KPI section instead of mixing them into the full-report list.

### Stock knowledge wiki

The public wiki is generated from a maintained private Markdown source rather than edited directly in this repository.

```bash
WIKI_SOURCE="/path/to/private/wiki" npm run build:wiki
```

`WIKI_SOURCE` selects the source directory. `WIKI_OUT` is optional and defaults to this repository's `wiki/` directory:

```bash
WIKI_SOURCE="/path/to/private/wiki" \
WIKI_OUT="/path/to/output/wiki" \
npm run build:wiki
```

The builder publishes the viewer assets plus `wiki/data/graph.json` and `wiki/data/search.json`. Do not patch generated JSON directly; make durable content changes in the source wiki and rebuild.

### Equity Deep Dive help

The `help/` page explains how to run the Codex-native `$analyze-equity` workflow in the Investment workspace. It covers required files, recommended evidence, folder structure, the 14-prompt sequence, commands, resumable state, citations, validation, and publication safety.

## Local preview

Serve the repository root so relative links behave the same way they do on GitHub Pages:

```bash
python3 -m http.server 8766
```

Then open `http://127.0.0.1:8766/` and verify the landing page, `/help/`, `/wiki/`, and any changed report or dashboard at desktop and mobile widths.

Before publishing, check:

- Every local link resolves from an HTTP server, not only from the filesystem.
- Root navigation and hero actions reach the intended pages.
- Browser console output is clean.
- Tables and code blocks do not create page-level horizontal overflow at 390px.
- Landing metadata and library counts still match the published collection.

## Publishing

This is a static GitHub Pages repository. Commit only the intended public artifacts, push `main`, and wait for Pages propagation before treating an immediate 404 as a broken link.

When adding a new public artifact:

1. Put it in the appropriate directory.
2. Add structured navigation from `index.html`.
3. Update the title, description, and library counts only when the underlying collection changes.
4. Preview and link-check locally.
5. Push and confirm the final public URL returns HTTP 200.

## Publication safety

- Do not publish paid or licensed research documents unless publication rights are explicit.
- Do not publish raw source folders, credentials, tokens, private absolute paths, or internal-only notes.
- Keep the private Markdown wiki source outside this repository; publish only the generated, redacted output.
- Treat published analysis as research material, not personalized investment advice.
