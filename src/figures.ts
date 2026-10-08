/**
 * Figure definitions for the structure page.
 *
 * Every figure is a tree: nesting in the tree is nesting in the diagram, so a
 * part cannot escape its parent. Numbers come from the live layout snapshot,
 * so a label cannot disagree with the running dock either.
 */

import { PALETTE, type FigNode } from "./d2";

/** A tile as the snapshot reports it. Mirrors `LayoutTile` plus the frames. */
export interface SnapshotTile {
  id: string;
  kind: string;
  label?: string;
  c: number;
  w: number;
  h: number;
  iconF?: [number, number, number, number];
  labelF?: [number, number, number, number];
  paintF?: [number, number, number, number];
  bands?: Record<string, number>;
}

export interface Snapshot {
  tile: [number, number];
  fontSize: number;
  padding: { v: number; icon: number };
  spacing: number;
  placement: string;
  position: string;
  scale: number;
  metrics: Record<string, number | string>;
  tiles: SnapshotTile[];
}

/** pt, always suffixed so a reader never has to guess the unit. */
function pt(v: number): string {
  return `${Number(v.toFixed(1))} pt`;
}

/** Picks a representative tile of a kind, preferring one with measurements. */
export function representative(
  layout: Snapshot,
  kind: string,
): SnapshotTile | undefined {
  const of = layout.tiles.filter((t) => t.kind === kind);
  return of.find((t) => t.bands && t.iconF) ?? of[0];
}

// ── §4 · inside one tile ────────────────────────────────────────────────────

/**
 * An app tile, outermost band first.
 *
 * Every band here is measured: `padTop`, `labelGap` and `padBottom` are the
 * empty regions Docky actually produced, not values inferred from the layout
 * code. That distinction matters — the bottom padding is not obvious from
 * reading `TileView`, and it was previously missing from the figure.
 */
export function figureInsideAppTile(layout: Snapshot): FigNode {
  const t = representative(layout, "app");
  const b = t?.bands;
  const icon = t?.iconF ?? [0, layout.padding.v, t?.w ?? 40, t?.w ?? 40];
  const label = t?.labelF ?? [0, (t?.h ?? 68) - layout.padding.v - layout.metrics.labelHeight, t?.w ?? 40, 40];
  const painted = t?.paintF ?? icon;
  const padTop = b?.padTop ?? layout.padding.v;
  const gap = b?.labelGap ?? layout.metrics.iconLabelGap;
  const padBottom = b?.padBottom ?? layout.padding.v;

  return {
    label: `app tile ${pt(t?.w ?? 40)} × ${pt(t?.h ?? 68)}`,
    role: "container",
    stack: "vertical",
    children: [
      { label: `padding p = ${pt(padTop)} (top)`, role: "pad" },
      {
        label: `icon slot ${pt(icon[2])} × ${pt(icon[3])}`,
        role: "slot",
        stack: "vertical",
        children: [
          {
            label: `painted artwork ${pt(painted[2])} × ${pt(painted[3])}`,
            role: "art",
          },
        ],
      },
      { label: `gap g = ${pt(gap)}`, fixed: true },
      { label: `label text ${pt(label[2])} × ${pt(label[3])}`, role: "label" },
      { label: `padding p = ${pt(padBottom)} (bottom)`, role: "pad" },
    ],
  };
}

/**
 * A widget-chrome tile.
 *
 * Unlike an app tile, the content is inset by a fixed chrome band on all four
 * sides, and the vertical inset is chrome + padding. There is no widget tile in
 * the live snapshot right now, so the inner stack reuses the measured app tile
 * and the insets come from the exported constants — both drawn as `◆`.
 */
export function figureInsideWidgetTile(layout: Snapshot): FigNode {
  const app = representative(layout, "app");
  const b = app?.bands ?? {};
  const padTop = b.padTop ?? layout.padding.v;
  const padBottom = b.padBottom ?? layout.padding.v;
  const gap = b.labelGap ?? layout.metrics.iconLabelGap;
  const chrome = Number(layout.metrics.chromeInset ?? 3);
  const icon = app?.iconF ?? [0, 0, 40, 40];
  const label = app?.labelF ?? [0, 0, 40, 10];

  return {
    label: "widget tile — content inset on all four sides",
    role: "container",
    stack: "vertical",
    children: [
      {
        label: `inset = ${pt(chrome)} chrome + ${pt(padTop)} padding (top)`,
        fixed: true,
        stack: "vertical",
        children: [
          {
            label: `icon slot ${pt(icon[2])} × ${pt(icon[3])}`,
            role: "slot",
            stack: "vertical",
            children: [
              { label: `painted artwork ${pt(icon[2])} × ${pt(icon[3])}`, role: "art" },
            ],
          },
          { label: `gap g = ${pt(gap)}`, fixed: true },
          { label: `label text ${pt(label[2])} × ${pt(label[3])}`, role: "label" },
        ],
      },
      {
        label: `inset = ${pt(chrome)} chrome + ${pt(padTop)} padding (bottom)`,
        fixed: true,
      },
    ],
  };
}

// ── figure registry ─────────────────────────────────────────────────────────

export type FigureBuilder = (layout: Snapshot) => FigNode;

/** Figures injected into the page, keyed by the placeholder they fill. */
export const FIGURES: Record<string, FigureBuilder> = {
  "f-inside-app": figureInsideAppTile,
  "f-inside-widget": figureInsideWidgetTile,
};