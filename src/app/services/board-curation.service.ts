import { Injectable, inject } from '@angular/core';
import {
  AboardDocument,
  AboardNode,
  AboardRelationship,
  AboardSchema,
  ABOARD_DOCUMENT_VERSION,
  BoardTag,
  NodeShape,
  NodeType,
  SchemaType,
} from '../models/aboard.models';
import { DEFAULT_BOARD_TAGS, getNodeTagIds, slugifyTagId } from '../utils/tag.util';
import { replaceReferenceIdInText } from '../utils/item-reference.util';
import { DocumentService } from './document.service';
import { BoardLibraryService } from './board-library.service';
import { AppModeService } from './app-mode.service';

export interface NodeDraft {
  id: string;
  label: string;
  description: string;
  type: NodeType;
  tags: string[];
  parentId: string | null;
  isRoot: boolean;
  isCollection: boolean;
  content: string;
  jiraLink: string;
  confluenceLink: string;
}

export interface BoardTagDraft {
  id: string;
  label: string;
  color: string;
}

export interface RelationshipDraft {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  label: string;
  bidirectional: boolean;
}

export interface SchemaTypeDraft {
  id: string;
  label: string;
  shape: NodeShape;
  color: string;
  textColor: string;
  allowsCollection: boolean;
}

export interface NodeTypeOption {
  value: NodeType;
  label: string;
}

export const NODE_TYPE_OPTIONS: NodeTypeOption[] = [
  { value: 'environment', label: 'Environment' },
  { value: 'app', label: 'Application' },
  { value: 'tool', label: 'Tool' },
  { value: 'aspect', label: 'Process / aspect' },
  { value: 'item-type', label: 'Data type' },
  { value: 'system', label: 'Infrastructure' },
  { value: 'external', label: 'External tool' },
  { value: 'custom', label: 'Custom' },
];

/** Schema-defined types when present; otherwise built-in defaults. */
export function getNodeTypeOptions(
  doc: AboardDocument,
  currentType?: NodeType
): NodeTypeOption[] {
  const schemaTypes = doc.schema?.types;
  if (schemaTypes?.length) {
    const options = schemaTypes.map((t) => ({
      value: t.id,
      label: t.label ?? t.id,
    }));
    if (currentType && !options.some((o) => o.value === currentType)) {
      options.push({ value: currentType, label: currentType });
    }
    return options;
  }
  return NODE_TYPE_OPTIONS;
}

export function defaultNodeTypeForDocument(doc: AboardDocument): NodeType {
  const options = getNodeTypeOptions(doc);
  for (const preferred of ['app', 'environment', 'item-type']) {
    const match = options.find((o) => o.value === preferred);
    if (match) return match.value;
  }
  return options[0]?.value ?? 'app';
}

export const SHAPE_OPTIONS: { value: NodeShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'rounded-square', label: 'Rounded square' },
  { value: 'square', label: 'Square' },
  { value: 'pill', label: 'Pill' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Octagon' },
  { value: 'diamond', label: 'Diamond' },
];

@Injectable({ providedIn: 'root' })
export class BoardCurationService {
  private readonly doc = inject(DocumentService);
  private readonly library = inject(BoardLibraryService);
  private readonly appMode = inject(AppModeService);

  /** Create a blank board with a single root environment node. */
  createBlankBoard(title = 'Untitled board'): AboardDocument {
    const rootId = 'env-root';
    return {
      version: ABOARD_DOCUMENT_VERSION,
      title,
      rootId,
      tags: DEFAULT_BOARD_TAGS.map((t) => ({ ...t })),
      nodes: [
        {
          id: rootId,
          label: title,
          type: 'environment',
          parentId: null,
        },
      ],
      relationships: [],
    };
  }

  loadBoard(doc: AboardDocument): void {
    this.doc.loadDocument(doc);
    this.persistIfOpen();
  }

  setTitle(title: string): void {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Board title is required');
    this.mutate((d) => {
      d.title = trimmed;
      const root = d.nodes.find((n) => n.id === d.rootId);
      if (root) root.label = trimmed;
    });
  }

  /** Replace the entire schema, or clear it when undefined. */
  setSchema(schema: AboardSchema | undefined): void {
    this.mutate((d) => {
      d.schema = schema ? structuredClone(schema) : undefined;
    });
  }

  upsertSchemaType(type: SchemaType): void {
    this.assertSchemaType(type);
    this.mutate((d) => {
      if (!d.schema) d.schema = { types: [] };
      const idx = d.schema.types.findIndex((t) => t.id === type.id);
      const entry = structuredClone(type);
      if (idx >= 0) d.schema.types[idx] = entry;
      else d.schema.types.push(entry);
    });
  }

