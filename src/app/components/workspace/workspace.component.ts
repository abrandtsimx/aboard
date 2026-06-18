import {
  Component,
  inject,
  signal,
  computed,
  ElementRef,
  viewChild,
  afterNextRender,
  effect,
  untracked,
  DestroyRef,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { marked } from 'marked';
import { DocumentService } from '../../services/document.service';
import { resolveImmersedBackdrop } from '../../utils/tag.util';
import { OrbitNodeComponent, OrbitState } from '../orbit-node/orbit-node.component';
import { AboardNode, NodeShape } from '../../models/aboard.models';
import {
  Pt,
  clamp,
  polar,
  ringAngles,
  fanAngles,
  routedElbowPath,
  routedStraightPath,
  routedChannelPath,
  routedCurvedPath,
  sourceRadialBend,
  targetRadialBend,
  wingAngles,
  minSeparationDeg,
  snapAngle,
} from '../../utils/layout.util';
import { ForceBody, settleForceLayout, SettleOptions } from '../../utils/force-layout.util';
import { categoryLabel, getNodeCategory } from '../../utils/category.util';
import { defaultShapeForCategory, findSchemaType } from '../../utils/node-style.util';

type TransitionPhase = 'idle' | 'exit' | 'enter';

interface Rect {
  w: number;
  h: number;
}

interface GraphNode {
  id: string;
  node: AboardNode;
  x: number;
  y: number;
  size: number;
  state: OrbitState;
  interactive: boolean;
  caption?: string;
  captionSide?: 'top' | 'right' | 'bottom' | 'left';
}

interface GraphLink {
  id: string;
  path: string;
  variant: 'faint' | 'active';
  label?: string;
  labelX?: number;
  labelY?: number;
}

type LinkRouting = 'straight' | 'elbow-source' | 'elbow-target' | 'channel';

/**
 * A link before routing is finalized. Specs are collected first so parallel /
 * reciprocal edges (same node pair) can be detected and bowed apart together.
 */
interface LinkSpec {
  id: string;
  a: GraphNode;
  b: GraphNode;
  variant: 'faint' | 'active';
  label?: string;
  center?: Pt;
  routing?: LinkRouting;
}

interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface NodeDragState {
  id: string;
  pointerId: number;
  startClient: Pt;
  startPosition: Pt;
  moved: boolean;
}

interface LegendItem {
  label: string;
  shape: NodeShape;
  /** CSS color string (a var(--…) reference for built-ins, raw color for schemas). */
  color: string;
}

// Representative fill per built-in category, used for legend entries on nodes
// that fall back to the default styling (no matching schema type).
const CATEGORY_LEGEND_COLOR: Record<string, string> = {
  application: 'var(--color-procedure-blue)',
  'data-type': 'var(--color-vital-red)',
  infrastructure: 'var(--color-steel-navy)',
  process: 'var(--color-clinical-indigo)',
  environment: 'var(--color-clinical-indigo)',
  'external-tool': 'var(--color-black-dusk)',
};

@Component({
  selector: 'app-workspace',
  imports: [OrbitNodeComponent, NgClass],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
  protected readonly doc = inject(DocumentService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly transition = signal<TransitionPhase>('idle');
  private readonly rect = signal<Rect | null>(null);

  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');

  // pan / zoom
  protected readonly scale = signal(1);
  protected readonly pan = signal<Pt>({ x: 0, y: 0 });
  protected readonly viewportTransform = computed(() => {
    const p = this.pan();
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(p.x * dpr) / dpr;
    const y = Math.round(p.y * dpr) / dpr;
    return `translate(${x}px, ${y}px) scale(${this.scale()})`;
  });

  private readonly MIN_SCALE = 0.45;
  private readonly MAX_SCALE = 3.2;
  private readonly ENTER_SCALE = 2.4;

  protected readonly panning = signal(false);
  private pointerActive = false;
  private didPan = false;
  private panStart = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };

  protected readonly draggingNodeId = signal<string | null>(null);
  private readonly temporaryNodePositions = signal<Record<string, Pt>>({});
  private nodeDrag: NodeDragState | null = null;

  // Memoizes the settled force layout so dragging a node (which only changes
  // temporaryNodePositions) reuses the existing layout instead of re-running
  // the simulation on every pointer move.
  private layoutCacheKey = '';
  private layoutCachePositions = new Map<string, Pt>();

  protected readonly graph = computed<GraphModel>(() => {
    const rect = this.rect();
    if (!rect || rect.w < 40 || rect.h < 40) return { nodes: [], links: [] };
    return this.doc.mode() === 'immersed'
      ? this.buildImmersed(rect)
      : this.buildCanvas(rect);
  });

  protected readonly immersedContentHtml = computed<string>(() => {
    const node = this.doc.immersedNode();
    if (!node) return '';
    const fallback = [
      node.description ? `## Overview\n\n${node.description}` : '## Overview',
      'No additional information has been added for this item yet.',
    ].join('\n\n');
    return marked.parse(node.content?.trim() || fallback, { async: false }) as string;
  });

  // Legend is built from the node types actually present: schema-defined types
  // use their custom shape/color, while nodes that fall back to the built-in
  // styling contribute a category entry. This keeps partial schemas accurate.
  protected readonly legendItems = computed<LegendItem[]>(() => {
    const schema = this.doc.schema();
    const items = new Map<string, LegendItem>();
    for (const node of this.doc.currentDocument().nodes) {
      const def = findSchemaType(node, schema);
      if (def) {
        const key = `type:${def.id}`;
        if (!items.has(key)) {
          items.set(key, { label: def.label ?? def.id, shape: def.shape, color: def.color });
        }
      } else {
        const cat = getNodeCategory(node);
        const key = `cat:${cat}`;
        if (!items.has(key)) {
          items.set(key, {
            label: categoryLabel(cat),
            shape: defaultShapeForCategory(cat),
            color: CATEGORY_LEGEND_COLOR[cat] ?? 'var(--color-clinical-indigo)',
          });
        }
      }
    }
    return [...items.values()];
  });

  protected hasInfoPanel(): boolean {
    const rect = this.rect();
    return (
      this.doc.mode() === 'immersed' &&
      !!this.doc.immersedNode() &&
      !!rect &&
      rect.w > 700
    );
  }

  constructor() {
    afterNextRender(() => {
      const measure = () => {
        const el = this.stageRef()?.nativeElement;
        if (!el) return;
        this.rect.set({ w: el.clientWidth, h: el.clientHeight });
      };
      measure();

      const ro = new ResizeObserver(() => measure());
      effect(() => {
        const el = this.stageRef()?.nativeElement;
        ro.disconnect();
        if (el) ro.observe(el);
        measure();
      });
      this.destroyRef.onDestroy(() => ro.disconnect());
    });

    // Reset pan/zoom whenever the navigation location changes. Dense immersed
    // views start slightly zoomed out so the full relationship ring is visible.
    effect(() => {
      this.doc.mode();
      this.doc.focusedNode();
      this.doc.immersedNode();
      untracked(() => {
        this.temporaryNodePositions.set({});
        this.nodeDrag = null;
        this.draggingNodeId.set(null);
        queueMicrotask(() => this.resetView());
      });
    });
  }

  private resetView(): void {
    const nodes = this.graph().nodes.length;
    const rect = this.rect();
    let scale = 1;
    if (this.doc.mode() === 'immersed') {
      if (nodes > 28) scale = 0.32;
      else if (nodes > 18) scale = 0.42;
      else if (nodes > 12) scale = 0.55;
    }
    this.scale.set(scale);
    this.pan.set(
      this.doc.mode() === 'immersed' && rect
        ? { x: (rect.w / 2) * (1 - scale), y: (rect.h / 2) * (1 - scale) }
        : { x: 0, y: 0 }
    );
  }

  // ---- interactions -------------------------------------------------------

  protected onStageBackgroundClick(): void {
    if (this.didPan) return;
    if (this.doc.mode() === 'canvas') {
      this.doc.peekNodeById(null);
    }
  }

  protected onGraphNodePointerDown(event: PointerEvent, gn: GraphNode): void {
    if (this.doc.mode() !== 'immersed' || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.nodeDrag = {
      id: gn.id,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: gn.x, y: gn.y },
      moved: false,
    };
    this.draggingNodeId.set(gn.id);
  }

  protected onGraphNodePointerMove(event: PointerEvent): void {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const screenDx = event.clientX - drag.startClient.x;
    const screenDy = event.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(screenDx, screenDy) < 4) return;

    drag.moved = true;
    this.didPan = true;
    const scale = this.scale() || 1;
    this.temporaryNodePositions.update((positions) => ({
      ...positions,
      [drag.id]: {
        x: drag.startPosition.x + screenDx / scale,
        y: drag.startPosition.y + screenDy / scale,
      },
    }));
  }

  protected onGraphNodePointerUp(event: PointerEvent, gn: GraphNode): void {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    this.nodeDrag = null;
    this.draggingNodeId.set(null);
    if (drag.moved) {
      setTimeout(() => (this.didPan = false));
    } else {
      this.onNodeActivated(gn);
    }
  }

  protected onGraphNodePointerCancel(event: PointerEvent): void {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    this.nodeDrag = null;
    this.draggingNodeId.set(null);
  }

  // ---- pan / zoom ---------------------------------------------------------

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointerActive = true;
    this.didPan = false;
    this.panStart = { x: event.clientX, y: event.clientY };
    this.panOrigin = { ...this.pan() };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointerActive) return;
    const dx = event.clientX - this.panStart.x;
    const dy = event.clientY - this.panStart.y;
    if (!this.didPan && Math.hypot(dx, dy) < 5) return;
    this.didPan = true;
    this.panning.set(true);
    this.pan.set({ x: this.panOrigin.x + dx, y: this.panOrigin.y + dy });
  }

  protected onPointerUp(): void {
    this.pointerActive = false;
    this.panning.set(false);
    // keep didPan true through the synthetic click so it can be suppressed,
    // then clear it on the next macrotask
    if (this.didPan) setTimeout(() => (this.didPan = false));
  }

  protected zoomBy(factor: number): void {
    const el = this.stageRef()?.nativeElement;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const old = this.scale();
    const next = clamp(old * factor, this.MIN_SCALE, this.MAX_SCALE);
    const p = this.pan();
    const worldX = (cx - p.x) / old;
    const worldY = (cy - p.y) / old;
    this.pan.set({ x: cx - worldX * next, y: cy - worldY * next });
    this.scale.set(next);
  }

  protected resetViewClicked(): void {
    this.resetView();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const el = this.stageRef()?.nativeElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const cx = event.clientX - box.left;
    const cy = event.clientY - box.top;

    const old = this.scale();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;

    // Zooming out past the minimum "backs out" of the focused item, mirroring
    // the zoom-in-to-enter gesture and returning to where the user came from.
    if (factor < 1 && this.doc.mode() === 'immersed' && old * factor < this.MIN_SCALE) {
      this.zoomOutExit();
      return;
    }

    const next = clamp(old * factor, this.MIN_SCALE, this.MAX_SCALE);

    const p = this.pan();
    const worldX = (cx - p.x) / old;
    const worldY = (cy - p.y) / old;
    this.pan.set({ x: cx - worldX * next, y: cy - worldY * next });
    this.scale.set(next);

    // Zoom far enough into a circle to "click" into it.
    if (factor > 1 && next >= this.ENTER_SCALE) {
      const target = this.nodeNearWorldPoint(worldX, worldY);
      if (target) this.activateByZoom(target);
    }
  }

  /** Leave the focused item, returning to the previous view when possible. */
  private zoomOutExit(): void {
    if (this.doc.mode() !== 'immersed') return;
    if (this.doc.canGoBack()) {
      this.runTransition(() => this.doc.goBack());
    } else {
      this.runTransition(() => this.doc.exitImmersed());
    }
  }

  private nodeNearWorldPoint(wx: number, wy: number): GraphNode | null {
    let best: GraphNode | null = null;
    let bestDist = Infinity;
    for (const gn of this.graph().nodes) {
      const d = Math.hypot(gn.x - wx, gn.y - wy);
      if (d < gn.size * 0.7 && d < bestDist) {
        best = gn;
        bestDist = d;
      }
    }
    return best;
  }

  private activateByZoom(gn: GraphNode): void {
    if (this.doc.mode() === 'immersed') {
      if (this.doc.canNavigateTo(gn.node) && gn.id !== this.doc.immersedNode()?.id) {
        this.runTransition(() => this.doc.navigateToImmersed(gn.id));
      }
      return;
    }
    if (this.doc.hasChildren(gn.id) || this.doc.canNavigateTo(gn.node)) {
      this.runTransition(() => this.doc.immerse(gn.id));
    }
  }

  protected onNodeActivated(gn: GraphNode): void {
    if (this.didPan) return;
    if (!gn.interactive) return;

    if (this.doc.mode() === 'immersed') {
      if (this.doc.canNavigateTo(gn.node)) {
        this.runTransition(() => this.doc.navigateToImmersed(gn.id));
      }
      return;
    }

    // canvas: satellites (data types around a peeked app) open directly
    if (gn.state === 'satellite') {
      this.enterImmersed(gn.id);
      return;
    }
    if (this.doc.peekId() === gn.id) {
      if (this.doc.hasChildren(gn.id) || this.doc.canNavigateTo(gn.node)) {
        this.enterImmersed(gn.id);
      }
      return;
    }
    this.doc.peekNodeById(gn.id);
  }

  protected enterImmersed(nodeId: string): void {
    this.runTransition(() => this.doc.immerse(nodeId));
  }

  protected exitImmersed(): void {
    this.runTransition(() => this.doc.exitImmersed());
  }

  protected zoomOutLevel(): void {
    this.runTransition(() => this.doc.zoomOutLevel());
  }

  protected returnToRoot(): void {
    this.runTransition(() => this.doc.navigateTo(this.doc.currentDocument().rootId));
  }

  protected immersedBackgroundStyle(): Record<string, string> | null {
    const node = this.doc.immersedNode();
    if (!node) return null;
    return { background: resolveImmersedBackdrop(node, this.doc.currentDocument()) };
  }

  private runTransition(action: () => void): void {
    if (this.transition() !== 'idle') return;
    this.transition.set('exit');
    setTimeout(() => {
      action();
      this.transition.set('enter');
      setTimeout(() => this.transition.set('idle'), 360);
    }, 280);
  }

  // ---- canvas layout ------------------------------------------------------

  private buildCanvas(rect: Rect): GraphModel {
    const all = this.doc.canvasNodes();
    const peekId = this.doc.peekId();
    const canvasRels = this.doc.canvasRelationships();
    const relatedIds = new Set<string>();
    if (peekId) {
      for (const rel of canvasRels) {
        if (rel.sourceId === peekId) relatedIds.add(rel.targetId);
        if (rel.targetId === peekId) relatedIds.add(rel.sourceId);
      }
    }
    const center: Pt = { x: rect.w / 2, y: rect.h / 2 };
    const m = Math.min(rect.w, rect.h);

    const appSize = clamp(m * 0.16, 84, 128);
    const peekSize = clamp(appSize * 1.5, 0, 240);

    // Group siblings by category so kindred items sit together, then fall back
    // to alphabetical order. The result reads as loose clusters rather than one
    // rigid ring, and pan/zoom handles overflow when there are many nodes.
    const groupOrder = [
      'environment',
      'application',
      'infrastructure',
      'process',
      'external-tool',
      'data-type',
    ];
    const rank = (n: AboardNode) => {
      const i = groupOrder.indexOf(this.doc.getCategory(n));
      return i === -1 ? groupOrder.length : i;
    };
    const nodes = [...all].sort(
      (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)
    );

    // Every shape (including diamonds/hexagons) is inscribed in the same square
    // box, so the grid cell is just the node footprint plus breathing room.
    const cell = appSize + appSize * (peekId ? 0.78 : 0.42);

    const n = nodes.length;
    const aspect = rect.w / Math.max(rect.h, 1);
    let cols = Math.max(1, Math.round(Math.sqrt(Math.max(1, n) * aspect)));
    cols = Math.min(cols, Math.max(1, n));
    const rows = Math.ceil(n / cols);

    const gridW = cols * cell;
    const gridH = rows * cell;
    const startX = center.x - gridW / 2 + cell / 2;
    const startY = center.y - gridH / 2 + cell / 2;

    const placed = new Map<string, GraphNode>();

    nodes.forEach((node, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      // Centre the final (possibly partial) row under the grid.
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const rowOffset = ((cols - inRow) * cell) / 2;
      const isPeek = node.id === peekId;
      const cat = this.doc.getCategory(node);
      placed.set(node.id, {
        id: node.id,
        node,
        x: startX + c * cell + rowOffset,
        y: startY + r * cell,
        size: isPeek ? this.renderSize(cat, peekSize) : this.renderSize(cat, appSize),
        state: !peekId ? 'default' : isPeek ? 'peek' : relatedIds.has(node.id) ? 'related' : 'dimmed',
        interactive: true,
      });
    });

    const satellites: GraphNode[] = [];
    if (peekId) {
      const hub = placed.get(peekId);
      const sats = this.doc.peekSatellites();
      if (hub && sats.length) {
        const count = sats.length;
        const satSize = appSize * (count > 6 ? 0.56 : count > 3 ? 0.66 : 0.76);
        // Ring the satellites fully around the peeked hub (the grid leaves no
        // empty centre to fan into), spacing the radius by arc length.
        const minGap = satSize * 1.32;
        const ringR = Math.max(
          hub.size / 2 + satSize / 2 + 38,
          count > 1 ? (minGap * count) / (2 * Math.PI) : 0
        );
        const satAngles = ringAngles(count, -90, 360);
        sats.forEach((node, i) => {
          const p = polar(hub, ringR, satAngles[i]);
          const gn: GraphNode = {
            id: node.id,
            node,
            x: p.x,
            y: p.y,
            size: this.renderSize(this.doc.getCategory(node), satSize),
            state: 'satellite',
            interactive: this.doc.canNavigateTo(node),
          };
          satellites.push(gn);
          placed.set(node.id, gn);
        });
      }
    }

    const specs: LinkSpec[] = [];

    // When a node is peeked, the hub anchors at its grid slot and everything
    // else is settled by the force engine so nothing overlaps the hub or each
    // other. Related apps form a halo ring; the rest hold their grid slots.
    if (peekId) {
      const hub = placed.get(peekId);
      if (hub) {
        const center: Pt = { x: hub.x, y: hub.y };
        const hubGap = hub.size / 2 + appSize / 2 + 140;
        const bodies: ForceBody[] = [];
        for (const gn of placed.values()) {
          if (gn.id === peekId) {
            bodies.push({ id: gn.id, x: gn.x, y: gn.y, radius: gn.size / 2, fixed: true });
            continue;
          }
          if (relatedIds.has(gn.id)) {
            const dx = gn.x - hub.x;
            const dy = gn.y - hub.y;
            const d = Math.hypot(dx, dy) || 1;
            bodies.push({
              id: gn.id,
              x: hub.x + (dx / d) * hubGap,
              y: hub.y + (dy / d) * hubGap,
              radius: gn.size / 2,
              targetRadius: hubGap,
              radialStrength: 0.4,
            });
          } else {
            const anchorStrength = gn.state === 'satellite' ? 0.35 : 0.6;
            bodies.push({
              id: gn.id,
              x: gn.x,
              y: gn.y,
              radius: gn.size / 2,
              anchor: { x: gn.x, y: gn.y },
              anchorStrength,
            });
          }
        }
        this.settleGraph(
          bodies,
          { center, collidePadding: 10 },
          this.layoutSignature('canvas', peekId, rect, bodies)
        );
        for (const body of bodies) {
          const gn = placed.get(body.id);
          if (!gn || gn.id === peekId) continue;
          gn.x = body.x ?? gn.x;
          gn.y = body.y ?? gn.y;
        }
      }
    }

    for (const rel of canvasRels) {
      const a = placed.get(rel.sourceId);
      const b = placed.get(rel.targetId);
      if (!a || !b) continue;
      const active = !!peekId && (rel.sourceId === peekId || rel.targetId === peekId);
      specs.push({
        id: rel.id,
        a,
        b,
        variant: active ? 'active' : 'faint',
        label: active ? rel.label : undefined,
      });
    }

    // peek hub -> its data-type satellites only (deeper chains live in the
    // immersed view, so the root canvas stays free of long crossing lines)
    if (peekId) {
      const hub = placed.get(peekId)!;
      for (const sat of satellites) {
        specs.push({
          id: `hub-${sat.id}`,
          a: hub,
          b: sat,
          variant: 'active',
          center: { x: hub.x, y: hub.y },
          routing: 'elbow-target',
        });
      }
    }

    return { nodes: [...placed.values()], links: this.buildLinks(specs) };
  }

  // ---- immersed layout ----------------------------------------------------

  private buildImmersed(rect: Rect): GraphModel {
    const focus = this.doc.immersedNode();
    if (!focus) return { nodes: [], links: [] };

    const rows = this.doc.immersedRows();
    const creators = this.doc.immersedCreators();

    const panelW = this.hasInfoPanel() ? Math.min(380, rect.w * 0.34) : 0;
    const graphW = rect.w - panelW;
    const center: Pt = { x: panelW + graphW / 2, y: rect.h / 2 };
    const viewportMin = Math.min(graphW, rect.h);
    const m = viewportMin;

    interface Leaf {
      target: AboardNode;
      relLabel?: string;
      relId: string;
      groupIdx: number;
      incoming?: boolean;
    }
    const leaves: Leaf[] = [];
    rows.forEach((row, gi) => {
      if (row.kind === 'outbound') {
        leaves.push({
          target: row.target,
          relLabel: row.relationship.label,
          relId: row.relationship.id,
          groupIdx: -1,
          incoming: row.incoming,
        });
      } else {
        row.branches.forEach((b) =>
          leaves.push({
            target: b.target,
            relLabel: b.relationship.label,
            relId: b.relationship.id,
            groupIdx: gi,
            incoming: b.incoming,
          })
        );
      }
    });
    creators.forEach((c) => {
      leaves.push({
        target: c.source,
        relLabel: c.relationship.label ?? 'Creates',
        relId: c.relationship.id,
        groupIdx: -1,
        incoming: true,
      });
    });

    const leafCount = leaves.length;
    const showLinkLabels = leafCount <= 8;

    // Scale node sizes down as the relationship count grows so dense domain
    // views (e.g. Clinical Data with dozens of branches) stay legible.
    const density = clamp(Math.sqrt(16 / Math.max(leafCount, 1)), 0.46, 1);
    const focusSize = clamp(m * 0.13 * Math.min(1, 18 / Math.sqrt(Math.max(leafCount, 1))), 72, 120);
    const relSize = clamp(m * 0.115 * density, 38, 96);
    const interSize = relSize * 0.84;
    const focusR = focusSize / 2;
    const relR = relSize / 2;
    const interR = interSize / 2;

    const layoutScale = clamp(1 + leafCount / 18, 1.22, 2.15);
    const maxRo = viewportMin * 0.49 * layoutScale - relR - 8;

    const totalGap = Math.max(48, maxRo - focusR - 2 * interR - relR);
    const gap1 = totalGap * 0.58;
    const Ri = focusR + gap1 + interR;

    const leafClearance = relSize * 0.42 + 18;
    const minRo = Ri + interR + relR + leafClearance;
    const minRingStep = relSize * 1.22 + 10;

    const focusGn: GraphNode = {
      id: focus.id,
      node: focus,
      x: center.x,
      y: center.y,
      size: this.renderSize(this.doc.getCategory(focus), focusSize),
      state: 'focus',
      interactive: false,
    };
    const nodes: GraphNode[] = [focusGn];

    // Group leaves by branch so each app's relationships occupy their own
    // angular sector instead of one overcrowded ring.
    const groupKeys = [...new Set(leaves.map((l) => l.groupIdx))].sort((a, b) => a - b);
    const sectorGap = groupKeys.length > 1 ? 22 : 0;
    const totalSpan = 360 - sectorGap * groupKeys.length;
    const groupCenters = new Map<number, number>();
    const leafSlots = new Map<number, { angle: number; radius: number }>();
    const branchGroupIndices = new Set(
      rows.map((row, gi) => (row.kind === 'branch' ? gi : -1)).filter((gi) => gi >= 0)
    );

    let cursor = -90;
    for (const gi of groupKeys) {
      const groupLeaves = leaves.filter((l) => l.groupIdx === gi);
      const n = groupLeaves.length;
      const span = (n / Math.max(leafCount, 1)) * totalSpan;
      const sectorCenter = snapAngle(cursor + span / 2);
      groupCenters.set(gi, sectorCenter);

      const hasHub = branchGroupIndices.has(gi);
      const hubReserve = hasHub
        ? Math.max(16, minSeparationDeg(interSize + relSize + 8, Ri, 16))
        : 0;

      const minArc = relSize * 2.05 + 14;
      const ringSpan = span * 0.72;
      const wingSpan = hasHub ? ringSpan * 0.92 : ringSpan;
      const avgR = (minRo + maxRo) / 2;
      const effectiveSpan = hasHub ? Math.max(wingSpan, hubReserve * 2.6) : ringSpan;
      const maxPerRing = Math.max(
        1,
        Math.floor(((effectiveSpan * Math.PI) / 180) * avgR / minArc)
      );
      let ringCount = Math.min(4, Math.max(1, Math.ceil(n / maxPerRing)));
      let ringStep =
        ringCount > 1 ? Math.max(minRingStep, (maxRo - minRo) / (ringCount - 1)) : 0;
      if (ringCount > 1 && ringStep * (ringCount - 1) > maxRo - minRo) {
        ringCount = Math.max(1, Math.floor((maxRo - minRo) / minRingStep) + 1);
        ringStep = ringCount > 1 ? (maxRo - minRo) / (ringCount - 1) : 0;
      }

      let li = 0;
      for (let ring = 0; ring < ringCount && li < n; ring++) {
        const remaining = n - li;
        const ringsLeft = ringCount - ring;
        const onRing = Math.ceil(remaining / ringsLeft);
        const ringRadius = minRo + ring * ringStep;
        const ringStagger = ring % 2 === 1 ? effectiveSpan / (onRing + 2) : 0;
        let angles = hasHub
          ? wingAngles(sectorCenter, hubReserve + ring * 2.5, onRing, wingSpan)
          : fanAngles(sectorCenter + ringStagger, onRing, ringSpan);
        angles = angles.map((angle) => snapAngle(angle));

        if (hasHub && onRing === 1) {
          const side = ring % 2 === 0 ? 1 : -1;
          angles = [snapAngle(sectorCenter + side * (hubReserve + ring * 6 + 10))];
        }

        for (let j = 0; j < onRing && li < n; j++) {
          const globalIdx = leaves.indexOf(groupLeaves[li]);
          leafSlots.set(globalIdx, { angle: angles[j], radius: ringRadius });
          li++;
        }
      }

      cursor += span + sectorGap;
    }

    const intermediates = new Map<number, GraphNode>();
    const byId = new Map<string, GraphNode>([[focus.id, focusGn]]);
    const bodies: ForceBody[] = [
      { id: focus.id, x: center.x, y: center.y, radius: focusSize / 2, fixed: true },
    ];

    rows.forEach((row, gi) => {
      if (row.kind !== 'branch') return;
      const angle = groupCenters.get(gi) ?? -90;
      const ip = polar(center, Ri, angle);
      const inter: GraphNode = {
        id: row.source.id,
        node: row.source,
        x: ip.x,
        y: ip.y,
        size: this.renderSize(this.doc.getCategory(row.source), interSize),
        state: 'intermediate',
        interactive: this.doc.canNavigateTo(row.source),
        caption: showLinkLabels ? undefined : row.entryLabel,
      };
      intermediates.set(gi, inter);
      nodes.push(inter);
      byId.set(inter.id, inter);
      bodies.push({
        id: inter.id,
        x: inter.x,
        y: inter.y,
        radius: this.collisionSize(inter) / 2,
        targetRadius: Ri,
        radialStrength: 0.85,
      });
    });

    // A node reachable through more than one relationship (e.g. a two-way
    // relationship) must render as a single circle, not stacked duplicates, so
    // place each target once and let every relationship draw its own arrow to it.
    leaves.forEach((leaf, i) => {
      if (byId.has(leaf.target.id)) return;
      const slot = leafSlots.get(i) ?? { angle: -90, radius: maxRo };
      const p = polar(center, slot.radius, slot.angle);
      const gn: GraphNode = {
        id: leaf.target.id,
        node: leaf.target,
        x: p.x,
        y: p.y,
        size: this.renderSize(this.doc.getCategory(leaf.target), relSize),
        state: leaf.incoming ? 'creator' : 'related',
        interactive: this.doc.canNavigateTo(leaf.target),
        caption: showLinkLabels ? undefined : leaf.relLabel,
      };
      nodes.push(gn);
      byId.set(gn.id, gn);
      bodies.push({
        id: gn.id,
        x: gn.x,
        y: gn.y,
        radius: this.collisionSize(gn) / 2,
        targetRadius: Math.max(slot.radius, minRo),
        radialStrength: 0.5,
      });
    });

    this.settleGraph(bodies, { center }, this.layoutSignature('immersed', focus.id, rect, bodies));

    for (const body of bodies) {
      const gn = byId.get(body.id);
      if (!gn || gn.state === 'focus') continue;
      gn.x = body.x ?? gn.x;
      gn.y = body.y ?? gn.y;
      if (gn.caption) gn.captionSide = this.captionSide(center, gn);
    }

    this.applyTemporaryNodePositions(nodes, center);

    const specs: LinkSpec[] = [];
    rows.forEach((row, gi) => {
      if (row.kind !== 'branch') return;
      const inter = intermediates.get(gi);
      if (!inter) return;
      specs.push({
        id: `e-${row.source.id}`,
        a: focusGn,
        b: inter,
        variant: 'active',
        label: showLinkLabels ? row.entryLabel : undefined,
        center,
        routing: 'straight',
      });
    });

    leaves.forEach((leaf) => {
      const gn = byId.get(leaf.target.id);
      if (!gn) return;
      const label = showLinkLabels ? leaf.relLabel : undefined;
      const hub = leaf.groupIdx >= 0 ? intermediates.get(leaf.groupIdx) ?? focusGn : focusGn;
      if (leaf.incoming) {
        specs.push({ id: `c-${leaf.relId}`, a: gn, b: hub, variant: 'active', label, center, routing: 'straight' });
      } else {
        specs.push({ id: `l-${leaf.relId}`, a: hub, b: gn, variant: 'active', label, center, routing: 'straight' });
      }
    });

    return { nodes, links: this.buildLinks(specs) };
  }

  // ---- helpers ------------------------------------------------------------

  // All categories now share the same footprint (rounded squares, plus circular
  // data types), so no per-category size correction is needed.
  private renderSize(_category: string, base: number): number {
    return base;
  }

  private applyTemporaryNodePositions(nodes: GraphNode[], center: Pt): void {
    const positions = this.temporaryNodePositions();
    for (const gn of nodes) {
      const position = positions[gn.id];
      if (!position) continue;
      gn.x = position.x;
      gn.y = position.y;
      if (gn.caption) gn.captionSide = this.captionSide(center, gn);
    }
  }

  private collisionSize(gn: GraphNode): number {
    if (!gn.caption) return gn.size;
    const captionWidth = Math.min(170, gn.caption.length * 6.8 + 28);
    return Math.max(gn.size + 52, captionWidth + 32);
  }

  private captionSide(center: Pt, gn: GraphNode): 'top' | 'right' | 'bottom' | 'left' {
    const dx = gn.x - center.x;
    const dy = gn.y - center.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.15) {
      return dx < 0 ? 'left' : 'right';
    }
    return dy < 0 ? 'top' : 'bottom';
  }

  /**
   * Turn link specs into rendered links, bowing parallel / reciprocal edges
   * apart. Every edge between the same pair of nodes is gathered together and
   * assigned its own lane offset (in a direction-independent frame) so a
   * two-way relationship renders as two arcs on opposite sides — both arrows
   * and both labels remain visible instead of stacking on one straight line.
   */
  private buildLinks(specs: LinkSpec[]): GraphLink[] {
    const groups = new Map<string, LinkSpec[]>();
    for (const spec of specs) {
      const key = [spec.a.id, spec.b.id].sort().join('::');
      const group = groups.get(key);
      if (group) group.push(spec);
      else groups.set(key, [spec]);
    }

    const result: GraphLink[] = [];
    for (const group of groups.values()) {
      const n = group.length;
      const lane = Math.min(30, 18 + n * 2);
      group.forEach((spec, i) => {
        let offset = 0;
        if (n > 1) {
          // Lane in a canonical (id-sorted) frame so reciprocal edges bow to
          // opposite physical sides regardless of their arrow direction.
          const canonicalFirst = [spec.a.id, spec.b.id].sort()[0];
          const sign = spec.a.id === canonicalFirst ? 1 : -1;
          offset = (i - (n - 1) / 2) * lane * sign;
        }
        result.push(this.makeLink(spec.id, spec.a, spec.b, spec.variant, spec.label, {
          center: spec.center,
          routing: spec.routing,
          curveOffset: offset,
        }));
      });
    }
    return result;
  }

  private makeLink(
    id: string,
    a: GraphNode,
    b: GraphNode,
    variant: 'faint' | 'active',
    label?: string,
    options?: { center?: Pt; routing?: LinkRouting; curveOffset?: number }
  ): GraphLink {
    const startGap = a.size / 2 + 4;
    const endGap = b.size / 2 + (variant === 'active' ? 11 : 4);
    const from = { x: a.x, y: a.y };
    const to = { x: b.x, y: b.y };
    const routing = options?.routing ?? 'straight';
    const curveOffset = options?.curveOffset ?? 0;

    let routed;
    if (Math.abs(curveOffset) > 0.5) {
      routed = routedCurvedPath(from, to, startGap, endGap, curveOffset);
    } else if (routing === 'straight' || !options?.center) {
      routed = routedStraightPath(from, to, startGap, endGap);
    } else if (routing === 'channel') {
      routed = routedChannelPath(from, to, options.center, startGap, endGap);
    } else {
      const bend =
        routing === 'elbow-source'
          ? sourceRadialBend(from, to, options.center)
          : targetRadialBend(from, to, options.center);
      routed = routedElbowPath(from, to, bend, startGap, endGap);
    }

    // Curved edges already carry their label out to the arc apex; only nudge
    // straight edges whose label would otherwise sit on the stroke.
    const labelPoint =
      Math.abs(curveOffset) > 0.5
        ? { x: routed.labelX, y: routed.labelY }
        : this.positionLinkLabel(from, to, routed.labelX, routed.labelY, label);

    return {
      id,
      path: routed.d,
      variant,
      label: variant === 'active' ? label : undefined,
      labelX: labelPoint.x,
      labelY: labelPoint.y,
    };
  }

  /**
   * Settle bodies so none overlap, reusing the cached result when only
   * transient state (e.g. a node drag) changed. Mutates each body's x/y.
   */
  private settleGraph(bodies: ForceBody[], options: SettleOptions, cacheKey: string): void {
    if (cacheKey && cacheKey === this.layoutCacheKey) {
      for (const body of bodies) {
        const cached = this.layoutCachePositions.get(body.id);
        if (cached) {
          body.x = cached.x;
          body.y = cached.y;
        }
      }
      return;
    }
    settleForceLayout(bodies, options);
    if (cacheKey) {
      this.layoutCacheKey = cacheKey;
      this.layoutCachePositions = new Map(
        bodies.map((b) => [b.id, { x: b.x ?? 0, y: b.y ?? 0 }])
      );
    }
  }

  /** Structural fingerprint of a layout: stable across pans, drags and zooms. */
  private layoutSignature(
    mode: string,
    focusId: string,
    rect: Rect,
    bodies: ForceBody[]
  ): string {
    const shape = bodies
      .map((b) => `${b.id}:${Math.round(b.radius)}:${Math.round(b.targetRadius ?? -1)}`)
      .join('|');
    return `${mode}#${focusId}#${Math.round(rect.w)}x${Math.round(rect.h)}#${shape}`;
  }

  private positionLinkLabel(
    from: Pt,
    to: Pt,
    labelX: number,
    labelY: number,
    label?: string
  ): Pt {
    if (!label) return { x: labelX, y: labelY };

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const estimatedLabelWidth = label.length * 6.5;
    if (len > estimatedLabelWidth + 120) {
      return { x: labelX, y: labelY };
    }

    // Short links need their text off the stroke, otherwise the caption covers
    // both the arrow shaft and the relationship direction.
    const lift = Math.max(34, Math.min(58, estimatedLabelWidth / 4));
    const nx = -dy / len;
    return {
      x: labelX + nx * lift * 0.45,
      y: labelY - lift,
    };
  }

}
