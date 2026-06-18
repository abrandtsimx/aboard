export type NodeCategory =
  | 'application'
  | 'data-type'
  | 'infrastructure'
  | 'process'
  | 'environment'
  | 'external-tool';

// Built-in type keys are kept for autocomplete, but a board's schema may define
// arbitrary type ids, so any string is allowed.
export type NodeType =
  | 'environment'
  | 'app'
  | 'tool'
  | 'aspect'
  | 'item-type'
  | 'system'
  | 'external'
  | 'custom'
  | (string & {});

/** @deprecated Legacy audience field — prefer board tags on nodes. */
export type Visibility = 'customer-facing' | 'internal' | 'both';

/** Board-defined label used to classify items (e.g. audience, team, lifecycle). */
export interface BoardTag {
  /** Unique slug referenced by `AboardNode.tags`. */
  id: string;
  label: string;
  /** Optional accent color for application nodes and immersed backdrops. */
  color?: string;
}

/** Shapes a node can render as. */
export type NodeShape =
  | 'circle'
  | 'rounded-square'
  | 'square'
  | 'diamond'
  | 'hexagon';

/**
 * A board-defined node type: pairs a `type` key (referenced by `AboardNode.type`)
 * with the shape and colors used to render every node of that type. When a board
 * supplies a schema, these definitions override the built-in category styling.
 */
export interface SchemaType {
  /** Matches `AboardNode.type`. */
  id: string;
  /** Display name shown in the legend (defaults to `id`). */
  label?: string;
  shape: NodeShape;
  /** Fill color — any CSS color string. */
  color: string;
  /** Label/text color (defaults to white). */
  textColor?: string;
}

export interface AboardSchema {
  types: SchemaType[];
}

export interface AboardNode {
  id: string;
  label: string;
  description?: string;
  type: NodeType;
  /** Semantic category for styling and immersed layout (defaults from type if omitted) */
  category?: NodeCategory;
  /** @deprecated Use `tags` — kept for imported legacy boards. */
  visibility?: Visibility;
  /** References `AboardDocument.tags` ids. */
  tags?: string[];
  parentId: string | null;
  /** Canvas position as percentage (0–100) of the viewport */
  position?: { x: number; y: number };
  /** External reference links (Jira project/issue, Confluence space/page) */
  links?: NodeLinks;
  /** Long-form markdown shown on the item's zoomed-in (immersed) page */
  content?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface NodeLinks {
  jira?: string;
  confluence?: string;
}

export interface AboardRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  /** Custom relationship type, e.g. "shared-deployment", "creates" */
  type: string;
  label?: string;
  bidirectional?: boolean;
}

export interface AboardDocument {
  version: string;
  title: string;
  rootId: string;
  /** Optional custom type/shape/color definitions; falls back to built-ins. */
  schema?: AboardSchema;
  /** Board-level tag catalog for classifying items where it makes sense. */
  tags?: BoardTag[];
  nodes: AboardNode[];
  relationships: AboardRelationship[];
}

export const ABOARD_DOCUMENT_VERSION = '1.0';
