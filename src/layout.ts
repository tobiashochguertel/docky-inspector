/** Shared contract between Docky and the inspector.
 *
 * Docky writes `docky-layout.json` while debug logging is on
 * (~/Library/Logs/Docky/). Units are points, centers run along the dock
 * axis. The label row is derived from `fontSize` — same formula as
 * Docky's `TileLabelMetrics`: ceil(font * 1.2) + 2.
 */

export interface LayoutTile {
  id: string;
  kind: string;
  /** Tile width in pt. */
  w: number;
  /** Tile height in pt. */
  h: number;
  /** Rest center along the dock axis in pt. */
  c: number;
  /** Resolved label text, "" when the tile shows none. */
  label: string;
  /** Contained bundle ids (appFolder tiles, up to 4) for mosaic icons. */
  apps?: string[];
  /** Owning app bundle id (minimized tiles) for its icon. */
  bundle?: string;
  /** Measured icon sub-frame [w, h] (present once rendered). */
  iconM?: [number, number];
  /** Measured label sub-frame [w, h] (present once rendered). */
  labelM?: [number, number];
}

export interface LayoutSnapshot {
  position: string;
  /** Base tile size [w, h] without the label row. */
  tile: [number, number];
  spacing: number;
  scale: number;
  placement: string;
  fontSize: number;
  /** Rendered paddings in pt: v = cross-axis content padding, icon = icon inset. */
  padding: { v: number; icon: number };
  tiles: LayoutTile[];
}

export interface Verdicts {
  heights: string;
  heightsOk: boolean;
  gaps: string;
  gapsOk: boolean;
  unlabeled: string[];
}

export function labelRowHeight(fontSize: number): number {
  return Math.ceil(fontSize * 1.2) + 2;
}

export function gapBetween(a: LayoutTile, b: LayoutTile): number {
  return b.c - a.c - (a.w + b.w) / 2;
}

export function judge(data: LayoutSnapshot): Verdicts {
  const heights = [...new Set(data.tiles.map((t) => t.h))].sort((x, y) => x - y);
  const badGaps: string[] = [];
  const tiles = data.tiles;
  for (let i = 0; i + 1 < tiles.length; i++) {
    const gap = gapBetween(tiles[i], tiles[i + 1]);
    if (Math.abs(gap - data.spacing) > 0.6) {
      badGaps.push(`${tiles[i].id}→${tiles[i + 1].id}:${gap.toFixed(1)}`);
    }
  }
  const labelKinds = new Set(["app", "appFolder", "folder", "trash", "min", "launchpad", "startMenu"]);
  const unlabeled = tiles.filter((t) => labelKinds.has(t.kind) && !t.label).map((t) => t.id);
  return {
    heights: heights.length === 1 ? "UNIFORM" : `MIXED ${heights.join(",")}`,
    heightsOk: heights.length === 1,
    gaps: badGaps.length === 0 ? "UNIFORM" : `${badGaps.length} VIOLATIONS ${badGaps.slice(0, 5).join(" ")}`,
    gapsOk: badGaps.length === 0,
    unlabeled,
  };
}

export interface TileDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

export function diffTiles(prev: LayoutTile[], next: LayoutTile[]): TileDiff {
  const p = new Map(prev.map((t) => [t.id, t]));
  const changed: string[] = [];
  const added: string[] = [];
  for (const t of next) {
    const o = p.get(t.id);
    if (!o) {
      if (prev.length > 0) added.push(t.id);
    } else if (o.w !== t.w || o.h !== t.h || o.label !== t.label || o.c !== t.c) {
      changed.push(t.id);
    }
  }
  const nextIds = new Set(next.map((t) => t.id));
  const removed = prev.length > 0 ? [...p.keys()].filter((id) => !nextIds.has(id)) : [];
  return { changed, added, removed };
}