  removeSchemaType(typeId: string): void {
    this.mutate((d) => {
      if (!d.schema?.types) return;
      d.schema.types = d.schema.types.filter((t) => t.id !== typeId);
      if (d.schema.types.length === 0) d.schema = undefined;
    });
  }

  upsertBoardTag(tag: BoardTag): void {
    this.assertBoardTag(tag);
    this.mutate((d) => {
      if (!d.tags) d.tags = [];
      const idx = d.tags.findIndex((t) => t.id === tag.id);
      const entry = structuredClone(tag);
      if (idx >= 0) d.tags[idx] = entry;
      else d.tags.push(entry);
    });
  }

  removeBoardTag(tagId: string): void {
    this.mutate((d) => {
      d.tags = (d.tags ?? []).filter((t) => t.id !== tagId);
      for (const node of d.nodes) {
        if (node.tags) node.tags = node.tags.filter((id) => id !== tagId);
      }
    });
  }

  upsertNode(node: AboardNode): void {
    this.assertNode(node, this.doc.currentDocument());
    this.mutate((d) => {
      const idx = d.nodes.findIndex((n) => n.id === node.id);
      const entry = structuredClone(node);
      if (idx >= 0) d.nodes[idx] = entry;
      else d.nodes.push(entry);
    });
  }

  removeNode(nodeId: string): void {
    const doc = this.doc.currentDocument();
    if (nodeId === doc.rootId) {
      throw new Error('Cannot remove the root node');
    }
    this.mutate((d) => {
      const target = d.nodes.find((n) => n.id === nodeId);
      if (!target) throw new Error(`Node not found: ${nodeId}`);

      const newParent = target.parentId;
      for (const child of d.nodes) {
        if (child.parentId === nodeId) child.parentId = newParent;
      }

      d.nodes = d.nodes.filter((n) => n.id !== nodeId);
      d.relationships = d.relationships.filter(
        (r) => r.sourceId !== nodeId && r.targetId !== nodeId
      );
    });
  }

  /** Copy an item's fields with a new id and label; children and links are not copied. */
  duplicateNode(sourceId: string): AboardNode {
    const doc = this.doc.currentDocument();
    if (sourceId === doc.rootId) {
      throw new Error('Cannot duplicate the root node');
    }
    const source = doc.nodes.find((n) => n.id === sourceId);
    if (!source) throw new Error(`Node not found: ${sourceId}`);

    const label = `${source.label} copy`;
    const copy: AboardNode = {
      id: this.generateNodeId(label),
      label,
      type: source.type,
      parentId: source.parentId,
    };
    if (source.description) copy.description = source.description;
    if (source.tags?.length) copy.tags = [...source.tags];
    if (source.isRoot) copy.isRoot = true;
    if (source.isCollection) copy.isCollection = true;
    if (source.content) copy.content = source.content;
    if (source.links) copy.links = structuredClone(source.links);

    this.upsertNode(copy);
    return copy;
  }

  /** Rename a node id and rewrite every reference across the board document. */
  renameNodeId(currentId: string, nextId: string): void {
    const trimmed = nextId.trim();
    if (!trimmed) throw new Error('Node id is required');
    if (/\s/.test(trimmed)) throw new Error('Node id cannot contain spaces');
    if (trimmed === currentId) throw new Error('New id must differ from the current id');
    if (!this.isNodeIdAvailable(trimmed)) {
      throw new Error(`Node id "${trimmed}" is already in use`);
    }

    const doc = this.doc.currentDocument();
    if (!doc.nodes.some((n) => n.id === currentId)) {
      throw new Error(`Node not found: ${currentId}`);
    }

    this.mutate((d) => {
      if (d.rootId === currentId) d.rootId = trimmed;
      for (const node of d.nodes) {
        if (node.id === currentId) node.id = trimmed;
        if (node.parentId === currentId) node.parentId = trimmed;
        if (node.description) {
          node.description = replaceReferenceIdInText(node.description, currentId, trimmed);
        }
        if (node.content) {
          node.content = replaceReferenceIdInText(node.content, currentId, trimmed);
        }
      }
      for (const rel of d.relationships) {
        if (rel.sourceId === currentId) rel.sourceId = trimmed;
        if (rel.targetId === currentId) rel.targetId = trimmed;
        if (rel.label) {
          rel.label = replaceReferenceIdInText(rel.label, currentId, trimmed);
        }
      }
    });
    this.doc.remapNodeIdReferences(currentId, trimmed);
  }

