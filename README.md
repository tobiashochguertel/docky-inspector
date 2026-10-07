# Docky Inspector

Live layout inspector for [Docky](https://github.com/tobiashochguertel/docky)'s dock bar.
Bun + TypeScript, zero runtime dependencies.

## How it works

Docky emits a machine-readable layout snapshot while its debug logging is on:

```
~/Library/Logs/Docky/docky-layout.json
```

This project only consumes that file — the JSON shape in `src/layout.ts`
is the entire contract between the two projects. Enable the source with
`mise run docky:debug-on` (or Settings → Support → Debug) inside the
Docky repo.

## Run

```sh
bun install
bun run dev      # serves http://127.0.0.1:8901/ (set PORT= to change)
```

## Features

- 2x bar replica with per-kind colors and real label text
- Toggleable alignment guides (tile top, icon bottom, label baseline ≈, tile bottom)
- Click any tile for id, kind, size, center, label, gap-to-next
- Snapshot history with changed/added/removed highlighting; click to view read-only
- Uniformity verdicts (heights, gaps, missing labels) computed from the same
  shared code (`src/layout.ts`) on both server and client
- JSON API for agents/scripts: `GET /api/layout`, `GET /api/history`,
  `GET /api/snapshot?id=<n>`
