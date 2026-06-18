export interface Pt {
  x: number;
  y: number;
}

export interface TrimmedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A point on a circle. Angles in degrees, 0 = right, -90 = top, clockwise. */
export function polar(center: Pt, radius: number, deg: number): Pt {
  const rad = (deg * Math.PI) / 180;
  return {
    x: center.x + radius * Math.cos(rad),
    y: center.y + radius * Math.sin(rad),
  };
}

/**
 * Evenly distributed angles around a center.
 * Full ring (sweep 360) spaces points so none overlap; partial sweeps
 * include both endpoints.
 */
export function ringAngles(count: number, startDeg = -90, sweepDeg = 360): number[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [startDeg + (Math.abs(sweepDeg) >= 360 ? 0 : sweepDeg / 2)];
  }
  const full = Math.abs(sweepDeg) >= 360;
  const step = full ? sweepDeg / count : sweepDeg / (count - 1);
  return Array.from({ length: count }, (_, i) => startDeg + step * i);
}

/** Angles fanned symmetrically around a base angle. */
export function fanAngles(base: number, count: number, totalSpreadDeg: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [base];
  return Array.from(
    { length: count },
    (_, i) => base - totalSpreadDeg / 2 + (totalSpreadDeg * i) / (count - 1)
  );
}

/**
 * Fan leaves on both sides of a hub spoke so nothing sits on the intermediate
 * node's angle. Keeps branch clusters readable.
 */
export function wingAngles(
  hubAngle: number,
  hubReserveDeg: number,
  count: number,
  wingSpanDeg: number
): number[] {
  if (count <= 0) return [];
  if (count === 1) {
    return [hubAngle + hubReserveDeg * 1.25];
  }
  const leftN = Math.floor(count / 2);
  const rightN = count - leftN;
  const wing = Math.max(wingSpanDeg, hubReserveDeg * 2.4);
  const left = fanAngles(hubAngle - hubReserveDeg, leftN, wing);
  const right = fanAngles(hubAngle + hubReserveDeg, rightN, wing);
  return [...left, ...right].sort((a, b) => a - b);
}

/** Shorten a segment so it starts/ends at the edge of each node plus a gap. */
export function trimLine(a: Pt, b: Pt, startGap: number, endGap: number): TrimmedLine {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: a.x + ux * startGap,
    y1: a.y + uy * startGap,
    x2: b.x - ux * endGap,
    y2: b.y - uy * endGap,
  };
}

/** Point a fraction t along a segment. */
export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export interface RoutedPath {
  d: string;
  labelX: number;
  labelY: number;
}

