import { Injectable, computed, signal } from '@angular/core';
import {
  AboardDocument,
  AboardNode,
  AboardRelationship,
  ABOARD_DOCUMENT_VERSION,
} from '../models/aboard.models';
import { normalizeDocumentTags } from '../utils/tag.util';
import { SAMPLE_DOCUMENT } from '../data/sample-document';
import { getNodeCategory, isDetailSatelliteCategory, isNavigableCategory } from '../utils/category.util';
import { extractReferenceIds, resolveReferencesToText } from '../utils/item-reference.util';
import { isCreationRelationship } from '../utils/relationship.util';
import { computeMapViewLinks, documentUsesRootFlags, MapViewLink } from '../utils/map-view.util';

/**
 * View modes (user-facing names in parentheses):
 * - `canvas` — Map View at root; Inspection View when a node is peeked
 * - `immersed` — Focused View (detail panel + full relationship graph)
 */
export type ViewMode = 'canvas' | 'immersed';

interface NavLocation {
  focusPath: string[];
  viewMode: ViewMode;
  /**
   * The breadcrumb journey the user actually followed (node ids, excluding
   * root). Unlike focusPath, this is not the strict parent hierarchy: lateral
   * hops through relationships (e.g. app -> data type -> server) append here so
   * the trail reflects how the user got to the current node.
   */
  trail: string[];
}

export interface ImmersedOutboundRow {
  kind: 'outbound';
  relationship: AboardRelationship;
  target: AboardNode;
  incoming?: boolean;
  /** True when this row is derived from a `{id}` mention in a relationship label. */
  reference?: boolean;
}

export interface ImmersedBranchRow {
  kind: 'branch';
  source: AboardNode;
  entryLabel?: string;
  branches: { relationship: AboardRelationship; target: AboardNode; incoming?: boolean }[];
}

export type ImmersedRow = ImmersedOutboundRow | ImmersedBranchRow;

export interface ImmersedCreator {
  source: AboardNode;
  relationship: AboardRelationship;
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly document = signal<AboardDocument>(structuredClone(SAMPLE_DOCUMENT));
  private readonly focusPath = signal<string[]>([]);
  private readonly navTrail = signal<string[]>([]);
  private readonly peekNodeId = signal<string | null>(null);
  /** Inspection highlight within Focused View before navigating to a related item. */
  private readonly immersedPreviewId = signal<string | null>(null);
  private readonly viewMode = signal<ViewMode>('canvas');

  readonly currentDocument = this.document.asReadonly();
  readonly schema = computed(() => this.document().schema ?? null);
  readonly focusPathIds = this.focusPath.asReadonly();
  readonly navTrailIds = this.navTrail.asReadonly();
  readonly peekId = this.peekNodeId.asReadonly();
  readonly immersedPreviewNodeId = this.immersedPreviewId.asReadonly();
  readonly mode = this.viewMode.asReadonly();

  private history: NavLocation[] = [{ focusPath: [], viewMode: 'canvas', trail: [] }];
  private readonly historyIndex = signal(0);
  readonly canGoBack = computed(() => this.historyIndex() > 0);
  readonly canGoForward = computed(() => this.historyIndex() < this.history.length - 1);

  readonly focusedNode = computed(() => {
    const path = this.focusPath();
    const doc = this.document();
    if (path.length === 0) {
      return this.findNode(doc.rootId);
    }
    return this.findNode(path[path.length - 1]);
  });

  readonly immersedNodeId = computed(() => {
    if (this.viewMode() !== 'immersed') return null;
    const path = this.focusPath();
    return path.length > 0 ? path[path.length - 1] : null;
  });

  readonly visibleNodes = computed(() => this.canvasNodes());

  readonly atMapRoot = computed(() => this.focusPath().length === 0);

  readonly usesRootItems = computed(() => documentUsesRootFlags(this.document().nodes));

