import { AboardDocument, AboardNode } from '../models/aboard.models';
import { NODE_TYPE_OPTIONS } from '../services/board-curation.service';
import { findSchemaType } from './node-style.util';

export interface SidebarGroup {
  /** Schema / node type key used for grouping. */
  typeKey: string;
  label: string;
  nodes: AboardNode[];
}

/** Display label for a node type — schema definition wins, then built-in names. */
export function resolveTypeLabel(doc: AboardDocument, typeKey: string): string {
  const schemaType = doc.schema?.types?.find((t) => t.id === typeKey);
  if (schemaType?.label) return schemaType.label;
  const builtin = NODE_TYPE_OPTIONS.find((o) => o.value === typeKey);
  if (builtin) return builtin.label;
  return typeKey;
}

function typeOrder(doc: AboardDocument): string[] {
  const schemaOrder = doc.schema?.types?.map((t) => t.id) ?? [];
  if (schemaOrder.length) return schemaOrder;
  return NODE_TYPE_OPTIONS.map((o) => o.value);
}

/**
 * Group sidebar items by board-defined type (schema), excluding the document root.
 */
export function buildSidebarGroups(
  doc: AboardDocument,
  nodes: readonly AboardNode[]
): SidebarGroup[] {
  const items = nodes.filter((n) => n.id !== doc.rootId);
  const byType = new Map<string, AboardNode[]>();

  for (const node of items) {
    const list = byType.get(node.type) ?? [];
    list.push(node);
    byType.set(node.type, list);
  }

  const result: SidebarGroup[] = [];
  const seen = new Set<string>();

  for (const typeKey of typeOrder(doc)) {
    const list = byType.get(typeKey);
    if (!list?.length) continue;
    seen.add(typeKey);
    list.sort((a, b) => a.label.localeCompare(b.label));
    result.push({ typeKey, label: resolveTypeLabel(doc, typeKey), nodes: list });
  }

  const remaining = [...byType.keys()].filter((k) => !seen.has(k));
  remaining.sort((a, b) => resolveTypeLabel(doc, a).localeCompare(resolveTypeLabel(doc, b)));
  for (const typeKey of remaining) {
    const list = byType.get(typeKey)!;
    list.sort((a, b) => a.label.localeCompare(b.label));
    result.push({ typeKey, label: resolveTypeLabel(doc, typeKey), nodes: list });
  }

  return result;
}

/** Marker color for a sidebar row — schema fill when defined. */
export function sidebarMarkerColor(
  node: AboardNode,
  doc: AboardDocument
): string | null {
  return findSchemaType(node, doc.schema)?.color ?? null;
}
