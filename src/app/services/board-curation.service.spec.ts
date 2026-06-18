import { TestBed } from '@angular/core/testing';
import { ABOARD_DOCUMENT_VERSION } from '../models/aboard.models';
import { BoardCurationService, getNodeTypeOptions, NODE_TYPE_OPTIONS } from './board-curation.service';
import { DocumentService } from './document.service';

describe('BoardCurationService', () => {
  let curation: BoardCurationService;
  let doc: DocumentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    curation = TestBed.inject(BoardCurationService);
    doc = TestBed.inject(DocumentService);
    curation.loadBoard(curation.createBlankBoard('Test board'));
  });

  it('creates a blank board with a root node', () => {
    const board = curation.createBlankBoard('My map');
    expect(board.version).toBe(ABOARD_DOCUMENT_VERSION);
    expect(board.rootId).toBe('env-root');
    expect(board.nodes).toHaveSize(1);
    expect(board.relationships).toEqual([]);
  });

  it('adds schema types and nodes', () => {
    curation.upsertSchemaType({
      id: 'system',
      label: 'Infrastructure',
      shape: 'square',
      color: '#1d4e8a',
    });
    curation.upsertNode({
      id: 'app-demo',
      label: 'Demo App',
      type: 'app',
      category: 'application',
      tags: ['customer-facing'],
      parentId: 'env-root',
    });

    const current = doc.currentDocument();
    expect(current.schema?.types).toHaveSize(1);
    expect(current.nodes).toHaveSize(2);
  });

  it('adds and removes relationships', () => {
    curation.upsertNode({
      id: 'app-a',
      label: 'App A',
      type: 'app',
      category: 'application',
      tags: ['internal'],
      parentId: 'env-root',
    });
    curation.upsertRelationship({
      id: 'rel-a-root',
      sourceId: 'app-a',
      targetId: 'env-root',
      type: 'depends-on',
      label: 'Belongs to',
    });

    expect(doc.currentDocument().relationships).toHaveSize(1);
    curation.removeRelationship('rel-a-root');
    expect(doc.currentDocument().relationships).toHaveSize(0);
  });

  it('reparents children when removing a node', () => {
    curation.upsertNode({
      id: 'dom-a',
      label: 'Domain A',
      type: 'environment',
      category: 'environment',
      parentId: 'env-root',
    });
    curation.upsertNode({
      id: 'app-child',
      label: 'Child App',
      type: 'app',
      category: 'application',
      parentId: 'dom-a',
    });

    curation.removeNode('dom-a');
    const child = doc.findNode('app-child');
    expect(child?.parentId).toBe('env-root');
  });

  it('rejects removing the root node', () => {
    expect(() => curation.removeNode('env-root')).toThrowError(/root/i);
  });

  it('uses schema types for the item type dropdown when a schema exists', () => {
    curation.upsertSchemaType({
      id: 'app',
      label: 'Application',
      shape: 'rounded-square',
      color: '#007cc0',
    });
    curation.upsertSchemaType({
      id: 'item-type',
      label: 'Data type',
      shape: 'circle',
      color: '#e31f2f',
    });

    const options = getNodeTypeOptions(doc.currentDocument());
    expect(options.map((o) => o.value)).toEqual(['app', 'item-type']);
    expect(options).not.toEqual(NODE_TYPE_OPTIONS);
  });
});
