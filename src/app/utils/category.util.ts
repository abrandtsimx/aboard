import { AboardNode, NodeCategory } from '../models/aboard.models';

/** Detail-level types that orbit inside an immersed page, not map drill-down targets. */
const DETAIL_SATELLITE_TYPES = new Set([
  'item-type',
  'data-type',
  'container',
  'aspect',
]);

export function getNodeCategory(node: AboardNode): NodeCategory {
  if (DETAIL_SATELLITE_TYPES.has(node.type)) {
    if (node.type === 'aspect') return 'process';
    if (node.type === 'container') return 'container';
    return 'data-type';
  }

  switch (node.type) {
    case 'app':
    case 'tool':
    case 'application':
      return 'application';
    case 'system':
      return 'infrastructure';
    case 'environment':
      return 'environment';
    case 'external':
    case 'external-tool':
      return 'external-tool';
    default:
      return 'application';
  }
}

export function categoryLabel(category: NodeCategory): string {
  switch (category) {
    case 'data-type':
      return 'Data type';
    case 'container':
      return 'Container';
    case 'infrastructure':
      return 'Infrastructure';
    case 'process':
      return 'Process';
    case 'environment':
      return 'Environment';
    case 'external-tool':
      return 'External tool';
    default:
      return 'Application';
  }
}

export function isNavigableCategory(category: NodeCategory): boolean {
  return (
    category === 'application' ||
    category === 'infrastructure' ||
    category === 'data-type' ||
    category === 'container' ||
    category === 'process' ||
    category === 'external-tool'
  );
}

/** True when children of this category should not promote the parent to a map drill-down canvas. */
export function isDetailSatelliteCategory(category: NodeCategory): boolean {
  return category === 'data-type' || category === 'process' || category === 'container';
}
