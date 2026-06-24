import { AboardNode, AboardRelationship } from '../models/aboard.models';

/** A faint link drawn between two Map View (root-level) items. */
export interface MapViewLink {
  id: string;
  sourceId: string;
  targetId: string;
  /** When set, the pair shares this non-root neighbor (indirect map link). */
  viaNeighborId?: string;
}

export function documentUsesRootFlags(nodes: AboardNode[]): boolean {
  return nodes.some((n) => n.isRoot === true);
}

/**
 * Map View faint links: direct relationships between root items, or pairs that
 * each relate to the same non-root object (e.g. a shared data type).
 */
export function computeMapViewLinks(
  rootNodes: AboardNode[],
  relationships: AboardRelationship[]
): MapViewLink[] {
  const rootIds = new Set(rootNodes.map((n) => n.id));
  if (rootIds.size < 2) return [];

  const pairKey = (a: string, b: string) => [a, b].sort().join('::');
  const links = new Map<string, MapViewLink>();

  const addPair = (a: string, b: string, viaNeighborId?: string) => {
    if (a === b || !rootIds.has(a) || !rootIds.has(b)) return;
    const key = pairKey(a, b);
    if (links.has(key)) return;
    links.set(key, {
      id: viaNeighborId ? `map-via-${viaNeighborId}-${key}` : `map-direct-${key}`,
      sourceId: a,
      targetId: b,
      viaNeighborId,
    });
  };

  for (const rel of relationships) {
    if (rootIds.has(rel.sourceId) && rootIds.has(rel.targetId)) {
      addPair(rel.sourceId, rel.targetId);
    }
  }

  const neighborToRoots = new Map<string, Set<string>>();
  for (const rel of relationships) {
    if (rootIds.has(rel.sourceId) && !rootIds.has(rel.targetId)) {
      const set = neighborToRoots.get(rel.targetId) ?? new Set<string>();
      set.add(rel.sourceId);
      neighborToRoots.set(rel.targetId, set);
    }
    if (rootIds.has(rel.targetId) && !rootIds.has(rel.sourceId)) {
      const set = neighborToRoots.get(rel.sourceId) ?? new Set<string>();
      set.add(rel.targetId);
      neighborToRoots.set(rel.sourceId, set);
    }
  }

  for (const [neighborId, roots] of neighborToRoots) {
    const list = [...roots];
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        addPair(list[i], list[j], neighborId);
      }
    }
  }

  return [...links.values()];
}
