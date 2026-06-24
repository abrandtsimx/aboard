import { buildSidebarGroups, resolveTypeLabel } from './sidebar-groups.util';
import { AboardDocument } from '../models/aboard.models';

function doc(overrides: Partial<AboardDocument> = {}): AboardDocument {
  return {
    version: '1.0',
    title: 'Test board',
    rootId: 'env-root',
    nodes: [
      { id: 'env-root', label: 'Root', type: 'environment', parentId: null },
      { id: 'app-a', label: 'Alpha', type: 'app', parentId: 'env-root' },
      { id: 'app-b', label: 'Beta', type: 'app', parentId: 'env-root' },
    ],
    relationships: [],
    ...overrides,
  };
}

describe('buildSidebarGroups', () => {
  it('excludes the document root from groups', () => {
    const groups = buildSidebarGroups(doc(), doc().nodes);
    expect(groups.flatMap((g) => g.nodes.map((n) => n.id))).toEqual(['app-a', 'app-b']);
  });

  it('uses schema type labels for group headers', () => {
    const board = doc({
      schema: {
        types: [
          { id: 'app', label: 'Service', shape: 'rounded-square', color: '#00f' },
          { id: 'environment', label: 'Domain', shape: 'rounded-square', color: '#000' },
        ],
      },
    });
    const groups = buildSidebarGroups(board, board.nodes);
    expect(groups).toHaveSize(1);
    expect(groups[0].label).toBe('Service');
  });

  it('orders groups by schema type order', () => {
    const board = doc({
      nodes: [
        { id: 'env-root', label: 'Root', type: 'environment', parentId: null },
        { id: 'n1', label: 'One', type: 'pod-a', parentId: 'env-root' },
        { id: 'n2', label: 'Two', type: 'pod-b', parentId: 'env-root' },
      ],
      schema: {
        types: [
          { id: 'pod-b', label: 'B group', shape: 'circle', color: '#f00' },
          { id: 'pod-a', label: 'A group', shape: 'circle', color: '#0f0' },
        ],
      },
    });
    const groups = buildSidebarGroups(board, board.nodes);
    expect(groups.map((g) => g.typeKey)).toEqual(['pod-b', 'pod-a']);
  });
});

describe('resolveTypeLabel', () => {
  it('falls back to built-in type names', () => {
    expect(resolveTypeLabel(doc(), 'app')).toBe('Application');
  });
});
