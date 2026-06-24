import { NodeShape } from '../models/aboard.models';

/** Center of every orbit-node SVG shape in its 100×100 viewBox. */
const CX = 50;
const CY = 50;

/** Half of the 2px stroke drawn in viewBox units (outer edge of the shape). */
const STROKE_OUTSET = 1;

interface VPt {
  x: number;
  y: number;
}

/** Distance from node center to the visible shape edge along `(ux, uy)` (unit vector). */
export function shapeBoundaryDistance(
  shape: NodeShape,
  ux: number,
  uy: number,
  nodeSize: number
): number {
  const len = Math.hypot(ux, uy);
  if (len < 1e-9) return nodeSize / 2;
  const dx = ux / len;
  const dy = uy / len;
  const hit = rayHitShape(shape, dx, dy);
  return ((hit ?? 49) + STROKE_OUTSET) * (nodeSize / 100);
}

function rayHitShape(shape: NodeShape, dx: number, dy: number): number | null {
  switch (shape) {
    case 'circle':
      return rayHitEllipse(dx, dy, 49, 49);
    case 'ellipse':
      return rayHitEllipse(dx, dy, 45, 36);
    case 'diamond':
      return rayHitPolygon(dx, dy, [
        { x: 50, y: 1 },
        { x: 99, y: 50 },
        { x: 50, y: 99 },
        { x: 1, y: 50 },
      ]);
    case 'hexagon':
      return rayHitPolygon(dx, dy, [
        { x: 22, y: 2 },
        { x: 78, y: 2 },
        { x: 99, y: 50 },
        { x: 78, y: 98 },
        { x: 22, y: 98 },
        { x: 1, y: 50 },
      ]);
    case 'octagon':
      return rayHitPolygon(dx, dy, [
        { x: 29, y: 3 },
        { x: 71, y: 3 },
        { x: 97, y: 29 },
        { x: 97, y: 71 },
        { x: 71, y: 97 },
        { x: 29, y: 97 },
        { x: 3, y: 71 },
        { x: 3, y: 29 },
      ]);
    case 'pill':
      return rayHitRoundedRect(dx, dy, 6, 28, 94, 72, 22);
    case 'square':
      return rayHitRoundedRect(dx, dy, 1, 1, 99, 99, 3);
    case 'rounded-square':
    default:
      return rayHitRoundedRect(dx, dy, 1, 1, 99, 99, 20);
  }
}

function rayHitEllipse(dx: number, dy: number, rx: number, ry: number): number {
  const denom = Math.hypot(dx / rx, dy / ry);
  return denom > 1e-9 ? 1 / denom : rx;
}

function rayHitPolygon(dx: number, dy: number, vertices: VPt[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const t = raySegmentHit(dx, dy, a, b);
    if (t != null && (best == null || t < best)) best = t;
  }
  return best;
}

function raySegmentHit(dx: number, dy: number, a: VPt, b: VPt): number | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = CX - a.x;
  const wy = CY - a.y;
  const crossVD = vx * dy - vy * dx;
  const crossWD = wx * dy - wy * dx;
  const crossWV = wx * vy - wy * vx;

  if (Math.abs(crossVD) < 1e-9) return null;

  const u = crossWD / crossVD;
  const t = crossWV / crossVD;
  if (u >= 0 && u <= 1 && t >= 0) return t;
  return null;
}

/**
 * Ray vs axis-aligned rounded rectangle (matches orbit-node SVG rects).
 * `x1,y1` and `x2,y2` are inclusive corner coordinates; `r` is corner radius.
 */
function rayHitRoundedRect(
  dx: number,
  dy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number
): number | null {
  let best: number | null = null;
  const consider = (t: number | null, valid = true) => {
    if (t != null && t >= 0 && valid && (best == null || t < best)) best = t;
  };

  const innerLeft = x1 + r;
  const innerRight = x2 - r;
  const innerTop = y1 + r;
  const innerBottom = y2 - r;

  if (dx > 1e-9) {
    const t = (x2 - CX) / dx;
    consider(t, CY + t * dy >= innerTop && CY + t * dy <= innerBottom);
  } else if (dx < -1e-9) {
    const t = (x1 - CX) / dx;
    consider(t, CY + t * dy >= innerTop && CY + t * dy <= innerBottom);
  }

  if (dy > 1e-9) {
    const t = (y2 - CY) / dy;
    consider(t, CX + t * dx >= innerLeft && CX + t * dx <= innerRight);
  } else if (dy < -1e-9) {
    const t = (y1 - CY) / dy;
    consider(t, CX + t * dx >= innerLeft && CX + t * dx <= innerRight);
  }

  const corners: Array<{ cx: number; cy: number; test: (x: number, y: number) => boolean }> = [
    { cx: innerLeft, cy: innerTop, test: (x, y) => x <= innerLeft && y <= innerTop },
    { cx: innerRight, cy: innerTop, test: (x, y) => x >= innerRight && y <= innerTop },
    { cx: innerRight, cy: innerBottom, test: (x, y) => x >= innerRight && y >= innerBottom },
    { cx: innerLeft, cy: innerBottom, test: (x, y) => x <= innerLeft && y >= innerBottom },
  ];
  for (const { cx, cy, test } of corners) {
    const t = rayCircleHit(dx, dy, cx, cy, r);
    if (t == null) continue;
    consider(t, test(CX + t * dx, CY + t * dy));
  }

  return best;
}

/** Ray from (CX,CY) along (dx,dy) hitting a circle centered at (cx,cy) with radius r. */
function rayCircleHit(dx: number, dy: number, cx: number, cy: number, r: number): number | null {
  const ox = CX - cx;
  const oy = CY - cy;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;

  const sqrt = Math.sqrt(disc);
  const t1 = (-b - sqrt) / 2;
  const t2 = (-b + sqrt) / 2;
  const hits = [t1, t2].filter((t) => t >= 0);
  return hits.length ? Math.min(...hits) : null;
}
