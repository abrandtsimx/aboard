import { Injectable, computed, signal } from '@angular/core';
import {
  AboardDocument,
  AboardNode,
  AboardRelationship,
  ABOARD_DOCUMENT_VERSION,
} from '../models/aboard.models';
import { normalizeDocumentTags } from '../utils/tag.util';
import { SAMPLE_DOCUMENT } from '../data/sample-document';
import { getNodeCategory, isNavigableCategory } from '../utils/category.util';
import { isCreationRelationship } from '../utils/relationship.util';

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
  private readonly viewMode = signal<ViewMode>('canvas');

  readonly currentDocument = this.document.asReadonly();
  readonly schema = computed(() => this.document().schema ?? null);
  readonly focusPathIds = this.focusPath.asReadonly();
  readonly peekId = this.peekNodeId.asReadonly();
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

  /** Top-level canvas shows applications only; data types appear as peek satellites */
  readonly canvasNodes = computed(() => {
    const focused = this.focusedNode();
    if (!focused) return [];
    return this.getChildren(focused.id).filter(
      (n) => getNodeCategory(n) !== 'data-type'
    );
  });

  readonly peekSatellites = computed(() => {
    const peekId = this.peekNodeId();
    if (!peekId || this.viewMode() !== 'canvas') return [];
    return this.getChildren(peekId);
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

  readonly canvasRelationships = computed(() => {
    const visibleIds = new Set(this.canvasNodes().map((n) => n.id));
    return this.document().relationships.filter(
      (r) => visibleIds.has(r.sourceId) && visibleIds.has(r.targetId)
    );
  });

  readonly peekRelationships = computed(() => {
    const id = this.peekNodeId();
    if (!id) return [];
    return this.getRelationshipsFor(id);
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
      if (!target || childIds.has(target.id)) continue;
      rows.push({ kind: 'outbound', relationship: rel, target });
    }

    for (const rel of rels) {
      if (rel.targetId !== focused.id) continue;
      if (isCreationRelationship(rel) && getNodeCategory(focused) === 'data-type') continue;
      const source = this.findNode(rel.sourceId);
      if (!source || childIds.has(source.id)) continue;
      rows.push({ kind: 'outbound', relationship: rel, target: source, incoming: true });
    }

    for (const child of this.getChildren(focused.id)) {
      const entryRel = rels.find((r) => r.sourceId === focused.id && r.targetId === child.id);
      const branches: { relationship: AboardRelationship; target: AboardNode; incoming?: boolean }[] = [];

      for (const rel of rels) {
        if (rel.sourceId !== child.id) continue;
        const target = this.findNode(rel.targetId);
        if (!target || target.id === focused.id) continue;
        branches.push({ relationship: rel, target });
      }

      for (const rel of rels) {
        if (rel.targetId !== child.id) continue;
        const source = this.findNode(rel.sourceId);
        if (!source || source.id === focused.id) continue;
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
      }
    }

    return rows;
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
      if (source) creators.push({ source, relationship: rel });
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
    if (this.viewMode() === 'immersed' && id) {
      this.viewMode.set('canvas');
    }
  }

  immerse(nodeId: string): void {
    const node = this.findNode(nodeId);
    if (!node) return;

    const path = this.buildPathTo(nodeId);
    const trail = this.extendTrail(nodeId);
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
    this.focusPath.set(containerPath);
    this.navTrail.set(trail);
    this.viewMode.set('canvas');
    this.peekNodeId.set(boundaryChild?.id ?? null);
    this.record({ focusPath: containerPath, viewMode: 'canvas', trail });
  }

  private isCanvasContainer(node: AboardNode): boolean {
    if (node.id === this.document().rootId) return true;
    return this.getChildren(node.id).some(
      (child) => getNodeCategory(child) !== 'data-type'
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

  loadDocument(doc: AboardDocument): void {
    const next = structuredClone(doc);
    this.normalizeDocument(next);
    this.document.set(next);
    this.focusPath.set([]);
    this.navTrail.set([]);
    this.peekNodeId.set(null);
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
}
