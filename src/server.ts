/** Docky Inspector server: serves the UI and the layout API.
 *
 * Data source is Docky's snapshot file (written while its debug logging
 * is on). Run with `bun run dev`. No runtime dependencies beyond Bun.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { diffTiles, judge, type LayoutSnapshot, type LayoutTile } from "./layout";

const SNAPSHOT = join(homedir(), "Library/Logs/Docky/docky-layout.json");
const PORT = Number(process.env.PORT ?? 8901);
const HISTORY_LIMIT = 30;

interface HistoryEntry {
  id: number;
  time: string;
  summary: string;
  data: LayoutSnapshot;
}

let lastMtime = 0;
let prevTiles: LayoutTile[] = [];
let history: HistoryEntry[] = [];
let nextHistoryId = 1;

async function readSnapshot(): Promise<{ data: LayoutSnapshot; mtime: number } | null> {
  const file = Bun.file(SNAPSHOT);
  if (!(await file.exists())) return null;
  const mtime = Math.floor((await file.stat()).mtime.getTime() / 1000);
  const data = (await file.json()) as LayoutSnapshot;
  return { data, mtime };
}

function fmtTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(Bun.file(join(import.meta.dir, "..", "public", "index.html")), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/app.js") {
      const built = await Bun.build({
        entrypoints: [join(import.meta.dir, "..", "public", "app.ts")],
        target: "browser",
        minify: false,
      });
      if (!built.success) {
        return new Response(built.logs.join("\n"), { status: 500 });
      }
      return new Response(await built.outputs[0].text(), {
        headers: { "Content-Type": "text/javascript; charset=utf-8" },
      });
    }
    if (url.pathname === "/api/history") {
      return Response.json(history.map(({ id, time, summary }) => ({ id, time, summary })));
    }
    if (url.pathname === "/api/snapshot") {
      const entry = history.find((h) => h.id === Number(url.searchParams.get("id")));
      if (!entry) return new Response("unknown snapshot", { status: 404 });
      return Response.json({ data: entry.data, verdicts: judge(entry.data) });
    }
    if (url.pathname === "/api/layout") {
      const snap = await readSnapshot();
      if (!snap) return new Response("no snapshot (enable debug logging in Docky)", { status: 404 });
      const { data, mtime } = snap;
      let changed: string[] = [];
      let added: string[] = [];
      let removed: string[] = [];
      if (mtime !== lastMtime) {
        const d = diffTiles(prevTiles, data.tiles);
        changed = d.changed;
        added = d.added;
        removed = d.removed;
        prevTiles = data.tiles;
        lastMtime = mtime;
        history.unshift({
          id: nextHistoryId++,
          time: fmtTime(mtime * 1000),
          summary: `n=${data.tiles.length} Δ=${changed.length} +${added.length} -${removed.length}`,
          data,
        });
        history = history.slice(0, HISTORY_LIMIT);
      }
      return Response.json({
        signature: `${mtime}:${data.tiles.length}`,
        mtime: fmtTime(mtime * 1000),
        data,
        changed,
        added,
        removed,
        history: history.map(({ id, time, summary }) => ({ id, time, summary })),
        verdicts: judge(data),
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`Docky Inspector at http://127.0.0.1:${server.port}/`);
