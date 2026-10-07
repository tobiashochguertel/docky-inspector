/** Docky Inspector client: live bar replica with guides, metrics, diffs. */

import { gapBetween, labelRowHeight, type LayoutSnapshot, type LayoutTile } from "../src/layout";

const SCALE = 2;

const COLORS: Record<string, string> = {
  app: "#3b82f6",
  appFolder: "#a855f7",
  min: "#f59e0b",
  folder: "#84cc16",
  trash: "#6b7280",
  divider: "#374151",
  launchpad: "#06b6d6",
  startMenu: "#ec4899",
  widget: "#14b8a6",
  smartStack: "#14b8a6",
  spacer: "#1f2937",
  flexSpacer: "#1f2937",
};

interface Envelope {
  signature: string;
  mtime: string;
  data: LayoutSnapshot;
  changed: string[];
  added: string[];
  removed: string[];
  history: { id: number; time: string; summary: string }[];
  verdicts: { heights: string; heightsOk: boolean; gaps: string; gapsOk: boolean; unlabeled: string[] };
}

const GUIDES = [
  { id: "g-top", label: "tile top" },
  { id: "g-icon", label: "icon bottom" },
  { id: "g-base", label: "label baseline ≈" },
  { id: "g-bot", label: "tile bottom" },
] as const;

const VIEW_TOGGLES = [
  { id: "v-icons", label: "real icons", on: false },
  { id: "v-sections", label: "section markers", on: true },
  { id: "v-padding", label: "padding boxes", on: true },
  { id: "v-gaps", label: "gap labels", on: false },
] as const;

type ViewId = (typeof VIEW_TOGGLES)[number]["id"];

const view: Record<ViewId, boolean> = {
  "v-icons": false,
  "v-sections": true,
  "v-padding": true,
  "v-gaps": false,
};

let lastSig = "";
let viewSnapshotId: number | null = null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** Section name for the marker strip under the bar. */
function sectionOf(kind: string): string {
  switch (kind) {
    case "app":
    case "launchpad":
    case "startMenu":
      return "pinned apps";
    case "appFolder":
      return "app folders";
    case "min":
      return "minimized";
    case "folder":
    case "trash":
      return "trailing";
    case "divider":
      return "‖";
    default:
      return kind;
  }
}