  /**
   * Map View nodes: at the board landing, items flagged `isRoot`; otherwise
   * non-data-type children of the focused container (legacy behavior when no
   * root flags exist).
   */
  readonly canvasNodes = computed(() => {
    const doc = this.document();
    const focused = this.focusedNode();
    if (!focused) return [];

    if (this.atMapRoot() && this.usesRootItems()) {
      return doc.nodes.filter((n) => n.isRoot === true && n.id !== doc.rootId);
    }

    return this.getChildren(focused.id).filter(
      (n) => !isDetailSatelliteCategory(getNodeCategory(n))
    );
  });

  /** Faint Map View links between root-level items (direct or via shared neighbor). */
  readonly mapViewLinks = computed((): MapViewLink[] => {
    if (!this.atMapRoot() || !this.usesRootItems() || this.viewMode() !== 'canvas') {
      return [];
    }
    return computeMapViewLinks(this.canvasNodes(), this.document().relationships);
  });

  readonly peekSatellites = computed(() => {
    const peekId = this.peekNodeId();
    if (!peekId || this.viewMode() !== 'canvas') return [];
    const seen = new Set<string>();
    const satellites: AboardNode[] = [];
    for (const child of this.getChildren(peekId)) {
      seen.add(child.id);
      satellites.push(child);
    }
    // Inspection View: surface related data types even when not hierarchical children.
    for (const rel of this.document().relationships) {
      const otherId = rel.sourceId === peekId ? rel.targetId : rel.targetId === peekId ? rel.sourceId : null;
      if (!otherId || seen.has(otherId)) continue;
      const node = this.findNode(otherId);
      if (node && getNodeCategory(node) === 'data-type') {
        seen.add(otherId);
        satellites.push(node);
      }
    }
    return satellites;
  });

  readonly breadcrumbTrail = computed(() => {
    const doc = this.document();
    const crumbs: AboardNode[] = [];
    const root = this.findNode(doc.rootId);
    if (root) crumbs.push(root);
    for (const id of this.navTrail()) {
      const node = this.findNode(id);
      if (node) crumbs.push(node);
    }
    return crumbs;
  });

  readonly peekNode = computed(() => {
    const id = this.peekNodeId();
    return id ? this.findNode(id) : null;
  });

