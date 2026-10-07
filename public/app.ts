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
  { id: "v-icons", label: "real icons", on: true },
  { id: "v-sections", label: "section markers", on: true },
  { id: "v-padding", label: "padding boxes", on: true },
  { id: "v-gaps", label: "gap labels", on: false },
  { id: "v-numbers", label: "tile numbers", on: true },
] as const;

type ViewId = (typeof VIEW_TOGGLES)[number]["id"];

const view: Record<ViewId, boolean> = {
  "v-icons": true,
  "v-sections": true,
  "v-padding": true,
  "v-gaps": false,
  "v-numbers": true,
};

let lastSig = "";
let viewSnapshotId: number | null = null;

interface InspectorMeta {
  position: string;
  fontSize: number;
  placement: string;
  tileW: number;
  tileH: number;
  spacing: number;
  scale: number;
  vPad: number;
  iconPad: number;
  mtime: string;
}

let lastMeta: InspectorMeta | null = null;
let lastTotalW = 0;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** Icon URL for a tile, mirroring the bar's resolution (null = none). */
function iconSrcFor(t: LayoutTile): string | null {
  if (t.kind === "app") return `/api/icon?id=${encodeURIComponent(t.id)}&kind=app`;
  if (t.kind === "appFolder" && t.apps?.length)
    return `/api/icon?kind=appFolder&bids=${encodeURIComponent(t.apps.join(","))}`;
  if (t.kind === "min" && t.bundle) return `/api/icon?kind=min&bid=${encodeURIComponent(t.bundle)}`;
  if (t.kind === "trash" || t.kind === "folder") return `/api/icon?kind=${t.kind}`;
  return null;
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
  lastTotalW = totalW / SCALE;
  lastMeta = {
    position: data.position,
    fontSize: data.fontSize,
    placement: data.placement,
    tileW: data.tile[0],
    tileH: data.tile[1],
    spacing: data.spacing,
    scale: data.scale,
    vPad: data.padding?.v ?? 0,
    iconPad: data.padding?.icon ?? 0,
    mtime: lastMeta?.mtime ?? "",
  };
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
      const iconSrc = view["v-icons"] ? iconSrcFor(t) : null;
      const iconInner =
        iconSrc
          ? `<div class="icon" style="height:${h - rowPx}px;background:${col}55;border:1px solid ${col}"><img src="${iconSrc}" style="width:100%;height:100%;object-fit:contain${t.kind === "min" ? ";opacity:.75" : ""}" onload="this.nextElementSibling.style.display='none'" onerror="this.remove()" alt=""><span class="kind">${esc(t.kind)}</span></div>`
          : `<div class="icon" style="height:${h - rowPx}px;background:${col}55;border:1px solid ${col}"><span class="kind">${esc(t.kind)}</span></div>`;
      const padBox =
        view["v-padding"] && pad.v > 0
          ? vertical
            ? `<div class="padbox" style="top:0;bottom:0;left:${pad.v * SCALE}px;right:${pad.v * SCALE}px"></div>`
            : `<div class="padbox" style="top:${pad.v * SCALE}px;bottom:${pad.v * SCALE}px;left:0;right:0"></div>`
          : "";
      return (
        `<div class="tile${flag}" data-i="${i}" style="left:${x.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px" title="${esc(t.id)}">` +
        (view["v-numbers"] ? `<span class="idx">${i + 1}</span>` : "") +
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
  document.querySelectorAll(".xray").forEach((e) => e.remove());
  const node = document.querySelector(`.tile[data-i="${i}"]`);
  node?.classList.add("sel");
  const t = tiles[i];
  if (node && lastMeta) renderXray(node as HTMLElement, t);
  document.getElementById("metrics")!.innerHTML = tileInspector(tiles, i);
  wireGroups();
}

/** Draws the icon/label boxes with per-side gap values onto the
 *  selected tile, so the space between icon and tile edge is readable
 *  in place. Icon is smaller than the tile — the gaps are the point. */
function renderXray(tileEl: HTMLElement, t: LayoutTile): void {
  const meta = lastMeta;
  if (!meta) return;
  const els = elementBoxes(t, meta);
  const f = (n: number): string => (Math.round(n * 10) / 10).toString();
  const box = (
    r: { x: number; y: number; w: number; h: number },
    m: { t: number; r: number; b: number; l: number },
    cls: string,
  ): string =>
    `<div class="xray ${cls}" style="left:${r.x * SCALE}px;top:${r.y * SCALE}px;width:${r.w * SCALE}px;height:${r.h * SCALE}px">` +
    `<span class="xtag" style="top:-1px;left:50%;transform:translate(-50%,-100%)">${f(m.t)}</span>` +
    `<span class="xtag" style="right:-1px;top:50%;transform:translate(100%,-50%)">${f(m.r)}</span>` +
    `<span class="xtag" style="bottom:-1px;left:50%;transform:translate(-50%,100%)">${f(m.b)}</span>` +
    `<span class="xtag" style="left:-1px;top:50%;transform:translate(-100%,-50%)">${f(m.l)}</span></div>`;
  const iw = els.icon.content[0];
  const ih = els.icon.content[1];
  const iconR = { x: els.icon.margin.l, y: els.icon.margin.t, w: iw, h: ih };
  let html = box(iconR, els.icon.margin, "x-icon");
  if (t.paintM && (Math.abs(t.paintM[0] - iw) > 0.5 || Math.abs(t.paintM[1] - ih) > 0.5)) {
    const pw = t.paintM[0];
    const ph = t.paintM[1];
    const px = iconR.x + (iw - pw) / 2;
    const py = iconR.y + (ih - ph) / 2;
    html += `<div class="xray x-paint" title="painted ${f(pw)}×${f(ph)}" style="left:${px * SCALE}px;top:${py * SCALE}px;width:${pw * SCALE}px;height:${ph * SCALE}px"></div>`;
  }
  if (els.title) {
    const tw = els.title.content[0];
    const th = els.title.content[1];
    const labelR = { x: els.title.margin.l, y: els.title.margin.t, w: tw, h: th };
    html += box(labelR, els.title.margin, "x-label");
  }
  tileEl.insertAdjacentHTML("beforeend", html);
}

const GROUP_STATE_KEY = "docky-inspector-groups";

function groupOpen(name: string, fallback: boolean): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUP_STATE_KEY) ?? "{}") as Record<string, boolean>;
    return name in saved ? saved[name] : fallback;
  } catch {
    return fallback;
  }
}

