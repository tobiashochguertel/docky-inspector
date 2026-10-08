/**
 * Figures as declarative D2 trees.
 *
 * The whole point of this module is that a figure's *structure* is the shape
 * of the data, not a pile of computed coordinates. Nesting in the tree is
 * nesting in the diagram, so a part cannot end up outside its parent because
 * someone mis-subtracted a padding. Sizes and positions belong to D2's
 * layout engine; exact numbers live in the labels, fed from the measured
 * layout snapshot.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Palette roles, mirroring the colours the inspector has always used. */
export const PALETTE = {
  barFill: "#0b1220",
  frame: "#cbd5e1",
  slot: "#22c55e",
  pad: "#f472b6",
  label: "#facc15",
  struct: "#cbd5e1",
  info: "#93c5fd",
  good: "#4ade80",
  warn: "#fde047",
  artFill: "#f2e3cc",
  artStroke: "#a16207",
  run: "#e5e7eb",
  badge: "#ef4444",
  /** Reserved for annotation only: never used for a real part. */
  did: "#c4b5fd",
} as const;

/** The page background figures are drawn on. */
export const PAGE_BG = "#0b1220";

/** Semantic role of a box, so figure specs never hard-code a colour. */
export type Role =
  | "container"
  | "frame"
  | "slot"
  | "pad"
  | "label"
  | "info"
  | "good"
  | "warn"
  | "art"
  | "overlay"
  | "did";

/** A figure node. Children nest inside it; that nesting is the structure. */
export interface FigNode {
  /** Rendered as the shape's label. Keep it to one line. */
  label: string;
  role?: Role;
  /** How children are laid out. Omitted leaves children centred. */
  stack?: "vertical" | "horizontal";
  /**
   * Fixed (compiled-in) constant. Rendered with the annotation violet and
   * the ◆ marker, per the page's legend.
   */
  fixed?: boolean;
  children?: FigNode[];
  /** Raw D2 style lines, for the rare thing a role can't express. */
  style?: Record<string, string>;
}

// ── colour ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * D2 rejects `rgba()`, so translucent fills are pre-blended against the page
 * background and emitted as opaque hex. Blending at generation time keeps the
 * rendered figure identical to what the palette asked for.
 */
export function blend(fg: string, alpha: number, bg: string = PAGE_BG): string {
  const [fr, fg2, fb] = hexToRgb(fg);
  const [br, bg2, bb] = hexToRgb(bg);
  const mix = (a: number, b: number) =>
    Math.round(a * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(fr, br)}${mix(fg2, bg2)}${mix(fb, bb)}`;
}

/** Translucent fill at a role's own colour, blended onto the page. */
const FILL_ALPHA: Partial<Record<Role, number>> = {
  frame: 0.1,
  slot: 0.14,
  pad: 0.14,
  label: 0.16,
  info: 0.14,
  good: 0.14,
  warn: 0.16,
  did: 0.18,
  overlay: 0.12,
};

/** Role → stroke colour. Every role must be listed: an unlisted one is a bug. */
const STROKE: Record<Role, string> = {
  container: PALETTE.frame,
  frame: PALETTE.frame,
  slot: PALETTE.slot,
  pad: PALETTE.pad,
  label: PALETTE.label,
  info: PALETTE.info,
  good: PALETTE.good,
  warn: PALETTE.warn,
  art: PALETTE.artStroke,
  overlay: PALETTE.run,
  did: PALETTE.did,
};

function strokeOf(role: Role, fixed?: boolean): string {
  return fixed ? PALETTE.did : STROKE[role];
}

function fillOf(role: Role, fixed?: boolean): string {
  if (role === "container") return PALETTE.barFill;
  if (role === "art") return PALETTE.artFill;
  const base = fixed ? PALETTE.did : PALETTE[role];
  return blend(base, FILL_ALPHA[role] ?? 0.14);
}

// ── D2 source generation ────────────────────────────────────────────────────

/** Marks a fixed constant in the label. */
export const FIXED_MARK = "◆";

function escapeKey(label: string): string {
  const oneLine = label.replace(/\s+/g, " ").trim();
  return `"${oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isContainer(node: FigNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

/** Relative luminance, for picking readable label ink. */
function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

/** Renders one node (and its subtree) as D2 lines. */
function emit(node: FigNode, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  const fixed = node.fixed === true;
  const role: Role = fixed ? "did" : (node.role ?? "frame");
  const label = fixed && !node.label.startsWith(FIXED_MARK)
    ? `${FIXED_MARK} ${node.label}`
    : node.label;

  const lines: string[] = [];
  // D2's grid axes read the opposite way round to intuition: `grid-cols: 1`
  // stacks children into rows (one per child), `grid-rows: 1` lays them out
  // side by side. Naming the direction here keeps that inversion out of the
  // figure specs.
  if (node.stack === "vertical") lines.push("grid-cols: 1");
  if (node.stack === "horizontal") lines.push("grid-rows: 1");
  const fill = fillOf(role, fixed);
  lines.push(`style.fill: "${fill}"`);
  lines.push(`style.stroke: "${strokeOf(role, fixed)}"`);
  if (!isContainer(node)) {
    // Empty boxes read as noise; containers read as structure.
    lines.push("style.stroke-width: 2");
    lines.push("style.border-radius: 8");
  }
  lines.push(`style.font-color: "${isLight(fill) ? "#0b1220" : "#e5e7eb"}"`);
  if (fixed) lines.push("style.font-size: 22");
  for (const [k, v] of Object.entries(node.style ?? {})) {
    lines.push(`style.${k}: ${v}`);
  }

  out.push(`${pad}${escapeKey(label)}: {`);
  for (const l of lines) out.push(`${pad}  ${l}`);
  for (const child of node.children ?? []) emit(child, depth + 1, out);
  out.push(`${pad}}`);
}

/** Labels double as D2 keys, so two identical siblings silently merge. */
function assertUniqueLabels(node: FigNode, path: string[] = []): void {
  const seen = new Map<string, number>();
  for (const child of node.children ?? []) {
    const label = child.fixed ? `${FIXED_MARK} ${child.label}` : child.label;
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    const where = [...path, node.label].join(" › ");
    throw new Error(
      `D2 merges siblings that share a label, so "${where}" would lose ${dupes
        .map(([l, n]) => `${n - 1} of "${l}"`)
        .join(", ")}. Labels double as keys — make each sibling distinct.`,
    );
  }
  for (const child of node.children ?? []) {
    assertUniqueLabels(child, [...path, node.label]);
  }
}

/** Turns a figure tree into D2 source text. */
export function toD2(root: FigNode): string {
  assertUniqueLabels(root);
  const out: string[] = [];
  emit(root, 0, out);
  return out.join("\n");
}

// ── rendering ───────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Drop the opaque white backdrop so the page background shows through. */
  transparent?: boolean;
  /** Unique-ish suffix for SVG ids, so several figures can share a page. */
  salt?: string;
  pad?: number;
}

