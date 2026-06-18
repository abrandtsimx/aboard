import {
  forceSimulation,
  forceCollide,
  forceManyBody,
  forceRadial,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';
import { Pt } from './layout.util';

/**
 * A body handed to the force settler. `x`/`y` seed the starting position (use
 * the existing radial/grid layout so the result keeps that shape). `radius` is
 * the hard collision radius — no two bodies will end up closer than the sum of
 * their radii, which is what guarantees nodes never overlap.
 */
export interface ForceBody extends SimulationNodeDatum {
  id: string;
  /** Hard non-overlap radius (half the node footprint plus breathing room). */
  radius: number;
  /**
   * When set, the body is anchored here and cannot be pushed (e.g. the focused
   * root / peek hub). Anything else is shoved out of its way.
   */
  fixed?: boolean;
  /**
   * Soft target distance from `center`. The body is gently pulled toward this
   * ring so the radial structure survives, but collisions win locally.
   */
  targetRadius?: number;
  /** Strength of the radial pull (0..1). Higher = hugs its ring more tightly. */
  radialStrength?: number;
  /**
   * Soft anchor toward a specific point (e.g. a grid slot). Used when there is
   * no meaningful ring, so the body keeps its seeded spot but still separates.
   */
  anchor?: Pt;
  /** Strength of the point anchor (0..1). */
  anchorStrength?: number;
}

export interface SettleOptions {
  /** Centre of the radial forces (the focused node / hub position). */
  center: Pt;
  /** Fixed number of synchronous ticks. More = more settled, slower. */
  iterations?: number;
  /** Extra gap enforced on top of each body's radius. */
  collidePadding?: number;
  /** Global mild repulsion so crowded clusters breathe. Negative = repel. */
  charge?: number;
}

/**
 * Settle a set of bodies so none overlap, running d3-force synchronously (no
 * animation, no DOM). The simulation is deterministic for identical input:
 * positions are seeded by the caller and d3's internal PRNG is stable, so the
 * same board always lays out the same way.
 *
 * Mutates each body's `x`/`y` in place.
 */
export function settleForceLayout(bodies: ForceBody[], options: SettleOptions): void {
  if (bodies.length === 0) return;

  const { center, iterations = 300, collidePadding = 6, charge = -14 } = options;

  for (const body of bodies) {
    if (typeof body.x !== 'number') body.x = center.x;
    if (typeof body.y !== 'number') body.y = center.y;
    if (body.fixed) {
      body.fx = body.x;
      body.fy = body.y;
    }
  }

  const hasRadial = bodies.some((b) => b.targetRadius != null);
  const hasAnchor = bodies.some((b) => b.anchor);

  const sim = forceSimulation<ForceBody>(bodies)
    .force(
      'collide',
      forceCollide<ForceBody>()
        .radius((d) => d.radius + collidePadding)
        .strength(1)
        .iterations(4)
    )
    .force('charge', forceManyBody<ForceBody>().strength(charge))
    .stop();

  if (hasRadial) {
    sim.force(
      'radial',
      forceRadial<ForceBody>((d) => d.targetRadius ?? 0, center.x, center.y).strength(
        (d) => (d.targetRadius != null ? d.radialStrength ?? 0.35 : 0)
      )
    );
  }

  if (hasAnchor) {
    sim
      .force(
        'anchorX',
        forceX<ForceBody>((d) => d.anchor?.x ?? center.x).strength((d) =>
          d.anchor ? d.anchorStrength ?? 0.2 : 0
        )
      )
      .force(
        'anchorY',
        forceY<ForceBody>((d) => d.anchor?.y ?? center.y).strength((d) =>
          d.anchor ? d.anchorStrength ?? 0.2 : 0
        )
      );
  }

  sim.alpha(1).alphaMin(0.001).alphaDecay(1 - Math.pow(0.001, 1 / iterations));
  for (let i = 0; i < iterations; i++) sim.tick();
  sim.stop();

  // Release fixed pins so callers reading x/y get clean numbers.
  for (const body of bodies) {
    body.fx = undefined;
    body.fy = undefined;
  }
}
