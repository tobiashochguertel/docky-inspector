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
const ICON_CACHE = join(import.meta.dir, "..", ".icon-cache");
const ICON_SIZE = 256;

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

/** Bundle id from a dock tile id ("pinned:app:<bid>" or "pinned:<bid>"). */
function bundleIdFromTileId(id: string): string | null {
  if (!id.startsWith("pinned:")) return null;
  const rest = id.slice("pinned:".length);
  const bid = rest.startsWith("app:") ? rest.slice("app:".length) : rest;
  return /^[A-Za-z0-9.\-]+$/.test(bid) ? bid : null;
}

async function runWithTimeout(cmd: string[], timeoutMs: number): Promise<{ stdout: string } | null> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, timeoutMs);
    const stdout = await new Response(proc.stdout).text();
    clearTimeout(timer);
    await proc.exited;
    return { stdout };
  } catch {
    return null;
  }
}

/** Compiled geticon helper (built once from tools/geticon.swift). */
async function ensureIconHelper(): Promise<string | null> {
  const bin = join(ICON_CACHE, "geticon");
  if (await Bun.file(bin).exists()) return bin;
  const src = join(import.meta.dir, "..", "tools", "geticon.swift");
  if (!(await Bun.file(src).exists())) return null;
  try {
    await Bun.$`swiftc -O -o ${bin} ${src}`.quiet();
  } catch {
    return null;
  }
  return (await Bun.file(bin).exists()) ? bin : null;
}

/** Real bundle for a Spotlight result: follows Finder wrapper stubs
 * (`Foo.app/Wrapper/Foo.app`) whose outer bundle holds no Resources. */
async function resolveAppBundle(appPath: string): Promise<string | null> {
  const info = join(appPath, "Contents", "Info.plist");
  if (await Bun.file(info).exists()) return appPath;
  const glob = new Bun.Glob("Wrapper/*.app");
  try {
    for await (const name of glob.scan({ cwd: appPath })) {
      const inner = join(appPath, name, "Contents", "Info.plist");
      if (await Bun.file(inner).exists()) return join(appPath, name);
    }
  } catch {
    /* missing dir */
  }
  return null;
}

/** Real app icon PNG via LaunchServices (same source Docky renders),
 * cached forever. Falls back to bundle .icns extraction. Null when
 * unresolvable. */
async function appIcon(bid: string): Promise<string | null> {
  const safe = `${bid.replace(/[^A-Za-z0-9.\-]/g, "_")}@${ICON_SIZE}.png`;
  const cached = join(ICON_CACHE, safe);
  if (await Bun.file(cached).exists()) return cached;
  await Bun.$`mkdir -p ${ICON_CACHE}`.quiet();
  const helper = await ensureIconHelper();
  if (helper) {
    const rendered = await runWithTimeout([helper, bid, cached, String(ICON_SIZE)], 20000);
    if (rendered && (await Bun.file(cached).exists())) return cached;
  }
  const found = await runWithTimeout(["mdfind", `kMDItemCFBundleIdentifier == '${bid}'`], 15000);
  const appPath = found?.stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.endsWith(".app"));
  if (!appPath) return null;
  const bundle = await resolveAppBundle(appPath);
  if (!bundle) return null;
  const resources = join(bundle, "Contents", "Resources");
  const plist = await runWithTimeout(
    ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIconFile", join(bundle, "Contents", "Info.plist")],
    5000,
  );
  const candidates: string[] = [];
  const named = plist?.stdout.trim();
  if (named) {
    candidates.push(join(resources, named), join(resources, `${named}.icns`));
  }
  try {
    const glob = new Bun.Glob("*.icns");
    for await (const name of glob.scan({ cwd: resources })) {
      candidates.push(join(resources, name));
    }
  } catch {
    /* Resources dir missing */
  }
  const icns = await (async () => {
    for (const c of candidates) {
      if (await Bun.file(c).exists()) return c;
    }
    return null;
  })();
  if (!icns) return null;
  await Bun.$`mkdir -p ${ICON_CACHE}`.quiet();
  const converted = await runWithTimeout(
    ["sips", "-Z", String(ICON_SIZE), "-s", "format", "png", icns, "--out", cached],
    15000,
  );
  if (!converted || !(await Bun.file(cached).exists())) return null;
  return cached;
}

/** System artwork for non-app tiles (trash, generic folder). */
async function systemIcon(kind: string): Promise<string | null> {  const safe = `system-${kind}@${ICON_SIZE}.png`;
  const cached = join(ICON_CACHE, safe);
  if (await Bun.file(cached).exists()) return cached;
  const source =
    kind === "trash"
      ? "/System/Library/CoreServices/Dock.app/Contents/Resources/trashempty.png"
      : kind === "folder"
        ? "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericFolderIcon.icns"
        : null;
  if (!source || !(await Bun.file(source).exists())) return null;
  await Bun.$`mkdir -p ${ICON_CACHE}`.quiet();
  if (source.endsWith(".icns")) {
    const converted = await runWithTimeout(
      ["sips", "-Z", String(ICON_SIZE), "-s", "format", "png", source, "--out", cached],
      15000,
    );
    if (!converted || !(await Bun.file(cached).exists())) return null;
  } else {
    await Bun.write(cached, Bun.file(source));
  }
  return cached;
}

async function serveIcon(url: URL): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  let png: string | null = null;
  if (kind === "app") {
    const bid = bundleIdFromTileId(id);
    if (bid) png = await appIcon(bid);
  } else if (kind === "trash" || kind === "folder") {
    png = await systemIcon(kind);
  } else {
    return new Response("no resolvable icon for this kind", { status: 404 });
  }
  if (!png) return new Response("icon not found", { status: 404 });
  return new Response(Bun.file(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}

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
    if (url.pathname === "/api/icon") {
      try {
        return await serveIcon(url);
      } catch {
        return new Response("icon resolution failed", { status: 404 });
      }
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
