import {
  AboardDocument,
  AboardNode,
  AboardSchema,
  NodeShape,
  SchemaType,
} from '../models/aboard.models';
import { getNodeCategory } from './category.util';
import { resolveApplicationFill } from './tag.util';

export interface ResolvedNodeStyle {
  shape: NodeShape;
  /** Inline fill when a custom schema type applies; null = use built-in category CSS. */
  fill: string | null;
  /** Inline text color when the schema provides one; null = inherit default. */
  textColor: string | null;
}

/** Built-in shape mapping used when no schema type matches. */
export function defaultShapeForCategory(category: string): NodeShape {
  return category === 'data-type' ? 'circle' : 'rounded-square';
}

export function findSchemaType(
  node: AboardNode,
  schema: AboardSchema | null | undefined
): SchemaType | null {
  if (!schema?.types?.length) return null;
  return schema.types.find((t) => t.id === node.type) ?? null;
}

/**
 * Resolve how a node should look. A matching schema type wins; otherwise we fall
 * back to the built-in category styling (shape here, fill via CSS classes).
 */
export function resolveNodeStyle(
  node: AboardNode,
  schema: AboardSchema | null | undefined,
  doc?: AboardDocument | null
): ResolvedNodeStyle {
  const def = findSchemaType(node, schema);
  if (def) {
    return { shape: def.shape, fill: def.color, textColor: def.textColor ?? null };
  }

  const category = getNodeCategory(node);
  const tagFill =
    doc && category === 'application' ? resolveApplicationFill(node, doc) : null;

  return {
    shape: defaultShapeForCategory(category),
    fill: tagFill,
    textColor: null,
  };
}