/** DevTools-style box model + grouped properties for one tile. */
interface SideVals {
  t: number;
  r: number;
  b: number;
  l: number;
}

interface ElBox {
  content: [number, number];
  padding: SideVals;
  margin: SideVals;
}

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const zeroSides: SideVals = { t: 0, r: 0, b: 0, l: 0 };

/** Shared nested box-model diagram (Docky tiles have no border). */
function boxDiagram(m: SideVals, p: SideVals, cw: number, ch: number, approx: boolean): string {
  const sides = (v: SideVals): string =>
    `<span class="bm-v" style="top:2px">${f1(v.t)}</span>` +
    `<span class="bm-h" style="right:2px">${f1(v.r)}</span>` +
    `<span class="bm-v" style="bottom:2px">${f1(v.b)}</span>` +
    `<span class="bm-h" style="left:2px">${f1(v.l)}</span>`;
  return (
    `<div class="bm"><div class="bm-margin"><span class="bm-tag">margin</span>` +
    sides(m) +
    `<div class="bm-border"><span class="bm-tag">border</span>` +
    sides(zeroSides) +
    `<div class="bm-padding"><span class="bm-tag">padding</span>` +
    sides(p) +
    `<div class="bm-content">${f1(cw)}×${f1(ch)}${approx ? " ≈" : ""}</div>` +
    `</div></div></div></div>`
  );
}

/** Margin-focused visual: content box with per-side gap values only,
 *  for the dedicated Gaps sections. */
function gapsDiagram(m: SideVals, cw: number, ch: number): string {
  const sides = (v: SideVals): string =>
    `<span class="bm-v" style="top:2px">${f1(v.t)}</span>` +
    `<span class="bm-h" style="right:2px">${f1(v.r)}</span>` +
    `<span class="bm-v" style="bottom:2px">${f1(v.b)}</span>` +
    `<span class="bm-h" style="left:2px">${f1(v.l)}</span>`;
  return (
    `<div class="bm"><div class="bm-margin"><span class="bm-tag">margin</span>` +
    sides(m) +
    `<div class="bm-content">${f1(cw)}×${f1(ch)}</div>` +
    `</div></div>`
  );
}