  /**
   * Explicit parent → child hierarchy from the root down to the node currently
   * in view (immersed node, else peeked node, else the focused container).
   * Powers the toolbar breadcrumbs so the level you're at is always visible.
   */
  readonly hierarchyCrumbs = computed((): AboardNode[] => {
    const current =
      this.immersedNode() ?? this.peekNode() ?? this.focusedNode() ?? null;
    if (!current) return [];
    const chain: AboardNode[] = [];
    let node: AboardNode | undefined = current;
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      chain.unshift(node);
      if (!node.parentId || this.isStructuralRootNode(node.parentId)) break;
      node = this.findNode(node.parentId);
    }
    return chain;
  });

  readonly canvasRelationships = computed(() => {
    const visibleIds = new Set(this.canvasNodes().map((n) => n.id));
    return this.document().relationships.filter(
      (r) => visibleIds.has(r.sourceId) && visibleIds.has(r.targetId)
    );
  });

  /** True when Map View uses computed faint links instead of all canvas relationships. */
  readonly usesMapViewLinkRules = computed(
    () => this.atMapRoot() && this.usesRootItems() && !this.peekNodeId()
  );

  readonly peekRelationships = computed(() => {
    const id = this.peekNodeId();
    if (!id) return [];
    return this.getRelationshipsFor(id);
  });

  readonly immersedPreviewNode = computed(() => {
    const id = this.immersedPreviewId();
    return id ? this.findNode(id) : null;
  });

  /** Center of the immersed graph: preview target when set, else the current page. */
  readonly immersedViewNode = computed(() => {
    return this.immersedPreviewNode() ?? this.immersedNode() ?? null;
  });

  readonly immersedRows = computed((): ImmersedRow[] => {
    if (this.viewMode() !== 'immersed') return [];
    const focused = this.immersedNode();
    if (!focused) return [];

    const rows: ImmersedRow[] = [];
    const rels = this.document().relationships;
    const childIds = new Set(this.getChildren(focused.id).map((c) => c.id));

    for (const rel of rels) {
      if (rel.sourceId !== focused.id) continue;
      const target = this.findNode(rel.targetId);
      if (!target || childIds.has(target.id) || this.isStructuralRootNode(target.id)) continue;
      rows.push({ kind: 'outbound', relationship: rel, target });
    }

    for (const rel of rels) {
      if (rel.targetId !== focused.id) continue;
      if (isCreationRelationship(rel) && getNodeCategory(focused) === 'data-type') continue;
      const source = this.findNode(rel.sourceId);
      if (!source || childIds.has(source.id) || this.isStructuralRootNode(source.id)) continue;
      rows.push({ kind: 'outbound', relationship: rel, target: source, incoming: true });
    }

    for (const child of this.getChildren(focused.id)) {
      const entryRel = rels.find((r) => r.sourceId === focused.id && r.targetId === child.id);
      const branches: { relationship: AboardRelationship; target: AboardNode; incoming?: boolean }[] = [];

      for (const rel of rels) {
        if (rel.sourceId !== child.id) continue;
        const target = this.findNode(rel.targetId);
        if (!target || target.id === focused.id || this.isStructuralRootNode(target.id)) continue;
        branches.push({ relationship: rel, target });
      }

      for (const rel of rels) {
        if (rel.targetId !== child.id) continue;
        const source = this.findNode(rel.sourceId);
        if (!source || source.id === focused.id || this.isStructuralRootNode(source.id)) continue;
        branches.push({ relationship: rel, target: source, incoming: true });
      }

      if (branches.length > 0) {
        rows.push({
          kind: 'branch',
          source: child,
          entryLabel: entryRel?.label,
          branches,
        });
      } else if (entryRel) {
        rows.push({ kind: 'outbound', relationship: entryRel, target: child });
      } else {
        rows.push({
          kind: 'outbound',
          relationship: {
            id: `hierarchy-${focused.id}-${child.id}`,
            sourceId: focused.id,
            targetId: child.id,
            type: 'contains',
            label: 'Contains',
          },
          target: child,
        });
      }
    }

    this.appendReferenceRows(focused, rows, rels);

    return this.appendFocusedContextRows(focused, rows, rels, childIds);
  });

  /**
   * Factories that create the focused data type. Detected from inbound
   * relationships whose wording implies creation (Creates, Generates, ...), so
   * the data type's page can surface every object that builds it.
   */
  readonly immersedCreators = computed((): ImmersedCreator[] => {
    if (this.viewMode() !== 'immersed') return [];
    const focused = this.immersedNode();
    if (!focused || getNodeCategory(focused) !== 'data-type') return [];

    const creators: ImmersedCreator[] = [];
    for (const rel of this.document().relationships) {
      if (rel.targetId !== focused.id) continue;
      if (!isCreationRelationship(rel)) continue;
      const source = this.findNode(rel.sourceId);
      if (source && !this.isStructuralRootNode(source.id)) {
        creators.push({ source, relationship: rel });
      }
    }
    return creators;
  });

  getCategory(node: AboardNode) {
    return getNodeCategory(node);
  }

  canNavigateTo(node: AboardNode): boolean {
    return isNavigableCategory(getNodeCategory(node));
  }

  readonly immersedNode = computed(() => {
    const id = this.immersedNodeId();
    return id ? this.findNode(id) : null;
  });

  findNode(id: string): AboardNode | undefined {
    return this.document().nodes.find((n) => n.id === id);
  }

  /** The board root node is structural — never show it in explorer graphs or sidebars. */
  isStructuralRootNode(id: string): boolean {
    return id === this.document().rootId;
  }

  /** Display label for UI chrome — root uses the board title. */
  nodeLabel(node: AboardNode): string {
    const doc = this.document();
    return node.id === doc.rootId ? doc.title : node.label;
  }

  getChildren(nodeId: string): AboardNode[] {
    return this.document().nodes.filter((n) => n.parentId === nodeId);
  }

  hasChildren(nodeId: string): boolean {
    return this.getChildren(nodeId).length > 0;
  }

  getRelationshipsFor(nodeId: string): AboardRelationship[] {
    return this.document().relationships.filter(
      (r) => r.sourceId === nodeId || r.targetId === nodeId
    );
  }

  peekNodeById(id: string | null): void {
    this.peekNodeId.set(id);
  }

  setImmersedPreview(nodeId: string | null): void {
    if (!nodeId) {
      this.immersedPreviewId.set(null);
      return;
    }
    const node = this.findNode(nodeId);
    if (!node || !this.canNavigateTo(node)) return;
    this.immersedPreviewId.set(nodeId);
  }

  clearImmersedPreview(): void {
    this.immersedPreviewId.set(null);
  }

  immerse(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (!node) return;

    const path = this.buildPathTo(nodeId);
    const trail = this.extendTrail(nodeId);
    this.immersedPreviewId.set(null);
    this.focusPath.set(path);
    this.navTrail.set(trail);
    this.peekNodeId.set(nodeId);
    this.viewMode.set('immersed');
    this.record({ focusPath: path, viewMode: 'immersed', trail });
  }

  exitImmersed(): void {
    const immersedId = this.focusPath()[this.focusPath().length - 1] ?? null;
    let node = immersedId ? this.findNode(immersedId) : undefined;

    // Climb to the nearest ancestor that acts as a canvas container (root or a
    // node with app-level children). Remember the child on that boundary so we
    // can re-peek it on the overview.
    let boundaryChild = node;
    let parent = node?.parentId ? this.findNode(node.parentId) : undefined;
    while (parent && !this.isCanvasContainer(parent)) {
      boundaryChild = parent;
      parent = parent.parentId ? this.findNode(parent.parentId) : undefined;
    }

    const rootId = this.document().rootId;
    const containerPath =
      parent && parent.id !== rootId ? this.buildPathTo(parent.id) : [];

    // Leaving the immersed page lands on its container canvas with the boundary
    // child peeked, so end the trail at that child — keeping the journey that
    // led here rather than collapsing to the hierarchical container path.
    const trail = this.extendTrail(boundaryChild?.id ?? null);
    this.immersedPreviewId.set(null);
    this.focusPath.set(containerPath);
    this.navTrail.set(trail);
    this.viewMode.set('canvas');
    this.peekNodeId.set(boundaryChild?.id ?? null);
    this.record({ focusPath: containerPath, viewMode: 'canvas', trail });
  }

  private isCanvasContainer(node: AboardNode): boolean {
    if (node.id === this.document().rootId) return true;
    // Aspects (process) and data types are detail satellites surfaced inside the
    // immersed page, so a node whose only children are those should open as an
    // immersed page centred on itself — not drill into a near-empty child
    // canvas. Only app-level children (apps, infrastructure, environments,
    // external tools) make a node a true drill-in canvas container.
    return this.getChildren(node.id).some(
      (child) => !isDetailSatelliteCategory(getNodeCategory(child))
    );
  }

  zoomOutLevel(): void {
    const path = [...this.focusPath()];
    if (path.length === 0) {
      this.navTrail.set([]);
      this.peekNodeId.set(null);
      this.viewMode.set('canvas');
      this.record({ focusPath: [], viewMode: 'canvas', trail: [] });
      return;
    }
    path.pop();
    const target = path[path.length - 1] ?? null;
    const trail = this.extendTrail(target);
    this.focusPath.set(path);
    this.navTrail.set(trail);
    this.viewMode.set('canvas');
    this.peekNodeId.set(target);
    this.record({ focusPath: path, viewMode: 'canvas', trail });
  }

  navigateTo(nodeId: string): void {
    const doc = this.document();
    if (nodeId === doc.rootId) {
      this.focusPath.set([]);
      this.navTrail.set([]);
      this.peekNodeId.set(null);
      this.viewMode.set('canvas');
      this.record({ focusPath: [], viewMode: 'canvas', trail: [] });
      return;
    }
    const node = this.findNode(nodeId);
    // Container nodes (root / environments with app children) become the canvas
    // focus; leaf "page" nodes (apps, data types) re-open as immersed pages.
    if (node && !this.isCanvasContainer(node)) {
      this.navigateToImmersed(nodeId);
      return;
    }
    const path = this.buildPathTo(nodeId);
    const trail = this.extendTrail(nodeId);
    this.focusPath.set(path);
    this.navTrail.set(trail);
    this.peekNodeId.set(null);
    this.viewMode.set('canvas');
    this.record({ focusPath: path, viewMode: 'canvas', trail });
  }

  navigateToImmersed(nodeId: string): void {
    const path = this.buildPathTo(nodeId);
    const trail = this.extendTrail(nodeId);
    this.immersedPreviewId.set(null);
    this.focusPath.set(path);
    this.navTrail.set(trail);
    this.peekNodeId.set(nodeId);
    this.viewMode.set('immersed');
    this.record({ focusPath: path, viewMode: 'immersed', trail });
  }

  goBack(): void {
    if (!this.canGoBack()) return;
    this.historyIndex.update((i) => i - 1);
    this.applyLocation(this.history[this.historyIndex()]);
  }

  goForward(): void {
    if (!this.canGoForward()) return;
    this.historyIndex.update((i) => i + 1);
    this.applyLocation(this.history[this.historyIndex()]);
  }

  /**
   * Step back one node along the breadcrumb journey (nav trail), restoring the
   * previous view without climbing the parent hierarchy.
   */
  stepBackInTrail(): boolean {
    const trail = [...this.navTrail()];
    if (trail.length === 0) return false;

    trail.pop();
    const previousId = trail[trail.length - 1] ?? null;
    this.immersedPreviewId.set(null);
    this.navTrail.set(trail);

    if (!previousId) {
      this.focusPath.set([]);
      this.viewMode.set('canvas');
      this.peekNodeId.set(null);
      this.record({ focusPath: [], viewMode: 'canvas', trail: [] });
      return true;
    }

    const previous = this.findNode(previousId);
    if (!previous) return false;

    const path = this.buildPathTo(previousId);
    this.focusPath.set(path);

    if (this.isCanvasContainer(previous)) {
      this.viewMode.set('canvas');
      this.peekNodeId.set(null);
      this.record({ focusPath: path, viewMode: 'canvas', trail });
    } else {
      this.viewMode.set('immersed');
      this.peekNodeId.set(previousId);
      this.record({ focusPath: path, viewMode: 'immersed', trail });
    }
    return true;
  }

  /** After stepping back, highlight the node the user zoomed out of. */
  focusAfterTrailStepBack(exitingNodeId: string): void {
    if (this.viewMode() === 'canvas') {
      this.peekNodeById(exitingNodeId);
      return;
    }
    const pageId = this.immersedNodeId();
    if (pageId && exitingNodeId !== pageId) {
      this.setImmersedPreview(exitingNodeId);
    }
  }

  /**
   * Grow (or rewind) the breadcrumb journey to end at `nodeId`. Revisiting a
   * node already on the trail rewinds to it; a fresh node is appended.
   */
  private extendTrail(nodeId: string | null | undefined): string[] {
    if (!nodeId || nodeId === this.document().rootId) return [];
    const cur = this.navTrail();
    const idx = cur.indexOf(nodeId);
    return idx >= 0 ? cur.slice(0, idx + 1) : [...cur, nodeId];
  }

  private record(loc: NavLocation): void {
    const current = this.history[this.historyIndex()];
    if (
      current &&
      current.viewMode === loc.viewMode &&
      current.focusPath.length === loc.focusPath.length &&
      current.focusPath.every((id, i) => id === loc.focusPath[i]) &&
      current.trail.length === loc.trail.length &&
      current.trail.every((id, i) => id === loc.trail[i])
    ) {
      return;
    }
    this.history = this.history.slice(0, this.historyIndex() + 1);
    this.history.push({
      focusPath: [...loc.focusPath],
      viewMode: loc.viewMode,
      trail: [...loc.trail],
    });
    this.historyIndex.set(this.history.length - 1);
  }

  private applyLocation(loc: NavLocation): void {
    this.immersedPreviewId.set(null);
    this.focusPath.set([...loc.focusPath]);
    this.navTrail.set([...loc.trail]);
    this.viewMode.set(loc.viewMode);
    this.peekNodeId.set(
      loc.viewMode === 'immersed' ? loc.focusPath[loc.focusPath.length - 1] ?? null : null
    );
  }

  /** Apply an in-place mutation to the current document (cloned before write). */
  mutateDocument(mutator: (doc: AboardDocument) => void): void {
    const next = structuredClone(this.document());
    mutator(next);
    this.normalizeDocument(next);
    this.document.set(next);
  }

  /** Keep navigation state in sync after a node id rename during curation. */
  remapNodeIdReferences(oldId: string, newId: string): void {
    const remap = (id: string) => (id === oldId ? newId : id);
    const remapList = (ids: string[]) => ids.map(remap);

    this.focusPath.update((path) => remapList(path));
    this.navTrail.update((trail) => remapList(trail));
    this.peekNodeId.update((id) => (id ? remap(id) : id));
    this.immersedPreviewId.update((id) => (id ? remap(id) : id));

    this.history = this.history.map((loc) => ({
      focusPath: remapList(loc.focusPath),
      viewMode: loc.viewMode,
      trail: remapList(loc.trail),
    }));
  }

  loadDocument(doc: AboardDocument): void {
    const next = structuredClone(doc);
    this.normalizeDocument(next);
    this.document.set(next);
    this.focusPath.set([]);
    this.navTrail.set([]);
    this.peekNodeId.set(null);
    this.immersedPreviewId.set(null);
    this.viewMode.set('canvas');
    this.history = [{ focusPath: [], viewMode: 'canvas', trail: [] }];
    this.historyIndex.set(0);
  }

  exportDocument(): string {
    return JSON.stringify(this.document(), null, 2);
  }

  importFromJson(json: string): void {
    const parsed = JSON.parse(json) as AboardDocument;
    this.loadDocument(parsed);
  }

  private buildPathTo(nodeId: string): string[] {
    const doc = this.document();
    if (nodeId === doc.rootId) return [];

    const path: string[] = [];
    let current = this.findNode(nodeId);
    while (current) {
      path.unshift(current.id);
      if (!current.parentId) break;
      current = this.findNode(current.parentId);
    }
    if (path[0] === doc.rootId) path.shift();
    return path;
  }

  private validateDocument(doc: AboardDocument): void {
    if (!doc.version || !doc.rootId || !Array.isArray(doc.nodes)) {
      throw new Error('Invalid aboard document format');
    }
    const root = doc.nodes.find((n) => n.id === doc.rootId);
    if (!root) {
      throw new Error('Root node not found in document');
    }
    if (!doc.version.startsWith('1.')) {
      throw new Error(`Unsupported document version: ${doc.version}`);
    }
    if (!doc.version) {
      doc.version = ABOARD_DOCUMENT_VERSION;
    }
  }

  private normalizeDocument(doc: AboardDocument): void {
    this.validateDocument(doc);
    if (!doc.relationships) doc.relationships = [];
    normalizeDocumentTags(doc);
  }

  /** Ensure Focused View always surfaces parent context and direct relationships. */
  private appendFocusedContextRows(
    focused: AboardNode,
    rows: ImmersedRow[],
    rels: AboardRelationship[],
    childIds: Set<string>
  ): ImmersedRow[] {
    const seen = this.collectImmersedRowNodeIds(rows);
    const next = [...rows];

    if (focused.parentId && !this.isStructuralRootNode(focused.parentId)) {
      const parent = this.findNode(focused.parentId);
      if (parent && !seen.has(parent.id)) {
        const hierarchyRel = rels.find(
          (r) =>
            (r.sourceId === parent.id && r.targetId === focused.id) ||
            (r.sourceId === focused.id && r.targetId === parent.id)
        );
        const parentBranches: ImmersedBranchRow['branches'] = [];

        for (const rel of rels) {
          if (rel.sourceId === parent.id && rel.targetId !== focused.id && !childIds.has(rel.targetId)) {
            const target = this.findNode(rel.targetId);
            if (target && !seen.has(target.id) && !this.isStructuralRootNode(target.id)) {
              parentBranches.push({ relationship: rel, target });
            }
          }
          if (rel.targetId === parent.id && rel.sourceId !== focused.id && !childIds.has(rel.sourceId)) {
            const source = this.findNode(rel.sourceId);
            if (source && !seen.has(source.id) && !this.isStructuralRootNode(source.id)) {
              parentBranches.push({ relationship: rel, target: source, incoming: true });
            }
          }
        }

        if (parentBranches.length > 0) {
          next.unshift({
            kind: 'branch',
            source: parent,
            entryLabel: hierarchyRel?.label ?? 'Part of',
            branches: parentBranches,
          });
          for (const branch of parentBranches) seen.add(branch.target.id);
        } else {
          next.unshift({
            kind: 'outbound',
            relationship:
              hierarchyRel ?? {
                id: `hierarchy-${focused.id}-${parent.id}`,
                sourceId: focused.id,
                targetId: parent.id,
                type: 'contained-in',
                label: 'Part of',
              },
            target: parent,
            incoming: true,
          });
        }
        seen.add(parent.id);
      }
    }

    return next;
  }

  /**
   * When the focused node is mentioned by `{id}` in a relationship label (but is
   * not that relationship's source or target), surface the relationship source as
   * a faint incoming reference row. Label mentions never spawn extra outbound
   * arrows from the source — the link always connects source to target; references
   * appear only in the resolved arrow label.
   */
  private appendReferenceRows(
    focused: AboardNode,
    rows: ImmersedRow[],
    rels: AboardRelationship[]
  ): void {
    const present = this.collectImmersedRowNodeIds(rows);
    present.add(focused.id);
    const isKnown = (id: string) => !!this.findNode(id);

    for (const rel of rels) {
      if (!rel.label) continue;
      const refIds = extractReferenceIds(rel.label, isKnown);
      if (refIds.length === 0) continue;

      if (refIds.includes(focused.id) && rel.sourceId !== focused.id) {
        if (present.has(rel.sourceId)) continue;
        const source = this.findNode(rel.sourceId);
        if (!source || this.isStructuralRootNode(source.id)) continue;
        rows.push({
          kind: 'outbound',
          relationship: rel,
          target: source,
          incoming: true,
          reference: true,
        });
        present.add(rel.sourceId);
      }
    }

    // Items mentioned in labels on relationships where the focused node is the target.
    for (const { node, relationship } of this.labelReferencedNeighbors(focused.id)) {
      if (present.has(node.id)) continue;
      rows.push({
        kind: 'outbound',
        relationship,
        target: node,
        incoming: true,
        reference: true,
      });
      present.add(node.id);
    }
  }

  /** Resolve `{id}` mentions in a label/string to the referenced item labels. */
  resolveReferenceText(text: string | undefined | null): string {
    return resolveReferencesToText(text, (id) => this.findNode(id)?.label);
  }

  /**
   * Items mentioned via `{id}` in relationship labels where `nodeId` is the
   * relationship target — surfaced as dotted reference links in inspection /
   * focused views (e.g. "Runs in conjunction with {session-server}").
   */
  labelReferencedNeighbors(
    nodeId: string
  ): { node: AboardNode; relationship: AboardRelationship }[] {
    const isKnown = (id: string) => !!this.findNode(id) && !this.isStructuralRootNode(id);
    const results: { node: AboardNode; relationship: AboardRelationship }[] = [];
    const seen = new Set<string>();

    for (const rel of this.document().relationships) {
      if (rel.targetId !== nodeId || !rel.label) continue;
      for (const refId of extractReferenceIds(rel.label, isKnown)) {
        if (refId === nodeId || refId === rel.sourceId || refId === rel.targetId) continue;
        if (seen.has(refId)) continue;
        const node = this.findNode(refId);
        if (!node) continue;
        seen.add(refId);
        results.push({ node, relationship: rel });
      }
    }
    return results;
  }

  private collectImmersedRowNodeIds(rows: ImmersedRow[]): Set<string> {
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.kind === 'outbound') seen.add(row.target.id);
      if (row.kind === 'branch') {
        seen.add(row.source.id);
        for (const branch of row.branches) seen.add(branch.target.id);
      }
    }
    return seen;
  }
}