/**
 * Resolves the D2 CLI. `d2lang.com/install.sh` installs to `~/.d2/bin`, but
 * it defers to an existing install (e.g. Homebrew's `/opt/homebrew/bin`), so
 * PATH is searched as well.
 */
function findD2(): string {
  const candidates = [
    join(homedir(), ".d2", "bin", "d2"),
    ...(process.env.PATH ?? "")
      .split(":")
      .filter(Boolean)
      .map((dir) => join(dir, "d2")),
  ];
  return candidates.find((p) => existsSync(p)) ?? "";
}

let d2Path: string | null = null;

/** Path to the D2 CLI, or `""` when it is not installed. */
export function d2Available(): boolean {
  d2Path ??= findD2();
  return d2Path.length > 0;
}

/**
 * Compiles and renders D2 source to an SVG string via the D2 CLI.
 *
 * The `@terrastruct/d2` WASM package was tried first, but 0.1.33 panics in
 * `EmbedFonts` on every render (nil dereference — its built-in Source Sans Pro
 * faces are unreachable from the Node build, and passing system faces does not
 * help). The CLI is the supported path and renders correctly, so figures go
 * through it.
 *
 * D2 always paints an opaque backdrop; `transparent` swaps it for the page
 * background so figures sit on the inspector's own dark surface.
 */
export async function renderD2(
  source: string,
  opts: RenderOptions = {},
): Promise<string> {
  if (!d2Available()) {
    throw new Error(
      "D2 CLI not found on PATH. Install it with: brew install d2 " +
        "(or curl -fsSL https://d2lang.com/install.sh | sh -s --)",
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "docky-d2-"));
  const inFile = join(dir, "figure.d2");
  const outFile = join(dir, "figure.svg");
  try {
    await writeFile(inFile, source, "utf8");
    const proc = Bun.spawn(
      [
        d2Path,
        inFile,
        outFile,
        `--pad=${opts.pad ?? 24}`,
        "--scale=1",
        "--center",
        "--theme=200",
        "--omit-version",
        ...(opts.salt ? [`--salt=${opts.salt}`] : []),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, , err] = await Promise.all([
      proc.exited,
      proc.stdout.text(),
      proc.stderr.text(),
    ]);
    if (code !== 0) {
      throw new Error(`d2 exited ${code}: ${err.trim() || source}`);
    }
    let svg = await readFile(outFile, "utf8");
    if (opts.transparent !== false) {
      svg = svg.replace(
        /<rect[^>]*fill="#FFFFFF"[^>]*\/>/,
        `<rect width="100%" height="100%" fill="${PAGE_BG}"/>`,
      );
    }
    return svg;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Convenience: tree → source → SVG. */
export async function renderFigure(
  root: FigNode,
  opts: RenderOptions = {},
): Promise<{ source: string; svg: string }> {
  const source = toD2(root);
  const svg = await renderD2(source, opts);
  return { source, svg };
}