let measureCanvas: HTMLCanvasElement | null = null;

/** Measured text extents with the inspector's font stack. */
function measureLabel(text: string, fontSize: number): { w: number; h: number } {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx || !text) return { w: 0, h: 0 };
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  const m = ctx.measureText(text);
  return {
    w: m.width,
    h: (m.actualBoundingBoxAscent ?? fontSize * 0.8) + (m.actualBoundingBoxDescent ?? fontSize * 0.2),
  };
}

/** Icon/title boxes with margins measured to the tile edge, so the parts
 *  always sum to the tile frame. Icon content is approximate (aspect-fit
 *  may letterbox inside its slot). */
function elementBoxes(
  t: LayoutTile,
  meta: InspectorMeta,
): { icon: ElBox; title: ElBox | null } {
  const W = t.w;
  const H = t.h;
  const ip = meta.iconPad;
  const vPad = meta.vPad;
  const vertical = meta.position === "left" || meta.position === "right";
  const cT = !vertical ? vPad : 0;
  const cB = !vertical ? vPad : 0;
  const cL = vertical ? vPad : 0;
  const cR = vertical ? vPad : 0;
  const labelH = Math.ceil(meta.fontSize * 1.2);
  const gap = 2; // TileLabelMetrics.spacing, mirrored from Docky
  interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const cx = ip + cL;
  const cy = ip + cT;
  const cw = W - 2 * ip - cL - cR;
  const ch = H - 2 * ip - cT - cB;
  let iconR: Rect;
  let labelR: Rect | null = null;
  if (meta.placement === "above" || meta.placement === "below") {
    if (!t.label) {
      iconR = { x: cx, y: cy, w: cw, h: ch };
    } else if (meta.placement === "below") {
      iconR = { x: cx, y: cy, w: cw, h: ch - labelH - gap };
      labelR = { x: cx, y: cy + ch - labelH, w: cw, h: labelH };
    } else {
      labelR = { x: cx, y: cy, w: cw, h: labelH };
      iconR = { x: cx, y: cy + labelH + gap, w: cw, h: ch - labelH - gap };
    }
  } else {
    const tm0 = measureLabel(t.label, meta.fontSize);
    const slot = t.label ? Math.min(Math.ceil(tm0.w), 96) : 0;
    if (!t.label) {
      iconR = { x: cx, y: cy, w: cw, h: ch };
    } else if (meta.placement === "trailing") {
      iconR = { x: cx, y: cy, w: cw - slot - gap, h: ch };
      labelR = { x: cx + cw - slot, y: cy, w: slot, h: ch };
    } else {
      labelR = { x: cx, y: cy, w: slot, h: ch };
      iconR = { x: cx + slot + gap, y: cy, w: cw - slot - gap, h: ch };
    }
  }
  const margins = (r: Rect): SideVals => ({
    t: r.y,
    l: r.x,
    b: H - (r.y + r.h),
    r: W - (r.x + r.w),
  });
  const icon: ElBox = { content: [iconR.w, iconR.h], padding: { ...zeroSides }, margin: margins(iconR) };
  let title: ElBox | null = null;
  if (labelR && t.label) {
    const tm = measureLabel(t.label, meta.fontSize);
    const tw = Math.min(tm.w, Math.max(0, labelR.w - 4));
    const padH = Math.max(0, (labelR.w - tw) / 2);
    const padV = Math.max(0, (labelR.h - tm.h) / 2);
    title = {
      content: [tw, tm.h],
      padding: { t: padV, r: padH, b: padV, l: padH },
      margin: margins(labelR),
    };
  }
  return { icon, title };
}

