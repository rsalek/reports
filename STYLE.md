# BiotechVision public report design

Use the BiotechVision report design for every document published to the [reports library](https://biotechvision.co.uk/reports/) or [research library](https://biotechvision.co.uk/research/).

- The [document stylesheet](assets/report.css) owns report typography, brand colours, wordmark, responsive layout refinements and focus styling. It uses self-hosted Barlow, plum accents and neutral document surfaces.
- The [library stylesheet](assets/library.css) styles both indexes. Maintain shared styles here so the two libraries stay aligned.
- Keep report content and charts in standalone HTML. Keep semantic colours for decision states, tables, source links, working anchor IDs, disclosures and print styles.
- For new thematic articles, start with the [research report template](templates/research-report.html). For new documents, keep the existing content structure for the report family. Public equity reports use the company layout, KPI monitors use the dashboard layout and narrative theses use the thesis layout. Thematic articles use the research layout, and chart-led commodity monitors can use a report hero inside `main.page`.
- Build a Reports checkout with `node scripts/build-library.mjs`. It rebuilds the manifest-driven index and applies the design to HTML under `docs/`, `kpi/`, `thesis/` and `archive/`. In the Research checkout, `sh scripts/build-research.sh` styles standalone articles and builds their library entries from article metadata.
- The Pages deployment repeats these checks and transformations after every push to `main`, including uploads made outside the usual authoring workflow. Research authors supply the article title, description and evidence cut-off in its HTML head. The library links new files automatically. Check the live article and index at desktop and mobile widths.