  upsertRelationship(rel: AboardRelationship): void {
    this.assertRelationship(rel, this.doc.currentDocument());
    this.mutate((d) => {
      const idx = d.relationships.findIndex((r) => r.id === rel.id);
      const entry = structuredClone(rel);
      if (idx >= 0) d.relationships[idx] = entry;
      else d.relationships.push(entry);
    });
  }

  removeRelationship(relationshipId: string): void {
    this.mutate((d) => {
      d.relationships = d.relationships.filter((r) => r.id !== relationshipId);
    });
  }

  nodeToDraft(node: AboardNode): NodeDraft {
    const doc = this.doc.currentDocument();
    return {
      id: node.id,
      label: node.label,
      description: node.description ?? '',
      type: node.type,
      tags: getNodeTagIds(node),
      parentId:
        node.id === doc.rootId || node.parentId === doc.rootId ? null : node.parentId,
      isRoot: node.isRoot === true,
      isCollection: node.isCollection === true,
      content: node.content ?? '',
      jiraLink: node.links?.jira ?? '',
      confluenceLink: node.links?.confluence ?? '',
    };
  }

  draftToNode(draft: NodeDraft): AboardNode {
    const doc = this.doc.currentDocument();
    const id = draft.id.trim();
    const node: AboardNode = {
      id,
      label: draft.label.trim(),
      type: draft.type,
      parentId: id === doc.rootId ? null : (draft.parentId ?? doc.rootId),
    };
    if (draft.tags.length > 0) node.tags = [...draft.tags];
    if (draft.isRoot) node.isRoot = true;
    if (draft.isCollection) node.isCollection = true;
    const desc = draft.description.trim();
    if (desc) node.description = desc;
    const content = draft.content.trim();
    if (content) node.content = content;
    const jira = draft.jiraLink.trim();
    const confluence = draft.confluenceLink.trim();
    if (jira || confluence) {
      node.links = {};
      if (jira) node.links.jira = jira;
      if (confluence) node.links.confluence = confluence;
    }
    return node;
  }

  relationshipToDraft(rel: AboardRelationship): RelationshipDraft {
    return {
      id: rel.id,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      type: rel.type,
      label: rel.label ?? '',
      bidirectional: rel.bidirectional ?? false,
    };
  }

  draftToRelationship(draft: RelationshipDraft): AboardRelationship {
    const rel: AboardRelationship = {
      id: draft.id.trim(),
      sourceId: draft.sourceId,
      targetId: draft.targetId,
      type: draft.type.trim(),
    };
    const label = draft.label.trim();
    if (label) rel.label = label;
    if (draft.bidirectional) rel.bidirectional = true;
    return rel;
  }

  schemaTypeToDraft(type: SchemaType): SchemaTypeDraft {
    return {
      id: type.id,
      label: type.label ?? '',
      shape: type.shape,
      color: type.color,
      textColor: type.textColor ?? '#ffffff',
      allowsCollection: type.allowsCollection !== false,
    };
  }

  draftToSchemaType(draft: SchemaTypeDraft): SchemaType {
    const type: SchemaType = {
      id: draft.id.trim(),
      shape: draft.shape,
      color: draft.color.trim(),
    };
    const label = draft.label.trim();
    if (label) type.label = label;
    const textColor = draft.textColor.trim();
    if (textColor && textColor !== '#ffffff') type.textColor = textColor;
    if (!draft.allowsCollection) type.allowsCollection = false;
    return type;
  }

  emptyNodeDraft(parentId: string | null = null): NodeDraft {
    const doc = this.doc.currentDocument();
    const type = defaultNodeTypeForDocument(doc);
    return {
      id: this.generateNodeId('node'),
      label: '',
      description: '',
      type,
      tags: [],
      parentId: parentId === doc.rootId ? null : parentId,
      isRoot: false,
      isCollection: false,
      content: '',
      jiraLink: '',
      confluenceLink: '',
    };
  }

  emptyBoardTagDraft(): BoardTagDraft {
    return { id: '', label: '', color: '#007cc0' };
  }

  boardTagToDraft(tag: BoardTag): BoardTagDraft {
    return {
      id: tag.id,
      label: tag.label,
      color: tag.color ?? '#007cc0',
    };
  }

  draftToBoardTag(draft: BoardTagDraft): BoardTag {
    const tag: BoardTag = {
      id: draft.id.trim(),
      label: draft.label.trim(),
    };
    const color = draft.color.trim();
    if (color) tag.color = color;
    return tag;
  }