function tileInspector(tiles: LayoutTile[], i: number): string {
  const t = tiles[i];
  const meta = lastMeta;
  const prev = tiles[i - 1];
  const next = tiles[i + 1];
  const x0 = t.c - t.w / 2;
  const x1 = t.c + t.w / 2;
  const mBefore = prev ? x0 - (prev.c + prev.w / 2) : x0;
  const mAfter = next ? next.c - next.w / 2 - x1 : lastTotalW - x1;
  const vertical = meta ? meta.position === "left" || meta.position === "right" : false;
  const vPad = meta?.vPad ?? 0;
  const tilePad: SideVals = vertical
    ? { t: 0, r: vPad, b: 0, l: vPad }
    : { t: vPad, r: 0, b: vPad, l: 0 };
  const tileMargin: SideVals = vertical
    ? { t: mBefore, r: 0, b: mAfter, l: 0 }
    : { t: 0, r: mAfter, b: 0, l: mBefore };
  const gapNext = next ? `${gapBetween(t, next).toFixed(1)}pt` : "—";
  const rows = (pairs: [string, string][]): string =>
    `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const group = (name: string, fallback: boolean, inner: string): string =>
    `<details${groupOpen(name, fallback) ? " open" : ""} data-group="${name}"><summary>${name}</summary>${inner}</details>`;
  const els = meta ? elementBoxes(t, meta) : null;
  const iconSrc = iconSrcFor(t);
  const slotW = els ? els.icon.content[0] : 0;
  const slotH = els ? els.icon.content[1] : 0;
  const gapsGroup = (name: string, m: SideVals, cw: number, ch: number): string =>
    `<details${groupOpen(name, true) ? " open" : ""} data-group="${name}"><summary>Gaps</summary>` +
    gapsDiagram(m, cw, ch) +
    `</details>`;
  const iconChild = `
    <details${groupOpen("Tile › Icon", true) ? " open" : ""} data-group="Tile › Icon"><summary>Icon</summary>
      ${els ? boxDiagram(els.icon.margin, els.icon.padding, els.icon.content[0], els.icon.content[1], true) : ""}
      ${iconSrc ? `<div class="prev"><img src="${iconSrc}" onload="iconLoaded(this)" data-slot-w="${slotW}" data-slot-h="${slotH}" onerror="this.parentElement.style.display='none'" alt=""></div>` : ""}
      ${rows([
        ["painted", t.paintM ? `${f1(t.paintM[0])}×${f1(t.paintM[1])}` : "…"],
        ["slot", t.iconM ? `${f1(t.iconM[0])}×${f1(t.iconM[1])}` : "…"],
        ["artwork", `<span class="dim-art">…</span>`],
        ["transparent t/r/b/l", `<span class="dim-tr">…</span>`],
        ["inspector", "64×64"],
        ["source", `<span class="dim-src">…</span>`],
      ])}
      ${els ? gapsGroup("Tile › Icon › Gaps", els.icon.margin, els.icon.content[0], els.icon.content[1]) : ""}
    </details>`;
  const titleChild = `
    <details${groupOpen("Tile › Title", true) ? " open" : ""} data-group="Tile › Title"><summary>Title</summary>
      ${els?.title ? boxDiagram(els.title.margin, els.title.padding, els.title.content[0], els.title.content[1], false) : ""}
      ${rows([
        ["text", t.label || "(none)"],
        ["measured", t.labelM ? `${f1(t.labelM[0])}×${f1(t.labelM[1])}` : "…"],
        ["placement", meta?.placement ?? "?"],
        ["font size", `${meta?.fontSize ?? 0}pt`],
        ["row height", meta ? `${f1(labelRowHeight(meta.fontSize))}pt` : "?"],
      ])}
      ${els?.title ? gapsGroup("Tile › Title › Gaps", els.title.margin, els.title.content[0], els.title.content[1]) : ""}
    </details>`;
  return (
    boxDiagram(tileMargin, tilePad, t.w, t.h, false) +
    `<div class="props">` +
    group("Box", true, rows([
      ["frame", `${f1(x0)} … ${f1(x1)} (w ${f1(t.w)}, h ${f1(t.h)})`],
      ["center", `${f1(t.c)}`],
      ["margin before / after", `${f1(mBefore)} / ${f1(mAfter)}pt`],
      ["padding v / icon", `${f1(vPad)} / ${f1(meta?.iconPad ?? 0)}pt`],
      ["gap → next", gapNext],
    ])) +
    group("Tile", true, rows([
      ["#", `${i + 1} of ${tiles.length}`],
      ["id", t.id],
      ["kind", t.kind],
      ["section", sectionOf(t.kind)],
    ]) + iconChild + titleChild) +
    group("Dock", false, rows([
      ["position", meta?.position ?? "?"],
      ["base tile", meta ? `${meta.tileW}×${meta.tileH}` : "?"],
      ["spacing / scale", `${meta?.spacing ?? "?"} / ${meta?.scale ?? "?"}`],
      ["snapshot", meta?.mtime ?? "?"],
    ])) +
    `</div>`
  );
}

/** Visible (non-transparent) bounds of loaded artwork, plus overlay. */
function iconLoaded(img: HTMLImageElement): void {
  const prev = img.closest(".prev");
  const art = prev?.querySelector<HTMLElement>(".dim-art");
  const tr = prev?.querySelector<HTMLElement>(".dim-tr");
  const showSrc = prev?.querySelector<HTMLElement>(".dim-src");
  if (showSrc) showSrc.textContent = `${img.naturalWidth}×${img.naturalHeight} source`;
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0 || !prev || !art || !tr) return;
    const slotW = Number(img.dataset.slotW ?? w);
    const slotH = Number(img.dataset.slotH ?? h);
    const sx = slotW / w;
    const sy = slotH / h;
    const inset = { t: y0, r: w - 1 - x1, b: h - 1 - y1, l: x0 };
    art.textContent = `${x1 - x0 + 1}×${y1 - y0 + 1}px ≈ ${f1((x1 - x0 + 1) * sx)}×${f1((y1 - y0 + 1) * sy)}pt`;
    tr.textContent = `${inset.t} / ${inset.r} / ${inset.b} / ${inset.l}px`;
    const overlay = document.createElement("div");
    overlay.className = "artbox";
    overlay.style.left = `${(x0 / w) * 100}%`;
    overlay.style.top = `${(y0 / h) * 100}%`;
    overlay.style.width = `${((x1 - x0 + 1) / w) * 100}%`;
    overlay.style.height = `${((y1 - y0 + 1) / h) * 100}%`;
    prev.appendChild(overlay);
  } catch {
    /* tainted canvas or missing pixels */
  }
}

// Inline handlers need a global; the bundle is a module.
(window as unknown as { iconLoaded: typeof iconLoaded }).iconLoaded = iconLoaded;

/** Collapse state persists across re-renders. */
function wireGroups(): void {
  document.querySelectorAll<HTMLDetailsElement>("#metrics details[data-group]").forEach((d) => {
    d.ontoggle = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(GROUP_STATE_KEY) ?? "{}") as Record<string, boolean>;
        saved[d.dataset.group!] = d.open;
        localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(saved));
      } catch {
        /* private mode */
      }
    };
  });
}

function renderMeta(env: Envelope): void {
  if (lastMeta) lastMeta = { ...lastMeta, mtime: env.mtime };
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
      (document.getElementById("live-btn") as HTMLButtonElement).style.display = "";
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
    (document.getElementById("live-btn") as HTMLButtonElement).style.display = "none";
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

const TOGGLE_STATE_KEY = "docky-inspector-toggles-v2";

function loadToggleState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(TOGGLE_STATE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveToggleState(): void {
  try {
    const state: Record<string, boolean> = {};
    document.querySelectorAll<HTMLInputElement>("input.guide").forEach((cb) => {
      state[cb.dataset.guide!] = cb.checked;
    });
    document.querySelectorAll<HTMLInputElement>("input.view").forEach((cb) => {
      state[cb.dataset.view!] = cb.checked;
    });
    localStorage.setItem(TOGGLE_STATE_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

function initControls(): void {
  initPanel();
  const saved = loadToggleState();
  for (const [id, on] of Object.entries(view)) {
    if (typeof saved[id] === "boolean") view[id as ViewId] = saved[id];
  }
  document.getElementById("guides")!.innerHTML =
    GUIDES.map(
      (g) => `<label><input type="checkbox" class="guide" data-guide="${g.id}"${saved[g.id] ?? true ? " checked" : ""}> ${g.label}</label>`,
    ).join("") +
    VIEW_TOGGLES.map(
      (t) => `<label><input type="checkbox" class="view" data-view="${t.id}"${(saved[t.id] ?? t.on) ? " checked" : ""}> ${t.label}</label>`,
    ).join("");
  document.querySelectorAll<HTMLInputElement>("input.guide").forEach((cb) => {
    cb.onchange = () => {
      applyGuideVisibility();
      saveToggleState();
    };
  });
  document.querySelectorAll<HTMLInputElement>("input.view").forEach((cb) => {
    cb.onchange = () => {
      view[cb.dataset.view as ViewId] = cb.checked;
      saveToggleState();
      lastSig = "";
    };
  });
}

initControls();
void poll();
