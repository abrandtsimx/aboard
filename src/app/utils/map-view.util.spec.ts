import { AboardNode, AboardRelationship } from '../models/aboard.models';
import { computeMapViewLinks } from './map-view.util';

describe('computeMapViewLinks', () => {
  const roots: AboardNode[] = [
    { id: 'app-editor', label: 'Scenario Editor', type: 'app', parentId: 'root', isRoot: true },
    { id: 'app-portal', label: 'Admin Portal', type: 'app', parentId: 'root', isRoot: true },
    { id: 'app-client', label: 'Client', type: 'app', parentId: 'root', isRoot: true },
  ];

  it('links root items with a direct relationship', () => {
    const rels: AboardRelationship[] = [
      {
        id: 'rel-direct',
        sourceId: 'app-editor',
        targetId: 'app-portal',
        type: 'depends-on',
      },
    ];
    const links = computeMapViewLinks(roots, rels);
    expect(links.some((l) => l.sourceId === 'app-editor' && l.targetId === 'app-portal')).toBeTrue();
  });

  it('links root items that share a non-root neighbor', () => {
    const rels: AboardRelationship[] = [
      {
        id: 'rel-editor-mutations',
        sourceId: 'app-editor',
        targetId: 'dtype-mutations',
        type: 'creates',
      },
      {
        id: 'rel-portal-mutations',
        sourceId: 'app-portal',
        targetId: 'dtype-mutations',
        type: 'reads',
      },
    ];
    const links = computeMapViewLinks(roots, rels);
    const indirect = links.find(
      (l) =>
        l.viaNeighborId === 'dtype-mutations' &&
        ((l.sourceId === 'app-editor' && l.targetId === 'app-portal') ||
          (l.sourceId === 'app-portal' && l.targetId === 'app-editor'))
    );
    expect(indirect).toBeDefined();
  });

  it('does not link root items with no path through direct or shared neighbor', () => {
    const rels: AboardRelationship[] = [
      {
        id: 'rel-editor-mutations',
        sourceId: 'app-editor',
        targetId: 'dtype-mutations',
        type: 'creates',
      },
    ];
    const links = computeMapViewLinks(roots, rels);
    expect(
      links.some(
        (l) =>
          (l.sourceId === 'app-client' || l.targetId === 'app-client') &&
          (l.sourceId === 'app-editor' || l.targetId === 'app-editor')
      )
    ).toBeFalse();
  });
});