function renderBar(data: LayoutSnapshot, changed: string[], added: string[]): void {
  const tiles = data.tiles;
  const pad = data.padding ?? { v: 0, icon: 0 };
  const row = labelRowHeight(data.fontSize);
  const vertical = data.position === "left" || data.position === "right";
  const minC = Math.min(...tiles.map((t) => t.c - t.w / 2));
  const totalW = (Math.max(...tiles.map((t) => t.c + t.w / 2)) - minC) * SCALE;
  const maxH = Math.max(...tiles.map((t) => t.h)) * SCALE;
  const rowPx = row * SCALE;
  const fontPx = data.fontSize * SCALE;
  const barEl = document.getElementById("bar")!;
  barEl.style.width = `${totalW}px`;
  barEl.style.height = `${maxH}px`;

  const tilesHtml = tiles
    .map((t, i) => {
      const x = (t.c - t.w / 2 - minC) * SCALE;
      const w = t.w * SCALE;
      const h = t.h * SCALE;
      const col = COLORS[t.kind] ?? "#9ca3af";
      const flag = changed.includes(t.id) ? " changed" : added.includes(t.id) ? " added" : "";
      const name = esc(t.label || t.id.split(":").pop()!.slice(0, 14));
      const iconInner =
        view["v-icons"] && (t.kind === "app" || t.kind === "trash" || t.kind === "folder")
          ? `<div class="icon" style="height:${h - rowPx}px;background:${col}55;border:1px solid ${col}"><img src="/api/icon?id=${encodeURIComponent(t.id)}&kind=${t.kind}" style="width:100%;height:100%;object-fit:contain" onerror="this.remove()" alt=""><span class="kind">${esc(t.kind)}</span></div>`
          : `<div class="icon" style="height:${h - rowPx}px;background:${col}55;border:1px solid ${col}"><span class="kind">${esc(t.kind)}</span></div>`;
      const padBox =
        view["v-padding"] && pad.v > 0
          ? vertical
            ? `<div class="padbox" style="top:0;bottom:0;left:${pad.v * SCALE}px;right:${pad.v * SCALE}px"></div>`
            : `<div class="padbox" style="top:${pad.v * SCALE}px;bottom:${pad.v * SCALE}px;left:0;right:0"></div>`
          : "";
      return (
        `<div class="tile${flag}" data-i="${i}" style="left:${x.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px" title="${esc(t.id)}">` +
        iconInner +
        `<div class="tlabel" style="height:${rowPx}px;font-size:${fontPx}px">${name}</div>` +
        padBox +
        `</div>`
      );
    })
    .join("");

  const gapsHtml = view["v-gaps"]
    ? tiles
        .slice(0, -1)
        .map((t, i) => {
          const n = tiles[i + 1];
          const gap = gapBetween(t, n);
          const x = (n.c - n.w / 2 - minC) * SCALE;
          return `<div class="gap" style="left:${x}px">${gap.toFixed(1)}</div>`;
        })
        .join("")
    : "";

  const sectionsHtml = view["v-sections"] ? sectionsStrip(tiles, minC) : "";

  barEl.innerHTML =
    `<div class="gline" id="g-top" style="top:0"></div>` +
    `<div class="gline" id="g-icon" style="top:${maxH - rowPx}px"></div>` +
    `<div class="gline" id="g-base" style="top:${maxH - rowPx + fontPx * 0.8}px"></div>` +
    `<div class="gline" id="g-bot" style="top:${maxH - 1}px"></div>` +
    tilesHtml +
    gapsHtml +
    sectionsHtml;
  applyGuideVisibility();
  barEl.querySelectorAll<HTMLElement>(".tile").forEach((node) => {
    node.onclick = () => selectTile(tiles, Number(node.dataset.i));
  });
}

/** Marker strip under the bar: labeled spans per consecutive section. */
function sectionsStrip(tiles: LayoutTile[], minC: number): string {
  const runs: { section: string; x0: number; x1: number }[] = [];
  for (const t of tiles) {
    const s = sectionOf(t.kind);
    const x0 = (t.c - t.w / 2 - minC) * SCALE;
    const x1 = (t.c + t.w / 2 - minC) * SCALE;
    const last = runs[runs.length - 1];
    if (last && last.section === s) last.x1 = x1;
    else runs.push({ section: s, x0, x1 });
  }
  const spans = runs
    .map(
      (r) =>
        `<span class="sec" style="left:${r.x0.toFixed(1)}px;width:${Math.max(0, r.x1 - r.x0).toFixed(1)}px">${esc(r.section)}</span>`,
    )
    .join("");
  return `<div id="sections">${spans}</div>`;
}

function applyGuideVisibility(): void {
  document.querySelectorAll<HTMLInputElement>("input.guide").forEach((cb) => {
    const line = document.getElementById(cb.dataset.guide!);
    if (line) line.style.display = cb.checked ? "" : "none";
  });
}

function selectTile(tiles: LayoutTile[], i: number): void {
  document.querySelectorAll(".tile").forEach((e) => e.classList.remove("sel"));
  document.querySelector(`.tile[data-i="${i}"]`)?.classList.add("sel");
  const t = tiles[i];
  const n = tiles[i + 1];
  const gap = n ? `${gapBetween(t, n).toFixed(1)}pt` : "—";
  document.getElementById("metrics")!.textContent =
    `id: ${t.id}\nkind: ${t.kind}\nw×h: ${t.w}×${t.h}\ncenter: ${t.c}\nlabel: ${t.label || "(none)"}\ngap→next: ${gap}`;
}