  isBoardTagIdAvailable(id: string, excludeId?: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) return false;
    return !(this.doc.currentDocument().tags ?? []).some(
      (t) => t.id === trimmed && t.id !== excludeId
    );
  }

  suggestTagId(label: string): string {
    const base = slugifyTagId(label) || 'tag';
    const existing = new Set((this.doc.currentDocument().tags ?? []).map((t) => t.id));
    let candidate = base;
    let i = 2;
    while (existing.has(candidate)) {
      candidate = `${base}-${i++}`;
    }
    return candidate;
  }

  emptyRelationshipDraft(): RelationshipDraft {
    const nodes = this.doc.currentDocument().nodes;
    const first = nodes[0]?.id ?? '';
    const second = nodes[1]?.id ?? first;
    return {
      id: this.generateRelationshipId(),
      sourceId: first,
      targetId: second,
      type: 'depends-on',
      label: '',
      bidirectional: false,
    };
  }

  emptySchemaTypeDraft(): SchemaTypeDraft {
    return {
      id: '',
      label: '',
      shape: 'rounded-square',
      color: '#091d3c',
      textColor: '#ffffff',
      allowsCollection: true,
    };
  }

  generateNodeId(baseLabel: string): string {
    const slug = baseLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const prefix = slug || 'node';
    const existing = new Set(this.doc.currentDocument().nodes.map((n) => n.id));
    let candidate = prefix;
    let i = 2;
    while (existing.has(candidate)) {
      candidate = `${prefix}-${i++}`;
    }
    return candidate;
  }

  generateRelationshipId(): string {
    const existing = new Set(this.doc.currentDocument().relationships.map((r) => r.id));
    let candidate = `rel-${Date.now().toString(36)}`;
    let i = 2;
    while (existing.has(candidate)) {
      candidate = `rel-${Date.now().toString(36)}-${i++}`;
    }
    return candidate;
  }

  isNodeIdAvailable(id: string, excludeId?: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) return false;
    return !this.doc
      .currentDocument()
      .nodes.some((n) => n.id === trimmed && n.id !== excludeId);
  }

  isRelationshipIdAvailable(id: string, excludeId?: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) return false;
    return !this.doc
      .currentDocument()
      .relationships.some((r) => r.id === trimmed && r.id !== excludeId);
  }

  isSchemaTypeIdAvailable(id: string, excludeId?: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) return false;
    const types = this.doc.currentDocument().schema?.types ?? [];
    return !types.some((t) => t.id === trimmed && t.id !== excludeId);
  }

  private mutate(mutator: (doc: AboardDocument) => void): void {
    if (this.appMode.readOnly()) return;
    this.doc.mutateDocument(mutator);
    this.persistIfOpen();
  }

  private persistIfOpen(): void {
    if (this.library.inExplorer()) {
      this.library.refreshActive(this.doc.currentDocument());
    }
  }

  private assertBoardTag(tag: BoardTag): void {
    if (!tag.id?.trim()) throw new Error('Tag id is required');
    if (!tag.label?.trim()) throw new Error('Tag label is required');
  }

  private assertSchemaType(type: SchemaType): void {
    if (!type.id?.trim()) throw new Error('Schema type id is required');
    if (!type.color?.trim()) throw new Error('Schema type color is required');
    if (!type.shape) throw new Error('Schema type shape is required');
  }

  private assertNode(node: AboardNode, doc: AboardDocument): void {
    if (!node.id?.trim()) throw new Error('Node id is required');
    if (!node.label?.trim()) throw new Error('Node label is required');
    if (node.id === doc.rootId && node.parentId !== null) {
      throw new Error('Root node must have a null parent');
    }
    if (node.parentId && !doc.nodes.some((n) => n.id === node.parentId)) {
      throw new Error(`Parent node not found: ${node.parentId}`);
    }
    if (node.parentId === node.id) throw new Error('A node cannot be its own parent');
  }

  private assertRelationship(rel: AboardRelationship, doc: AboardDocument): void {
    if (!rel.id?.trim()) throw new Error('Relationship id is required');
    if (!rel.type?.trim()) throw new Error('Relationship type is required');
    if (!doc.nodes.some((n) => n.id === rel.sourceId)) {
      throw new Error(`Source node not found: ${rel.sourceId}`);
    }
    if (!doc.nodes.some((n) => n.id === rel.targetId)) {
      throw new Error(`Target node not found: ${rel.targetId}`);
    }
    if (rel.sourceId === rel.targetId) {
      throw new Error('Relationship source and target must differ');
    }
  }
}
