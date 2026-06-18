import { AboardNode, NodeCategory } from '../models/aboard.models';

export function getNodeCategory(node: AboardNode): NodeCategory {
  if (node.category) return node.category;
  switch (node.type) {
    case 'app':
    case 'tool':
      return 'application';
    case 'item-type':
      return 'data-type';
    case 'system':
      return 'infrastructure';
    case 'aspect':
      return 'process';
    case 'environment':
      return 'environment';
    case 'external':
      return 'external-tool';
    default:
      return 'application';
  }
}

export function categoryLabel(category: NodeCategory): string {
  switch (category) {
    case 'data-type':
      return 'Data type';
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
    category === 'process' ||
    category === 'external-tool'
  );
}
