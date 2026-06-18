import { AboardDocument, AboardNode, BoardTag, Visibility } from '../models/aboard.models';

/** Default tag catalog seeded for new boards and legacy migration. */
export const DEFAULT_BOARD_TAGS: BoardTag[] = [
  { id: 'customer-facing', label: 'Customer-facing', color: '#007cc0' },
  { id: 'internal', label: 'Internal', color: '#463858' },
  { id: 'both', label: 'Both', color: '#0f2d5b' },
];

const LEGACY_VISIBILITY_COLORS: Record<Visibility, string> = {
  'customer-facing': '#007cc0',
  internal: '#463858',
  both: '#0f2d5b',
};

export function slugifyTagId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

/** Ensure the board has a tag catalog (defaults for legacy documents). */
export function ensureBoardTags(doc: AboardDocument): void {
  if (!doc.tags?.length) {
    doc.tags = DEFAULT_BOARD_TAGS.map((t) => ({ ...t }));
  }
}

/** Migrate legacy `visibility` onto `tags` when tags are absent. */
export function normalizeNodeTags(node: AboardNode): void {
  if (node.tags?.length) return;
  if (node.visibility) {
    node.tags = [node.visibility];
  }
}

export function normalizeDocumentTags(doc: AboardDocument): void {
  ensureBoardTags(doc);
  for (const node of doc.nodes) {
    normalizeNodeTags(node);
  }
}

export function getBoardTag(doc: AboardDocument, tagId: string): BoardTag | undefined {
  return doc.tags?.find((t) => t.id === tagId);
}

export function getNodeTagIds(node: AboardNode): string[] {
  if (node.tags?.length) return [...node.tags];
  if (node.visibility) return [node.visibility];
  return [];
}

export function getNodeTags(node: AboardNode, doc: AboardDocument): BoardTag[] {
  return getNodeTagIds(node)
    .map((id) => getBoardTag(doc, id))
    .filter((t): t is BoardTag => !!t);
}

/** Primary tag drives application fill and immersed backdrop. */
export function getPrimaryTag(node: AboardNode, doc: AboardDocument): BoardTag | undefined {
  const ids = getNodeTagIds(node);
  if (ids.length === 0) return undefined;
  return getBoardTag(doc, ids[0]) ?? { id: ids[0], label: ids[0] };
}

export function resolveApplicationFill(node: AboardNode, doc: AboardDocument): string | null {
  const tag = getPrimaryTag(node, doc);
  if (tag?.color) return tag.color;
  if (node.visibility) return LEGACY_VISIBILITY_COLORS[node.visibility] ?? null;
  return null;
}

export function resolveImmersedBackdrop(node: AboardNode, doc: AboardDocument): string {
  const accent =
    resolveApplicationFill(node, doc) ??
    LEGACY_VISIBILITY_COLORS[node.visibility ?? 'both'] ??
    '#0f2d5b';
  return `radial-gradient(circle at 50% 42%, ${accent} 0%, var(--color-clinical-indigo) 55%, var(--color-midnight-scrub) 100%)`;
}

export function tagLabel(tag: BoardTag): string {
  return tag.label?.trim() || tag.id;
}
