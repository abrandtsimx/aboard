import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_BOARD_TAGS,
  getNodeTags,
  normalizeDocumentTags,
  resolveApplicationFill,
} from './tag.util';
import { AboardDocument } from '../models/aboard.models';

describe('tag.util', () => {
  it('seeds default tags for legacy documents', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Legacy',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          visibility: 'both',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
      ],
      relationships: [],
    };

    normalizeDocumentTags(doc);
    expect(doc.tags?.length).toBe(DEFAULT_BOARD_TAGS.length);
    expect(doc.nodes[1].tags).toEqual(['customer-facing']);
  });

  it('resolves application fill from the primary tag', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Tagged',
      rootId: 'root',
      tags: [{ id: 'internal', label: 'Internal', color: '#463858' }],
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App',
          type: 'app',
          category: 'application',
          tags: ['internal'],
          parentId: 'root',
        },
      ],
      relationships: [],
    };

    const node = doc.nodes[1];
    expect(getNodeTags(node, doc)).toHaveSize(1);
    expect(resolveApplicationFill(node, doc)).toBe('#463858');
  });
});