function renderMeta(env: Envelope): void {
  const v = env.verdicts;
  document.getElementById("verdicts")!.innerHTML =
    `heights: <span class="${v.heightsOk ? "verdict-ok" : "verdict-bad"}">${esc(v.heights)}</span> · ` +
    `gaps: <span class="${v.gapsOk ? "verdict-ok" : "verdict-bad"}">${esc(v.gaps)}</span> · ` +
    `${env.data.tiles.length} tiles · snapshot ${esc(env.mtime)}` +
    (v.unlabeled.length > 0 ? ` · unlabeled: ${esc(v.unlabeled.join(", "))}` : "");
  const hist = env.history
    .map((h) => `<div data-h="${h.id}">${esc(h.time)} — ${esc(h.summary)}</div>`)
    .join("");
  document.getElementById("hist")!.innerHTML = hist || "no history yet";
  document.getElementById("hist")!.querySelectorAll("[data-h]").forEach((node) => {
    (node as HTMLElement).onclick = async () => {
      const id = (node as HTMLElement).dataset.h!;
      const snap = (await (await fetch(`/api/snapshot?id=${id}`)).json()) as {
        data: LayoutSnapshot;
        verdicts: Envelope["verdicts"];
      };
      viewSnapshotId = Number(id);
      document.getElementById("viewing")!.textContent = `— viewing #${id} (read-only)`;
      renderBar(snap.data, [], []);
    };
  });
}

async function poll(): Promise<void> {
  try {
    const res = await fetch("/api/layout");
    const env = (await res.json()) as Envelope;
    const live = document.getElementById("live")!;
    live.textContent = "● live";
    live.style.color = "#22c55e";
    if (env.signature !== lastSig) {
      lastSig = env.signature;
      if (viewSnapshotId === null) {
        renderBar(env.data, env.changed, env.added);
        renderMeta(env);
      }
    }
  } catch {
    const live = document.getElementById("live")!;
    live.textContent = "● no snapshot (enable debug logging in Docky)";
    live.style.color = "#f87171";
  }
  setTimeout(poll, 500);
}

const PANEL_POS_KEY = "docky-inspector-panel-pos";

/** Draggable metrics modal: drag by the header, position persists. */
function initPanel(): void {
  const panel = document.getElementById("panel")!;
  const head = document.getElementById("panel-head")!;
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_POS_KEY) ?? "null") as {
      x: number;
      y: number;
    } | null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      panel.style.left = `${saved.x}px`;
      panel.style.top = `${saved.y}px`;
      panel.style.right = "auto";
    }
  } catch {
    /* fresh start */
  }
  document.getElementById("live-btn")!.onclick = () => {
    viewSnapshotId = null;
    document.getElementById("viewing")!.textContent = "";
  };
  head.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    head.setPointerCapture(down.pointerId);
    const rect = panel.getBoundingClientRect();
    const dx = down.clientX - rect.left;
    const dy = down.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - 60);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40);
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = "auto";
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop }));
      } catch {
        /* private mode */
      }
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });
}

function initControls(): void {
  initPanel();
  document.getElementById("guides")!.innerHTML =
    GUIDES.map((g) => `<label><input type="checkbox" class="guide" data-guide="${g.id}" checked> ${g.label}</label>`).join("") +
    VIEW_TOGGLES.map(
      (t) => `<label><input type="checkbox" class="view" data-view="${t.id}"${t.on ? " checked" : ""}> ${t.label}</label>`,
    ).join("");
  document.querySelectorAll<HTMLInputElement>("input.guide").forEach((cb) => {
    cb.onchange = applyGuideVisibility;
  });
  document.querySelectorAll<HTMLInputElement>("input.view").forEach((cb) => {
    cb.onchange = () => {
      view[cb.dataset.view as ViewId] = cb.checked;
      lastSig = "";
    };
  });
}

initControls();
void poll();
