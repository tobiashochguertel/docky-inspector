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

let lastSig = "";
let viewSnapshotId: number | null = null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function renderBar(data: LayoutSnapshot, changed: string[], added: string[]): void {
  const tiles = data.tiles;
  const row = labelRowHeight(data.fontSize);
  const minC = Math.min(...tiles.map((t) => t.c - t.w / 2));
  const totalW = (Math.max(...tiles.map((t) => t.c + t.w / 2)) - minC) * SCALE;
  const maxH = Math.max(...tiles.map((t) => t.h)) * SCALE;
  const rowPx = row * SCALE;
  const fontPx = data.fontSize * SCALE;
  const barEl = document.getElementById("bar")!;
  barEl.style.width = `${totalW}px`;
  barEl.style.height = `${maxH}px`;
  barEl.innerHTML =
    `<div class="gline" id="g-top" style="top:0"></div>` +
    `<div class="gline" id="g-icon" style="top:${maxH - rowPx}px"></div>` +
    `<div class="gline" id="g-base" style="top:${maxH - rowPx + fontPx * 0.8}px"></div>` +
    `<div class="gline" id="g-bot" style="top:${maxH - 1}px"></div>` +
    tiles
      .map((t, i) => {
        const x = (t.c - t.w / 2 - minC) * SCALE;
        const w = t.w * SCALE;
        const h = t.h * SCALE;
        const col = COLORS[t.kind] ?? "#9ca3af";
        const flag = changed.includes(t.id) ? " changed" : added.includes(t.id) ? " added" : "";
        const name = esc(t.label || t.id.split(":").pop()!.slice(0, 14));
        return (
          `<div class="tile${flag}" data-i="${i}" style="left:${x.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px" title="${esc(t.id)}">` +
          `<div class="icon" style="height:${h - rowPx}px;background:${col}55;border:1px solid ${col}"><span class="kind">${esc(t.kind)}</span></div>` +
          `<div class="tlabel" style="height:${rowPx}px;font-size:${fontPx}px">${name}</div></div>`
        );
      })
      .join("");
  applyGuideVisibility();
  barEl.querySelectorAll<HTMLElement>(".tile").forEach((node) => {
    node.onclick = () => selectTile(data.tiles, Number(node.dataset.i));
  });
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
  document.getElementById("panel")!.textContent =
    `id: ${t.id}\nkind: ${t.kind}\nw×h: ${t.w}×${t.h}\ncenter: ${t.c}\nlabel: ${t.label || "(none)"}\ngap→next: ${gap}`;
}

function renderMeta(env: Envelope): void {
  const v = env.verdicts;
  document.getElementById("verdicts")!.innerHTML =
    `heights: <span class="${v.heightsOk ? "verdict-ok" : "verdict-bad"}">${esc(v.heights)}</span> · ` +
    `gaps: <span class="${v.gapsOk ? "verdict-ok" : "verdict-bad"}">${esc(v.gaps)}</span> · ` +
    `${env.data.tiles.length} tiles · snapshot ${esc(env.mtime)}` +
    (v.unlabeled.length > 0 ? ` · unlabeled: ${esc(v.unlabeled.join(", "))}` : "");
  const panel = document.getElementById("panel")!;
  const hist = env.history
    .map((h) => `<div data-h="${h.id}">${esc(h.time)} — ${esc(h.summary)}</div>`)
    .join("");
  panel.innerHTML =
    `<div><button id="live-btn">● back to live</button></div>` +
    `<div class="hist">${hist || "no history yet"}</div>`;
  document.getElementById("live-btn")!.onclick = () => {
    viewSnapshotId = null;
    document.getElementById("viewing")!.textContent = "";
  };
  panel.querySelectorAll("[data-h]").forEach((node) => {
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

function initGuides(): void {
  document.getElementById("guides")!.innerHTML = GUIDES.map(
    (g) => `<label><input type="checkbox" class="guide" data-guide="${g.id}" checked> ${g.label}</label>`,
  ).join("");
  document.querySelectorAll<HTMLInputElement>("input.guide").forEach((cb) => {
    cb.onchange = applyGuideVisibility;
  });
}

initGuides();
void poll();