/** Angle in degrees from center to point. */
export function angleDeg(center: Pt, point: Pt): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** Distance from center to point. */
export function radius(center: Pt, point: Pt): number {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

/** Snap an angle to a readable interval, e.g. 15-degree diagram spokes. */
export function snapAngle(deg: number, interval = 15): number {
  return Math.round(deg / interval) * interval;
}

/**
 * Elbow bend on the source radial — first leg leaves along the source spoke,
 * then turns toward the target. Reads well for branch-hub → leaf links.
 */
export function sourceRadialBend(from: Pt, to: Pt, center: Pt, legRatio = 0.5): Pt {
  const fromR = radius(center, from);
  const toR = radius(center, to);
  const bendR = fromR + (toR - fromR) * legRatio;
  return polar(center, bendR, angleDeg(center, from));
}

/**
 * Elbow bend on the target radial — sweeps to the target angle before reaching
 * the node. Reads well for hub → leaf and incoming creator links.
 */
export function targetRadialBend(from: Pt, to: Pt, center: Pt, legRatio = 0.52): Pt {
  const fromR = radius(center, from);
  const toR = radius(center, to);
  const bendR = fromR + (toR - fromR) * legRatio;
  return polar(center, bendR, angleDeg(center, to));
}

/** Two-segment elbow path with trimmed endpoints and a label anchor. */
export function routedElbowPath(
  from: Pt,
  to: Pt,
  bend: Pt,
  startGap: number,
  endGap: number
): RoutedPath {
  const startTrim = trimLine(from, bend, startGap, 0);
  const start = { x: startTrim.x1, y: startTrim.y1 };
  const endTrim = trimLine(bend, to, 0, endGap);
  const end = { x: endTrim.x2, y: endTrim.y2 };

  const leg1 = Math.hypot(bend.x - start.x, bend.y - start.y);
  const leg2 = Math.hypot(end.x - bend.x, end.y - bend.y);
  const labelPt = leg1 >= leg2 ? lerp(start, bend, 0.5) : lerp(bend, end, 0.5);

  return {
    d: `M ${start.x} ${start.y} L ${bend.x} ${bend.y} L ${end.x} ${end.y}`,
    labelX: labelPt.x,
    labelY: labelPt.y,
  };
}

/** Straight segment path with trimmed endpoints. */
export function routedStraightPath(
  from: Pt,
  to: Pt,
  startGap: number,
  endGap: number
): RoutedPath {
  const t = trimLine(from, to, startGap, endGap);
  const mid = lerp({ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }, 0.5);
  return {
    d: `M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`,
    labelX: mid.x,
    labelY: mid.y,
  };
}

/** Minimum half-angle (deg) needed between two nodes at a given radius. */
export function minSeparationDeg(nodeSize: number, ringRadius: number, padding = 14): number {
  const chord = nodeSize + padding;
  const ratio = clamp(chord / (2 * Math.max(ringRadius, 1)), 0.01, 0.99);
  return (Math.asin(ratio) * 360) / Math.PI;
}

export interface CircleBody {
  x: number;
  y: number;
  size: number;
  /** Higher = harder to move; use Infinity for anchors. */
  weight: number;
}

/** Iteratively separate overlapping circular nodes. */
export function resolveCollisions(
  nodes: CircleBody[],
  maxIterations = 120,
  padding = 12
): void {
  for (let iter = 0; iter < maxIterations; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dist = 0.01;
        }
        const need = (a.size + b.size) / 2 + padding;
        if (dist >= need) continue;

        const overlap = need - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const wa = a.weight >= 1e8 ? 1e8 : a.weight;
        const wb = b.weight >= 1e8 ? 1e8 : b.weight;
        const total = wa + wb;

        if (a.weight < 1e8) {
          a.x -= ux * overlap * (wb / total);
          a.y -= uy * overlap * (wb / total);
        }
        if (b.weight < 1e8) {
          b.x += ux * overlap * (wa / total);
          b.y += uy * overlap * (wa / total);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Three-segment channel path: leave along source spoke, traverse at a shared
 * radius, then enter along the target spoke. Routes around crowded hubs.
 */
export function routedChannelPath(
  from: Pt,
  to: Pt,
  center: Pt,
  startGap: number,
  endGap: number,
  channelRatio = 0.46
): RoutedPath {
  const fromAng = angleDeg(center, from);
  const toAng = angleDeg(center, to);
  const fromR = radius(center, from);
  const toR = radius(center, to);
  const channelR = fromR + (toR - fromR) * channelRatio;
  const bend1 = polar(center, channelR, fromAng);
  const bend2 = polar(center, channelR, toAng);

  const startTrim = trimLine(from, bend1, startGap, 0);
  const start = { x: startTrim.x1, y: startTrim.y1 };
  const endTrim = trimLine(bend2, to, 0, endGap);
  const end = { x: endTrim.x2, y: endTrim.y2 };

  const legs = [
    Math.hypot(bend1.x - start.x, bend1.y - start.y),
    Math.hypot(bend2.x - bend1.x, bend2.y - bend1.y),
    Math.hypot(end.x - bend2.x, end.y - bend2.y),
  ];
  const longest = legs.indexOf(Math.max(...legs));
  const labelPt =
    longest === 0
      ? lerp(start, bend1, 0.5)
      : longest === 1
        ? lerp(bend1, bend2, 0.5)
        : lerp(bend2, end, 0.5);

  return {
    d: `M ${start.x} ${start.y} L ${bend1.x} ${bend1.y} L ${bend2.x} ${bend2.y} L ${end.x} ${end.y}`,
    labelX: labelPt.x,
    labelY: labelPt.y,
  };
}
