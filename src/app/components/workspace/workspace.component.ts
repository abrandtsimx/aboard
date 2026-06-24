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
import { AboardNode, AboardRelationship, NodeShape } from '../../models/aboard.models';
import {
  Pt,
  clamp,
  polar,
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
  angleDeg,
  radius,
} from '../../utils/layout.util';
import { ForceBody, settleForceLayout, SettleOptions } from '../../utils/force-layout.util';
import { categoryLabel, getNodeCategory } from '../../utils/category.util';
import { defaultShapeForCategory, findSchemaType, resolveNodeStyle } from '../../utils/node-style.util';
import { shapeBoundaryDistance } from '../../utils/shape-boundary.util';
import { injectReferenceMarkdown, NODE_REF_HREF_PREFIX } from '../../utils/item-reference.util';
import {
  applyLinkLaneOffsets,
  hubNeighborPairs,
  INSPECTION_LANE_MIN_BOW,
} from '../../utils/inspection-layout.util';

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
  reverseLabel?: string;
  reverseLabelX?: number;
  reverseLabelY?: number;
  markerStart?: boolean;
  markerEnd?: boolean;
  /** Derived from a `{id}` mention in a label — renders faint and dashed. */
  reference?: boolean;
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
  curveOffset?: number;
  labelAlongOffset?: number;
  bidirectional?: boolean;
  reverseLabel?: string;
  reference?: boolean;
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
  target: HTMLElement;
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

  /** Counter-scale the inspection veil so it always fills the stage, not the zoomed graph bounds. */
  protected readonly peekVeilStyle = computed<Record<string, string> | null>(() => {
    const mode = this.doc.mode();
    const peeking =
      (mode === 'canvas' && !!this.doc.peekId()) ||
      (mode === 'immersed' && !!this.doc.immersedPreviewNodeId());
    if (!peeking) return null;

    const rect = this.rect();
    if (!rect) return null;

    const s = this.scale() || 1;
    const p = this.pan();
    const bleed = 2 / s;
    return {
      left: `${-p.x / s - bleed}px`,
      top: `${-p.y / s - bleed}px`,
      width: `${rect.w / s + bleed * 2}px`,
      height: `${rect.h / s + bleed * 2}px`,
    };
  });

  private readonly MIN_SCALE = 0.45;
  private readonly MAX_SCALE = 3.2;
  private readonly ENTER_SCALE = 2.4;
  /** Extra center-to-center gap beyond node radii in the inspection phase. */
  private readonly OVERVIEW_MIN_LINK_GAP = 52;
  private readonly OVERVIEW_SPREAD_PASSES = 6;
  /** Minimum clearance between any two node shapes during inspection. */
  private readonly INSPECTION_NODE_MIN_GAP = 30;
  /** Lateral bow for multiple labeled links leaving the same hub. */
  private readonly INSPECTION_LINK_LANE = 38;
  /** Minimum bow when routing around a node that blocks the straight chord. */
  private readonly INSPECTION_OBSTACLE_CLEARANCE = 30;
  /** Hub links closer than this (degrees) are curved apart; others stay straight. */
  private readonly INSPECTION_CROWD_ANGLE_DEG = 55;

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
  /** After a zoom-out exit, pan the viewport to the node the user left. */
  private pendingCameraFocusNodeId: string | null = null;
  private lastNavigationKey = '';

  protected readonly graph = computed<GraphModel>(() => {
    const rect = this.rect();
    if (!rect || rect.w < 40 || rect.h < 40) return { nodes: [], links: [] };
    const mode = this.doc.mode();
    // Explicit deps so preview/peek changes always rebuild the layout.
    void this.doc.immersedPreviewNodeId();
    void this.doc.peekId();
    void this.doc.focusPathIds();
    return mode === 'immersed' ? this.buildImmersed(rect) : this.buildCanvas(rect);
  });

  /**
   * The node whose details the inspector shows. In immersed mode that's the
   * focused node; on the canvas it's whatever is peeked, falling back to the
   * container being viewed (e.g. the ecosystem at the root) so every level —
   * not just dived-into apps — gets its own overview.
   */
  protected readonly inspectedNode = computed<AboardNode | null>(() => {
    if (this.doc.mode() === 'immersed') {
      return this.doc.immersedNode() ?? null;
    }
    return this.doc.peekNode() ?? this.doc.focusedNode() ?? null;
  });

  protected readonly inspectorHtml = computed<string>(() => {
    const node = this.inspectedNode();
    if (!node) return '';
    const fallback = [
      node.description ? `## Overview\n\n${node.description}` : '## Overview',
      'No additional information has been added for this item yet.',
    ].join('\n\n');
    const source = node.content?.trim() || fallback;
    const withRefs = injectReferenceMarkdown(source, (id) => this.doc.findNode(id)?.label);
    return marked.parse(withRefs, { async: false }) as string;
  });

  /** Intercept clicks on `{id}` markdown links and navigate within the board. */
  protected onMarkdownClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith(NODE_REF_HREF_PREFIX)) return;
    event.preventDefault();
    const id = decodeURIComponent(href.slice(NODE_REF_HREF_PREFIX.length));
    if (this.doc.findNode(id)) this.doc.navigateTo(id);
  }

  protected markerEndUrl(link: GraphLink): string | null {
    if (link.markerEnd === false) return null;
    if (link.reference) return 'url(#arrow-faint)';
    if (link.variant === 'active') return 'url(#arrow-active)';
    return null;
  }

  protected inspectedCategoryLabel(): string {
    const node = this.inspectedNode();
    return node ? categoryLabel(getNodeCategory(node)) : '';
  }

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
    return !!this.inspectedNode() && !!rect && rect.w > 700;
  }

  /** First-click Inspection View (Map peek or Focused preview) — not the detail page. */
  protected isOverviewPeek(): boolean {
    return (
      (this.doc.mode() === 'canvas' && !!this.doc.peekId()) ||
      (this.doc.mode() === 'immersed' && !!this.doc.immersedPreviewNodeId())
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

    // Reset pan/zoom on navigation changes only — inspection toggles (peek /
    // focused preview) must not move the camera. Do not read `graph()` here:
    // the graph computed returns a new object every rebuild, and clearing
    // temporaryNodePositions triggers a rebuild (infinite effect loop).
    effect(() => {
      const navKey = [
        this.doc.mode(),
        this.doc.focusPathIds().join('/'),
        this.doc.immersedNode()?.id ?? '',
      ].join('|');
      const peekId = this.doc.peekId();
      const previewId = this.doc.immersedPreviewNodeId();
      const navChanged = navKey !== this.lastNavigationKey;
      this.lastNavigationKey = navKey;

      untracked(() => {
        this.temporaryNodePositions.set({});
        this.nodeDrag = null;
        this.draggingNodeId.set(null);

        if (!navChanged) {
          // Inspection-only change: restore layout positions, keep camera.
          void peekId;
          void previewId;
          return;
        }

        queueMicrotask(() => {
          this.resetView();
          const focusId = this.pendingCameraFocusNodeId;
          if (focusId) {
            this.pendingCameraFocusNodeId = null;
            queueMicrotask(() => this.focusCameraOnNode(focusId));
          }
        });
      });
    });
  }

  /** Pan so `nodeId` sits at the center of the stage viewport. */
  private focusCameraOnNode(nodeId: string): void {
    const rect = this.rect();
    if (!rect) return;
    const gn = this.graph().nodes.find((n) => n.id === nodeId);
    if (!gn) return;
    const scale = this.scale();
    this.pan.set({
      x: rect.w / 2 - gn.x * scale,
      y: rect.h / 2 - gn.y * scale,
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
      return;
    }
    if (this.doc.immersedPreviewNodeId()) {
      this.doc.clearImmersedPreview();
    }
  }

  protected onGraphNodePointerDown(event: PointerEvent, gn: GraphNode): void {
    if (this.doc.mode() !== 'immersed' || event.button !== 0) return;
    event.stopPropagation();
    // Capture is deferred until the pointer actually moves so the inner orbit
    // button still receives a reliable click for preview / navigation.
    this.nodeDrag = {
      id: gn.id,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: gn.x, y: gn.y },
      moved: false,
      target: event.currentTarget as HTMLElement,
    };
    this.draggingNodeId.set(gn.id);
  }

  private onGraphNodePointerMove(event: PointerEvent): void {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const screenDx = event.clientX - drag.startClient.x;
    const screenDy = event.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(screenDx, screenDy) < 4) return;

    if (!drag.moved) {
      drag.moved = true;
      drag.target.setPointerCapture(event.pointerId);
    }
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

  private endGraphNodeDrag(event: PointerEvent): void {
    const drag = this.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      drag.target.releasePointerCapture(event.pointerId);
      this.didPan = true;
      setTimeout(() => (this.didPan = false));
    }
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
    if (this.nodeDrag) {
      this.onGraphNodePointerMove(event);
      return;
    }
    if (!this.pointerActive) return;
    const dx = event.clientX - this.panStart.x;
    const dy = event.clientY - this.panStart.y;
    if (!this.didPan && Math.hypot(dx, dy) < 5) return;
    this.didPan = true;
    this.panning.set(true);
    this.pan.set({ x: this.panOrigin.x + dx, y: this.panOrigin.y + dy });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.nodeDrag) {
      this.endGraphNodeDrag(event);
      return;
    }
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

    // Only back out when already zoomed out to the floor — an extra wheel tick
    // past the minimum, not the first zoom-out gesture from a normal view.
    if (factor < 1 && this.doc.mode() === 'immersed' && old <= this.MIN_SCALE + 0.001) {
      if (this.doc.immersedPreviewNodeId()) {
        this.doc.clearImmersedPreview();
      } else {
        this.zoomOutExit();
      }
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

  /** Leave the focused item, returning to the previous breadcrumb step. */
  private zoomOutExit(): void {
    if (this.doc.mode() !== 'immersed') return;

    const exitingId = this.doc.immersedNodeId();
    if (!exitingId) return;

    this.pendingCameraFocusNodeId = exitingId;

    this.runTransition(() => {
      let moved = false;
      if (this.doc.canGoBack()) {
        this.doc.goBack();
        moved = true;
      } else if (this.doc.stepBackInTrail()) {
        moved = true;
      }

      if (!moved) {
        this.pendingCameraFocusNodeId = null;
        return;
      }

      this.doc.focusAfterTrailStepBack(exitingId);
    });
  }

  private nodeNearWorldPoint(wx: number, wy: number): GraphNode | null {
    let best: GraphNode | null = null;
    let bestDist = Infinity;
    for (const gn of this.graph().nodes) {
      // The occupied page hub is not a zoom target — only related/preview nodes are.
      if (this.doc.mode() === 'immersed' && gn.state === 'focus' && !gn.interactive) continue;
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
      if (gn.state === 'focus' && !gn.interactive) return;
      this.onImmersedNodeActivated(gn);
      return;
    }
    if (this.doc.hasChildren(gn.id) || this.doc.canNavigateTo(gn.node)) {
      this.runTransition(() => this.doc.immerse(gn.id));
    }
  }

  private onImmersedNodeActivated(gn: GraphNode): void {
    const previewId = this.doc.immersedPreviewNodeId();
    const pageId = this.doc.immersedNodeId();

    // Already on this page — the center hub is not re-enterable.
    if (pageId === gn.id && previewId !== gn.id) return;

    if (previewId === gn.id) {
      if (pageId === gn.id) return;
      if (this.doc.hasChildren(gn.id) || this.doc.canNavigateTo(gn.node)) {
        this.runTransition(() => this.doc.navigateToImmersed(gn.id));
      }
      return;
    }

    if (previewId && pageId === gn.id) {
      this.doc.clearImmersedPreview();
      return;
    }

    if (this.doc.canNavigateTo(gn.node)) {
      this.doc.setImmersedPreview(gn.id);
    }
  }

  protected onNodeActivated(gn: GraphNode): void {
    if (this.didPan) return;

    if (this.doc.mode() === 'immersed') {
      if (gn.state === 'focus' && !gn.interactive) return;
      this.onImmersedNodeActivated(gn);
      return;
    }

    if (!gn.interactive) return;

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

  protected confirmImmersedPreview(nodeId: string): void {
    this.runTransition(() => this.doc.navigateToImmersed(nodeId));
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
      for (const rel of this.doc.currentDocument().relationships) {
        if (rel.sourceId === peekId && !this.doc.isStructuralRootNode(rel.targetId)) {
          relatedIds.add(rel.targetId);
        }
        if (rel.targetId === peekId && !this.doc.isStructuralRootNode(rel.sourceId)) {
          relatedIds.add(rel.sourceId);
        }
      }
      if (this.doc.atMapRoot() && this.doc.usesRootItems()) {
        for (const link of this.doc.mapViewLinks()) {
          if (link.sourceId === peekId) relatedIds.add(link.targetId);
          if (link.targetId === peekId) relatedIds.add(link.sourceId);
        }
      }
    }
    // Reserve room for the inspector docked on the left so the grid centers in
    // the remaining space instead of hiding nodes behind the panel.
    const panelW = this.hasInfoPanel() ? Math.min(380, rect.w * 0.34) : 0;
    const graphW = rect.w - panelW;
    const center: Pt = { x: panelW + graphW / 2, y: rect.h / 2 };
    const m = Math.min(graphW, rect.h);

    const appSize = clamp(m * 0.16, 84, 128);
    const peekSize = clamp(appSize * 1.28, 0, 200);

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
    const cell = appSize + appSize * 0.42;

    const n = nodes.length;
    const aspect = graphW / Math.max(rect.h, 1);
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
      const sats = [...this.doc.peekSatellites()];
      for (const { node: refNode } of this.doc.labelReferencedNeighbors(peekId)) {
        if (!placed.has(refNode.id) && !sats.some((s) => s.id === refNode.id)) {
          sats.push(refNode);
        }
      }
      if (hub && sats.length) {
        const count = sats.length;
        const satSize = appSize * (count > 6 ? 0.56 : count > 3 ? 0.66 : 0.76);
        const satAngles = this.assignSatelliteAngles(sats);
        // Ring the satellites around the peeked hub (the grid leaves no empty
        // centre to fan into), sizing the radius by arc length. Satellites only
        // occupy the spanned arc (not the full circle), so size the radius to
        // the densest wedge or they bunch together.
        const minGap = satSize * 1.32;
        const angleSpanRad = this.satelliteArcSpanRad(satAngles);
        const ringR = Math.max(
          hub.size / 2 + satSize / 2 + 68,
          count > 1 ? (minGap * (count - 1)) / Math.max(angleSpanRad, 0.5) : 0,
          appSize * 1.08
        );
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

    if (peekId) {
      const activeLabels = this.peekRelationshipLabels(peekId);
      const linkedTargets = this.peekRelationshipNeighborIds(peekId);
      const pairs: Array<[string, string]> = [];
      for (const rel of this.doc.currentDocument().relationships) {
        if (rel.sourceId !== peekId && rel.targetId !== peekId) continue;
        if (
          this.doc.isStructuralRootNode(rel.sourceId) ||
          this.doc.isStructuralRootNode(rel.targetId)
        ) {
          continue;
        }
        if (!placed.has(rel.sourceId) || !placed.has(rel.targetId)) continue;
        pairs.push([rel.sourceId, rel.targetId]);
      }
      for (const sat of satellites) {
        if (!linkedTargets.has(sat.id)) pairs.push([peekId, sat.id]);
      }
      for (const [aId, bId] of hubNeighborPairs([...linkedTargets])) {
        pairs.push([aId, bId]);
      }
      this.relaxInspectionLayout(placed, pairs, new Set([peekId]), (aId, bId) => {
        const label = activeLabels.get(this.linkPairKey(aId, bId));
        if (label) return this.minLinkGapForLabel(label);
        if (aId !== peekId && bId !== peekId) {
          return this.INSPECTION_NODE_MIN_GAP * 2.2;
        }
        return this.OVERVIEW_MIN_LINK_GAP;
      });
      for (const gn of placed.values()) {
        if (gn.caption) gn.captionSide = this.captionSide(center, gn);
      }
      for (const { node: refNode } of this.doc.labelReferencedNeighbors(peekId)) {
        const refGn = placed.get(refNode.id);
        if (refGn?.state === 'dimmed') refGn.state = 'related';
      }
    }

    const specs: LinkSpec[] = [];

    if (this.doc.usesMapViewLinkRules()) {
      for (const link of this.doc.mapViewLinks()) {
        const a = placed.get(link.sourceId);
        const b = placed.get(link.targetId);
        if (!a || !b) continue;
        specs.push({
          id: link.id,
          a,
          b,
          variant: 'faint',
        });
      }
    } else {
      const peekRelKeys = new Set<string>();
      if (peekId) {
        for (const rel of this.peekRelationships(peekId, placed)) {
          peekRelKeys.add(this.linkPairKey(rel.sourceId, rel.targetId));
          specs.push({
            id: rel.id,
            a: placed.get(rel.sourceId)!,
            b: placed.get(rel.targetId)!,
            variant: 'active',
            label: rel.label,
            bidirectional: rel.bidirectional,
          });
        }
      }

      for (const rel of canvasRels) {
        const a = placed.get(rel.sourceId);
        const b = placed.get(rel.targetId);
        if (!a || !b) continue;
        const key = this.linkPairKey(rel.sourceId, rel.targetId);
        if (peekId && peekRelKeys.has(key)) continue;
        const active = !!peekId && (rel.sourceId === peekId || rel.targetId === peekId);
        specs.push({
          id: rel.id,
          a,
          b,
          variant: active ? 'active' : 'faint',
          label: active ? rel.label : undefined,
          bidirectional: rel.bidirectional,
        });
      }

      if (peekId && this.doc.atMapRoot() && this.doc.usesRootItems()) {
        for (const link of this.doc.mapViewLinks()) {
          if (link.sourceId !== peekId && link.targetId !== peekId) continue;
          const a = placed.get(link.sourceId);
          const b = placed.get(link.targetId);
          if (!a || !b) continue;
          specs.push({
            id: link.id,
            a,
            b,
            variant: 'active',
          });
        }
      }
    }

    // peek hub -> its data-type satellites only (deeper chains live in the
    // immersed view, so the root canvas stays free of long crossing lines).
    // Skip satellites already connected by an explicit relationship — otherwise
    // buildLinks draws two same-direction arrows on one pair (relationship +
    // hub elbow), which reads as a confusing double arrow.
    if (peekId) {
      const hub = placed.get(peekId);
      if (hub) {
        const linkedTargets = this.peekRelationshipNeighborIds(peekId);
        for (const sat of satellites) {
          if (linkedTargets.has(sat.id)) continue;
          specs.push({
            id: `hub-${sat.id}`,
            a: hub,
            b: sat,
            variant: 'active',
            center: { x: hub.x, y: hub.y },
            routing: 'elbow-target',
          });
        }

        const linkedPairs = new Set(specs.map((s) => this.linkPairKey(s.a.id, s.b.id)));
        for (const { node: refNode, relationship: rel } of this.doc.labelReferencedNeighbors(peekId)) {
          const refGn = placed.get(refNode.id);
          if (!refGn) continue;
          const key = this.linkPairKey(refNode.id, peekId);
          if (linkedPairs.has(key)) continue;
          linkedPairs.add(key);
          specs.push({
            id: `ref-label-${rel.id}-${refNode.id}`,
            a: refGn,
            b: hub,
            variant: 'faint',
            reference: true,
          });
        }
      }
    }

    const layoutSpecs = peekId
      ? this.applyInspectionLinkRouting(
          this.assignInspectionLinkLanes(this.dedupeLinkSpecs(specs), peekId),
          [...placed.values()],
          peekId
        )
      : this.dedupeLinkSpecs(specs);

    return {
      nodes: [...placed.values()],
      links: this.buildLinks(layoutSpecs, [...placed.values()]),
    };
  }

  // ---- immersed layout ----------------------------------------------------

  private buildImmersed(rect: Rect): GraphModel {
    const focus = this.doc.immersedNode();
    if (!focus) return { nodes: [], links: [] };

    const previewId = this.doc.immersedPreviewNodeId();
    const previewHighlight = previewId
      ? this.relationshipNeighborhood(previewId, focus.id)
      : null;

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
      reference?: boolean;
    }
    const leaves: Leaf[] = [];
    rows.forEach((row, gi) => {
      if (row.kind === 'outbound') {
        leaves.push({
          target: row.target,
          // Reference satellites carry no label — the node itself names them.
          relLabel: row.reference ? undefined : this.doc.resolveReferenceText(row.relationship.label),
          relId: row.reference ? `ref-${row.relationship.id}-${row.target.id}` : row.relationship.id,
          groupIdx: -1,
          incoming: row.incoming,
          reference: row.reference,
        });
      } else {
        row.branches.forEach((b) =>
          leaves.push({
            target: b.target,
            relLabel: this.doc.resolveReferenceText(b.relationship.label),
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
        relLabel: this.doc.resolveReferenceText(c.relationship.label) || 'Creates',
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
        caption: showLinkLabels ? undefined : this.doc.resolveReferenceText(row.entryLabel),
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
      const isPreviewTarget = previewId === leaf.target.id;
      const baseState = leaf.incoming ? 'creator' : 'related';
      const gn: GraphNode = {
        id: leaf.target.id,
        node: leaf.target,
        x: p.x,
        y: p.y,
        size: this.renderSize(
          this.doc.getCategory(leaf.target),
          isPreviewTarget ? relSize * 1.32 : relSize
        ),
        state: isPreviewTarget ? 'peek' : baseState,
        interactive: isPreviewTarget || this.doc.canNavigateTo(leaf.target),
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
      if (!gn || gn.id === focus.id) continue;
      gn.x = body.x ?? gn.x;
      gn.y = body.y ?? gn.y;
      if (gn.caption) gn.captionSide = this.captionSide(center, gn);
    }

    this.applyTemporaryNodePositions(nodes, center);

    if (previewHighlight) {
      for (const gn of nodes) {
        if (previewHighlight.has(gn.id)) continue;
        gn.state = 'dimmed';
        gn.interactive = false;
      }

      const pairs: Array<[string, string]> = [];
      const activeLabels = new Map<string, string>();
      for (const rel of this.doc.currentDocument().relationships) {
        const { sourceId, targetId, label } = rel;
        if (!previewHighlight.has(sourceId) || !previewHighlight.has(targetId)) continue;
        if (
          sourceId === previewId ||
          targetId === previewId ||
          sourceId === focus.id ||
          targetId === focus.id
        ) {
          pairs.push([sourceId, targetId]);
          if (label) activeLabels.set(this.linkPairKey(sourceId, targetId), label);
        }
      }
      const fixedIds = new Set([focus.id]);
      if (previewId) fixedIds.add(previewId);
      this.relaxInspectionLayout(byId, pairs, fixedIds, (aId, bId) =>
        this.minLinkGapForLabel(activeLabels.get(this.linkPairKey(aId, bId)))
      );
      for (const gn of nodes) {
        if (gn.caption) gn.captionSide = this.captionSide(center, gn);
      }
    }

    const linkActive = (aId: string, bId: string): boolean => {
      if (!previewId) return true;
      return aId === previewId || bId === previewId;
    };

    const specs: LinkSpec[] = [];
    rows.forEach((row, gi) => {
      if (row.kind !== 'branch') return;
      const inter = intermediates.get(gi);
      if (!inter) return;
      const active = linkActive(focus.id, inter.id);
      specs.push({
        id: `e-${row.source.id}`,
        a: focusGn,
        b: inter,
        variant: active ? 'active' : 'faint',
        label: active && showLinkLabels ? this.doc.resolveReferenceText(row.entryLabel) : undefined,
        center,
        routing: 'straight',
      });
    });

    leaves.forEach((leaf) => {
      const gn = byId.get(leaf.target.id);
      if (!gn) return;
      const label = showLinkLabels ? leaf.relLabel : undefined;
      const rel = leaf.reference
        ? undefined
        : this.doc.currentDocument().relationships.find((r) => r.id === leaf.relId);
      const hub = leaf.groupIdx >= 0 ? intermediates.get(leaf.groupIdx) ?? focusGn : focusGn;
      const active = !leaf.reference && linkActive(gn.id, hub.id);
      if (leaf.incoming) {
        specs.push({
          id: `c-${leaf.relId}`,
          a: gn,
          b: hub,
          variant: active ? 'active' : 'faint',
          label: active ? label : undefined,
          bidirectional: rel?.bidirectional,
          center,
          routing: 'straight',
          reference: leaf.reference,
        });
      } else {
        specs.push({
          id: `l-${leaf.relId}`,
          a: hub,
          b: gn,
          variant: active ? 'active' : 'faint',
          label: active ? label : undefined,
          bidirectional: rel?.bidirectional,
          center,
          routing: 'straight',
          reference: leaf.reference,
        });
      }
    });

    const layoutSpecs =
      previewId != null
        ? this.applyInspectionLinkRouting(
            this.assignInspectionLinkLanes(this.dedupeLinkSpecs(specs), previewId),
            nodes,
            previewId
          )
        : this.dedupeLinkSpecs(specs);

    return { nodes, links: this.buildLinks(layoutSpecs, nodes) };
  }

  // ---- helpers ------------------------------------------------------------

  // All categories now share the same footprint (rounded squares, plus circular
  // data types), so no per-category size correction is needed.
  private renderSize(_category: string, base: number): number {
    return base;
  }

  /** Node ids connected to `anchorId` plus the anchor itself (for overview peek). */
  private relationshipNeighborhood(anchorId: string, ...alsoHighlight: string[]): Set<string> {
    const ids = new Set<string>([anchorId, ...alsoHighlight]);
    for (const rel of this.doc.currentDocument().relationships) {
      if (rel.sourceId === anchorId) ids.add(rel.targetId);
      if (rel.targetId === anchorId) ids.add(rel.sourceId);
    }
    return ids;
  }

  /**
   * Push linked nodes apart in the inspection phase so arrows are longer and
   * labels can sit midway between endpoints without overlapping node shapes.
   */
  private spreadLinkedNodes(
    nodesById: Map<string, GraphNode>,
    pairs: Array<[string, string]>,
    fixedIds: Set<string>,
    gapForPair: (aId: string, bId: string) => number
  ): void {
    for (const [aId, bId] of pairs) {
      const a = nodesById.get(aId);
      const b = nodesById.get(bId);
      if (!a || !b) continue;

      const minGap = gapForPair(aId, bId);
      const minDist = this.collisionSize(a) / 2 + this.collisionSize(b) / 2 + minGap;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist >= minDist) continue;

      const push = minDist - dist;
      const ux = dx / dist;
      const uy = dy / dist;
      const aFixed = fixedIds.has(aId);
      const bFixed = fixedIds.has(bId);

      if (aFixed && !bFixed) {
        b.x += ux * push;
        b.y += uy * push;
      } else if (!aFixed && bFixed) {
        a.x -= ux * push;
        a.y -= uy * push;
      } else if (!aFixed && !bFixed) {
        a.x -= ux * push * 0.5;
        a.y -= uy * push * 0.5;
        b.x += ux * push * 0.5;
        b.y += uy * push * 0.5;
      }
    }
  }

  private linkPairKey(aId: string, bId: string): string {
    return [aId, bId].sort().join('::');
  }

  /** Minimum edge gap; grows with label length so text clears both endpoints. */
  private minLinkGapForLabel(label?: string): number {
    if (!label) return this.OVERVIEW_MIN_LINK_GAP;
    const estimatedWidth = label.length * 6.8 + 24;
    const arrowClearance = 36;
    const sized = Math.max(this.OVERVIEW_MIN_LINK_GAP, estimatedWidth * 0.78 + 48 + arrowClearance);
    return label.length <= 10 ? Math.max(sized, 84) : sized;
  }

  private peekRelationshipNeighborIds(peekId: string): Set<string> {
    const ids = new Set<string>();
    for (const rel of this.doc.currentDocument().relationships) {
      if (rel.sourceId === peekId && !this.doc.isStructuralRootNode(rel.targetId)) {
        ids.add(rel.targetId);
      }
      if (rel.targetId === peekId && !this.doc.isStructuralRootNode(rel.sourceId)) {
        ids.add(rel.sourceId);
      }
    }
    return ids;
  }

  private peekRelationships(peekId: string, placed: Map<string, GraphNode>): AboardRelationship[] {
    return this.doc.currentDocument().relationships.filter(
      (rel) =>
        (rel.sourceId === peekId || rel.targetId === peekId) &&
        !this.doc.isStructuralRootNode(rel.sourceId) &&
        !this.doc.isStructuralRootNode(rel.targetId) &&
        placed.has(rel.sourceId) &&
        placed.has(rel.targetId)
    );
  }

  private peekRelationshipLabels(peekId: string): Map<string, string> {
    const labels = new Map<string, string>();
    for (const rel of this.doc.currentDocument().relationships) {
      if (rel.sourceId !== peekId && rel.targetId !== peekId) continue;
      if (
        this.doc.isStructuralRootNode(rel.sourceId) ||
        this.doc.isStructuralRootNode(rel.targetId)
      ) {
        continue;
      }
      if (rel.label) labels.set(this.linkPairKey(rel.sourceId, rel.targetId), rel.label);
    }
    return labels;
  }

  /** Keep data-type satellites on lateral slots so vertical app links stay readable. */
  private assignSatelliteAngles(sats: AboardNode[]): number[] {
    const isData = (n: AboardNode) => this.doc.getCategory(n) === 'data-type';
    const aspectCount = sats.filter((n) => !isData(n)).length;
    const dataCount = sats.filter(isData).length;

    // Aspects fan symmetrically across the upper hemisphere centred on
    // straight-up (-90). A fixed slot list bunched many children onto the same
    // few angles; widening the arc with the count keeps every shape distinct.
    const aspectSpan =
      aspectCount <= 1 ? 0 : Math.min((aspectCount - 1) * 46, 200);
    const aspectStart = -90 - aspectSpan / 2;
    const aspectStep = aspectCount > 1 ? aspectSpan / (aspectCount - 1) : 0;

    let aspectIdx = 0;
    let dataIdx = 0;
    return sats.map((node) => {
      if (isData(node)) {
        if (dataCount === 1) return 145;
        const start = 110;
        const step = 140 / Math.max(dataCount - 1, 1);
        return start + step * dataIdx++;
      }
      if (aspectCount === 1) return -90;
      return aspectStart + aspectStep * aspectIdx++;
    });
  }

  /** Angular width (radians) covered by the satellite ring, for radius sizing. */
  private satelliteArcSpanRad(anglesDeg: number[]): number {
    if (anglesDeg.length <= 1) return 2 * Math.PI;
    const min = Math.min(...anglesDeg);
    const max = Math.max(...anglesDeg);
    return ((max - min) * Math.PI) / 180;
  }

  /** Spread linked pairs, resolve node collisions, then re-open link gaps. */
  private relaxInspectionLayout(
    nodesById: Map<string, GraphNode>,
    pairs: Array<[string, string]>,
    fixedIds: Set<string>,
    gapForPair: (aId: string, bId: string) => number
  ): void {
    for (let pass = 0; pass < this.OVERVIEW_SPREAD_PASSES; pass++) {
      this.spreadLinkedNodes(nodesById, pairs, fixedIds, gapForPair);
    }
    for (let pass = 0; pass < 12; pass++) {
      if (!this.resolveInspectionCollisions(nodesById, fixedIds)) break;
    }
    for (let pass = 0; pass < 3; pass++) {
      this.spreadLinkedNodes(nodesById, pairs, fixedIds, gapForPair);
    }
  }

  /** Push movable nodes apart so shapes never overlap during inspection. */
  private resolveInspectionCollisions(
    nodesById: Map<string, GraphNode>,
    fixedIds: Set<string>
  ): boolean {
    const nodes = [...nodesById.values()];
    let moved = false;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const minDist =
          this.collisionSize(a) / 2 + this.collisionSize(b) / 2 + this.INSPECTION_NODE_MIN_GAP;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist >= minDist) continue;

        const push = minDist - dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const aMove = !fixedIds.has(a.id);
        const bMove = !fixedIds.has(b.id);
        if (!aMove && !bMove) continue;

        moved = true;
        if (aMove && !bMove) {
          a.x -= ux * push;
          a.y -= uy * push;
        } else if (!aMove && bMove) {
          b.x += ux * push;
          b.y += uy * push;
        } else {
          a.x -= ux * push * 0.5;
          a.y -= uy * push * 0.5;
          b.x += ux * push * 0.5;
          b.y += uy * push * 0.5;
        }
      }
    }

    return moved;
  }

  /** Bow labeled outbound links from the inspected hub so captions do not stack. */
  private assignInspectionLinkLanes(specs: LinkSpec[], hubId: string): LinkSpec[] {
    const sortByAngle = (left: LinkSpec, right: LinkSpec) => {
      const leftAngle = Math.atan2(left.b.y - left.a.y, left.b.x - left.a.x);
      const rightAngle = Math.atan2(right.b.y - right.a.y, right.b.x - right.a.x);
      return leftAngle - rightAngle;
    };
    const activeLabeled = (s: LinkSpec) =>
      s.variant === 'active' && !!s.label && !s.bidirectional;

    // Only assign lanes to genuinely parallel links that share the SAME pair of
    // endpoints (e.g. two relationships between the hub and one node). Distinct
    // sources/targets stay straight unless routing later finds them crowded.
    const next = applyLinkLaneOffsets(
      specs,
      (s) => activeLabeled(s) && (s.a.id === hubId || s.b.id === hubId),
      (s) => this.linkPairKey(s.a.id, s.b.id),
      this.INSPECTION_LINK_LANE,
      { sort: sortByAngle }
    );
    return next;
  }

  /**
   * Bow active inspection links around nodes that sit on the straight chord so
   * arrows arc through open space (e.g. Client → Session Server over AWS S3).
   */
  private applyInspectionLinkRouting(
    specs: LinkSpec[],
    nodes: GraphNode[],
    hubId?: string
  ): LinkSpec[] {
    const crowded = this.detectCrowdedHubLinks(specs, hubId);
    // Only treat prominent shapes as obstacles; faint background grid nodes
    // shouldn't force an otherwise-clean arrow to bow.
    const obstacles = nodes.filter((n) => n.state !== 'dimmed');

    return specs.map((spec) => {
      if (spec.variant !== 'active' || spec.bidirectional) return spec;
      if (spec.routing && spec.routing !== 'straight') return spec;

      const laneOffset = spec.curveOffset;
      const isInbound = !!hubId && spec.b.id === hubId && spec.a.id !== hubId;
      const isOutbound = !!hubId && spec.a.id === hubId && spec.b.id !== hubId;
      let offset = 0;

      if (laneOffset !== undefined && Math.abs(laneOffset) >= 0.5) {
        // Genuine parallel links between the same two nodes: keep a readable bow.
        offset = Math.sign(laneOffset) * Math.max(Math.abs(laneOffset), INSPECTION_LANE_MIN_BOW);
      } else if (isInbound && crowded.has(spec.id)) {
        // Crowded inbound: bow to the OUTSIDE of the approach angle so same-side
        // sources fan apart instead of overlapping / crossing.
        const fan = this.inboundFanOffset(spec.a, spec.b);
        offset = (fan >= 0 ? 1 : -1) * Math.max(Math.abs(fan), INSPECTION_LANE_MIN_BOW);
      } else if (isOutbound && crowded.has(spec.id)) {
        offset = this.outboundFanOffset(spec.a, spec.b);
      } else {
        // Not crowded → keep it straight unless a prominent node blocks the chord.
        offset = this.curveOffsetAroundNodes(spec.a, spec.b, obstacles);
      }

      if (Math.abs(offset) < 0.5) return spec;
      return { ...spec, curveOffset: offset };
    });
  }

  /**
   * Flag hub links whose straight angle sits close to a sibling hub link, so
   * only those need a curve to avoid overlapping lines/labels. Well-separated
   * links (e.g. up / left / down) stay straight.
   */
  private detectCrowdedHubLinks(specs: LinkSpec[], hubId?: string): Set<string> {
    const crowded = new Set<string>();
    if (!hubId) return crowded;

    const hubLinks = specs.filter(
      (s) =>
        s.variant === 'active' &&
        !s.bidirectional &&
        (!s.routing || s.routing === 'straight') &&
        s.a.id !== s.b.id &&
        (s.a.id === hubId || s.b.id === hubId)
    );

    const angleOf = (s: LinkSpec): number => {
      const hub = s.a.id === hubId ? s.a : s.b;
      const other = s.a.id === hubId ? s.b : s.a;
      return (Math.atan2(other.y - hub.y, other.x - hub.x) * 180) / Math.PI;
    };

    for (let i = 0; i < hubLinks.length; i++) {
      for (let j = i + 1; j < hubLinks.length; j++) {
        let diff = Math.abs(angleOf(hubLinks[i]) - angleOf(hubLinks[j]));
        if (diff > 180) diff = 360 - diff;
        if (diff < this.INSPECTION_CROWD_ANGLE_DEG) {
          crowded.add(hubLinks[i].id);
          crowded.add(hubLinks[j].id);
        }
      }
    }
    return crowded;
  }

  /** Bow inbound links on the outside of their approach angle to the inspected hub. */
  private inboundFanOffset(source: GraphNode, hub: GraphNode): number {
    const angle = (Math.atan2(source.y - hub.y, source.x - hub.x) * 180) / Math.PI;
    if (angle >= 40 && angle < 120) return 62;
    if (angle >= -120 && angle < -40) return -62;
    if (angle >= -40 && angle < 40) return 48;
    return -48;
  }

  private outboundFanOffset(hub: GraphNode, target: GraphNode): number {
    const angle = (Math.atan2(target.y - hub.y, target.x - hub.x) * 180) / Math.PI;
    if (angle >= 40 && angle < 140) return 58;
    if (angle >= -140 && angle < -40) return -58;
    return 44;
  }

  /** Signed lateral bow (px) so the chord clears every node it would pass through. */
  private curveOffsetAroundNodes(a: GraphNode, b: GraphNode, nodes: GraphNode[]): number {
    const from: Pt = { x: a.x, y: a.y };
    const to: Pt = { x: b.x, y: b.y };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len < 48) return 0;

    const nx = -dy / len;
    const ny = dx / len;
    const endpointIds = new Set([a.id, b.id]);
    let posBow = 0;
    let negBow = 0;

    for (const obs of nodes) {
      if (endpointIds.has(obs.id)) continue;

      const clearance = this.collisionSize(obs) / 2 + this.INSPECTION_OBSTACLE_CLEARANCE;
      const t = clamp(((obs.x - from.x) * dx + (obs.y - from.y) * dy) / (len * len), 0, 1);
      const projX = from.x + t * dx;
      const projY = from.y + t * dy;
      const dist = Math.hypot(obs.x - projX, obs.y - projY);
      if (dist >= clearance) continue;

      const side = (obs.x - projX) * nx + (obs.y - projY) * ny;
      const sign = side >= 0 ? 1 : -1;
      const needed = sign * (clearance - dist + 36);
      if (sign > 0) posBow = Math.max(posBow, needed);
      else negBow = Math.min(negBow, needed);
    }

    let offset = 0;
    if (posBow > 0 && negBow < 0) {
      offset = posBow >= Math.abs(negBow) ? posBow : negBow;
    } else if (posBow > 0) {
      offset = posBow;
    } else if (negBow < 0) {
      offset = negBow;
    }

    if (offset === 0) return 0;

    const scale = clamp(len / 260, 1, 2);
    return clamp(offset * scale, -140, 140);
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
  private dedupeLinkSpecs(specs: LinkSpec[]): LinkSpec[] {
    const byPair = new Map<string, LinkSpec[]>();
    for (const spec of specs) {
      const key = this.linkPairKey(spec.a.id, spec.b.id);
      const group = byPair.get(key);
      if (group) group.push(spec);
      else byPair.set(key, [spec]);
    }

    const result: LinkSpec[] = [];
    for (const group of byPair.values()) {
      if (group.length === 1) {
        result.push(group[0]);
        continue;
      }

      const directions = new Set(group.map((spec) => `${spec.a.id}->${spec.b.id}`));

      // Opposite-direction pair → one two-way arrow instead of two bowed lanes.
      if (directions.size === 2) {
        result.push(this.mergeBidirectionalSpecs(group));
        continue;
      }

      // True parallel same-direction duplicates — keep the best labeled spec.
      if (directions.size === 1) {
        const best = group.find((spec) => spec.label) ?? group[0];
        result.push(best);
        continue;
      }

      result.push(...group);
    }
    return result;
  }

  private mergeBidirectionalSpecs(group: LinkSpec[]): LinkSpec {
    const ids = [group[0].a.id, group[0].b.id].sort();
    const canonAId = ids[0];
    const canonBId = ids[1];
    const nodeA = group[0].a.id === canonAId ? group[0].a : group[0].b;
    const nodeB = group[0].a.id === canonBId ? group[0].a : group[0].b;
    const forward = group.find((s) => s.a.id === canonAId && s.b.id === canonBId);
    const reverse = group.find((s) => s.a.id === canonBId && s.b.id === canonAId);
    const flagged = group.find((s) => s.bidirectional);
    const active = group.some((s) => s.variant === 'active');

    return {
      id: `bidir-${canonAId}-${canonBId}`,
      a: nodeA,
      b: nodeB,
      variant: active ? 'active' : 'faint',
      label: forward?.label ?? reverse?.label ?? flagged?.label,
      reverseLabel:
        forward && reverse && forward.label !== reverse.label ? reverse.label : undefined,
      bidirectional: true,
      routing: forward?.routing ?? reverse?.routing ?? flagged?.routing,
      center: forward?.center ?? reverse?.center ?? flagged?.center,
    };
  }

  private buildLinks(specs: LinkSpec[], labelAvoidNodes: GraphNode[] = []): GraphLink[] {
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
        // Resolve `{id}` mentions in any label here so both canvas and immersed
        // links share one resolution point.
        const specLabel = this.doc.resolveReferenceText(spec.label);
        const specReverseLabel = spec.reverseLabel
          ? this.doc.resolveReferenceText(spec.reverseLabel)
          : undefined;
        if (spec.bidirectional) {
          result.push(
            this.makeLink(spec.id, spec.a, spec.b, spec.variant, specLabel, {
              center: spec.center,
              routing: spec.routing,
              bidirectional: true,
              reverseLabel: specReverseLabel,
              labelAvoid: labelAvoidNodes,
              reference: spec.reference,
            })
          );
          return;
        }

        let offset = spec.curveOffset ?? 0;
        if (Math.abs(offset) < 0.5 && n > 1) {
          // Lane in a canonical (id-sorted) frame so reciprocal edges bow to
          // opposite physical sides regardless of their arrow direction.
          const canonicalFirst = [spec.a.id, spec.b.id].sort()[0];
          const sign = spec.a.id === canonicalFirst ? 1 : -1;
          offset = (i - (n - 1) / 2) * lane * sign;
        }
        result.push(this.makeLink(spec.id, spec.a, spec.b, spec.variant, specLabel, {
          center: spec.center,
          routing: spec.routing,
          curveOffset: offset,
          labelAlongOffset: spec.labelAlongOffset,
          labelAvoid: labelAvoidNodes,
          reference: spec.reference,
        }));
      });
    }
    return result;
  }

  /** Gap from node center to link endpoint along the direction toward `target`. */
  private linkEndpointGap(gn: GraphNode, target: Pt, pad: number): number {
    const dx = target.x - gn.x;
    const dy = target.y - gn.y;
    const len = Math.hypot(dx, dy) || 1;
    const shape = resolveNodeStyle(gn.node, this.doc.schema()).shape;
    return shapeBoundaryDistance(shape, dx / len, dy / len, gn.size) + pad;
  }

  private makeLink(
    id: string,
    a: GraphNode,
    b: GraphNode,
    variant: 'faint' | 'active',
    label?: string,
    options?: {
      center?: Pt;
      routing?: LinkRouting;
      curveOffset?: number;
      labelAlongOffset?: number;
      labelAvoid?: GraphNode[];
      bidirectional?: boolean;
      reverseLabel?: string;
      reference?: boolean;
    }
  ): GraphLink {
    const from = { x: a.x, y: a.y };
    const to = { x: b.x, y: b.y };

    if (options?.bidirectional) {
      const arrowPad =
        variant === 'active' && (a.state === 'peek' || b.state === 'peek') ? 24 : variant === 'active' ? 14 : 4;
      const startGap = this.linkEndpointGap(a, to, arrowPad);
      const endGap = this.linkEndpointGap(b, from, arrowPad);
      const routed = routedStraightPath(from, to, startGap, endGap);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -dy / len;
      const ny = dx / len;
      const shaft = Math.max(0, len - startGap - endGap);
      const forwardAlong = startGap + shaft * 0.38;
      const reverseAlong = startGap + shaft * 0.62;
      const forwardBase = { x: from.x + ux * forwardAlong, y: from.y + uy * forwardAlong };
      const reverseBase = { x: from.x + ux * reverseAlong, y: from.y + uy * reverseAlong };
      const labelLift = 16;

      const labelPoint = label
        ? this.positionLinkLabel(from, to, forwardBase.x, forwardBase.y, label, {
            startGap,
            endGap,
            avoid: options.labelAvoid,
            endpointIds: [a.id, b.id],
          })
        : forwardBase;

      const reverseLabel = options.reverseLabel;
      const reversePoint = reverseLabel
        ? this.positionLinkLabel(from, to, reverseBase.x, reverseBase.y, reverseLabel, {
            startGap,
            endGap,
            avoid: options.labelAvoid,
            endpointIds: [a.id, b.id],
          })
        : undefined;

      if (reversePoint && labelPoint) {
        reversePoint.x -= nx * labelLift;
        reversePoint.y -= ny * labelLift;
        labelPoint.x += nx * labelLift;
        labelPoint.y += ny * labelLift;
      }

      return {
        id,
        path: routed.d,
        variant,
        label: variant === 'active' ? label : undefined,
        labelX: labelPoint.x,
        labelY: labelPoint.y,
        reverseLabel: variant === 'active' ? reverseLabel : undefined,
        reverseLabelX: reversePoint?.x,
        reverseLabelY: reversePoint?.y,
        markerStart: variant === 'active',
        markerEnd: variant === 'active' || !!options?.reference,
        reference: options?.reference,
      };
    }

    const startPad =
      variant === 'active' && (a.state === 'peek' || b.state === 'peek') ? 10 : 4;
    const endPad =
      variant === 'active' && (a.state === 'peek' || b.state === 'peek')
        ? 24
        : variant === 'active'
          ? 11
          : 4;
    const routing = options?.routing ?? 'straight';
    const curveOffset = options?.curveOffset ?? 0;

    let routed;
    if (Math.abs(curveOffset) > 0.5) {
      const startGap = this.linkEndpointGap(a, to, startPad);
      const endGap = this.linkEndpointGap(b, from, endPad);
      routed = routedCurvedPath(from, to, startGap, endGap, curveOffset);
    } else if (routing === 'straight' || !options?.center) {
      const startGap = this.linkEndpointGap(a, to, startPad);
      const endGap = this.linkEndpointGap(b, from, endPad);
      routed = routedStraightPath(from, to, startGap, endGap);
    } else if (routing === 'channel') {
      const fromAng = angleDeg(options.center, from);
      const toAng = angleDeg(options.center, to);
      const fromR = radius(options.center, from);
      const toR = radius(options.center, to);
      const channelR = fromR + (toR - fromR) * 0.46;
      const bend1 = polar(options.center, channelR, fromAng);
      const bend2 = polar(options.center, channelR, toAng);
      const startGap = this.linkEndpointGap(a, bend1, startPad);
      const endGap = this.linkEndpointGap(b, bend2, endPad);
      routed = routedChannelPath(from, to, options.center, startGap, endGap);
    } else {
      const bend =
        routing === 'elbow-source'
          ? sourceRadialBend(from, to, options.center)
          : targetRadialBend(from, to, options.center);
      const startGap = this.linkEndpointGap(a, bend, startPad);
      const endGap = this.linkEndpointGap(b, bend, endPad);
      routed = routedElbowPath(from, to, bend, startGap, endGap);
    }

    const startGap = this.linkEndpointGap(a, to, startPad);
    const endGap = this.linkEndpointGap(b, from, endPad);

    // Curved edges already carry their label out to the arc apex; only nudge
    // straight edges whose label would otherwise sit on the stroke.
    let labelPoint =
      Math.abs(curveOffset) > 0.5
        ? { x: routed.labelX, y: routed.labelY }
        : this.positionLinkLabel(from, to, routed.labelX, routed.labelY, label, {
            startGap,
            endGap,
            avoid: options?.labelAvoid,
            endpointIds: [a.id, b.id],
          });

    const labelAlong = options?.labelAlongOffset ?? 0;
    if (label && Math.abs(labelAlong) > 0.5) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      labelPoint = {
        x: labelPoint.x + (dx / len) * labelAlong,
        y: labelPoint.y + (dy / len) * labelAlong,
      };
    }

    return {
      id,
      path: routed.d,
      variant,
      label: variant === 'active' ? label : undefined,
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      markerEnd: variant === 'active' || !!options?.reference,
      reference: options?.reference,
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
    label?: string,
    options?: { startGap: number; endGap: number; avoid?: GraphNode[]; endpointIds?: [string, string] }
  ): Pt {
    if (!label) return { x: labelX, y: labelY };

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -dy / len;
    const ny = dx / len;
    const estimatedLabelWidth = label.length * 6.5;
    const labelRadius = estimatedLabelWidth / 2 + 14;
    const startGap = options?.startGap ?? 0;
    const endGap = options?.endGap ?? 0;
    const shaftLen = Math.max(0, len - startGap - endGap);
    const tailStub = 24;
    const headStub = 32;
    const endpointIds = new Set(options?.endpointIds ?? []);
    const avoid = (options?.avoid ?? []).filter((gn) => !endpointIds.has(gn.id));

    const pointAlongShaft = (t: number): Pt => {
      const along = startGap + tailStub + Math.max(0, shaftLen - tailStub - headStub) * t;
      return { x: from.x + ux * along, y: from.y + uy * along };
    };

    const overlapsNode = (point: Pt): boolean => {
      for (const gn of avoid) {
        const clearance = gn.size / 2 + labelRadius;
        if (Math.hypot(point.x - gn.x, point.y - gn.y) < clearance) return true;
      }
      return false;
    };

    const pickCandidate = (candidates: Pt[]): Pt => {
      for (const candidate of candidates) {
        if (!overlapsNode(candidate)) return candidate;
      }
      const lift = Math.max(36, Math.min(64, estimatedLabelWidth / 3));
      for (const sign of [1, -1]) {
        for (const candidate of candidates) {
          const lifted = {
            x: candidate.x + nx * lift * sign * 0.55,
            y: candidate.y + ny * lift * sign * 0.55,
          };
          if (!overlapsNode(lifted)) return lifted;
        }
      }
      return candidates[0] ?? { x: labelX, y: labelY };
    };

    if (shaftLen >= estimatedLabelWidth + tailStub + headStub) {
      return pickCandidate([
        pointAlongShaft(0.5),
        pointAlongShaft(0.38),
        pointAlongShaft(0.62),
        pointAlongShaft(0.28),
        pointAlongShaft(0.72),
      ]);
    }

    // Short links need their text off the stroke, otherwise the caption covers
    // both the arrow shaft and the relationship direction.
    const lift = Math.max(34, Math.min(58, estimatedLabelWidth / 4));
    return pickCandidate([
      { x: labelX + nx * lift * 0.45, y: labelY + ny * lift * 0.45 },
      { x: labelX - nx * lift * 0.45, y: labelY - ny * lift * 0.45 },
      { x: labelX, y: labelY - lift },
    ]);
  }

}
