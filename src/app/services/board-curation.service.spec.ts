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
      parentId: 'env-root',
    });
    curation.upsertNode({
      id: 'app-child',
      label: 'Child App',
      type: 'app',
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

  it('generates kebab-case node ids from a label', () => {
    expect(curation.generateNodeId('Scenario Editor')).toBe('scenario-editor');
  });

  it('deduplicates generated node ids when the slug already exists', () => {
    curation.upsertNode({
      id: 'scenario-editor',
      label: 'Existing',
      type: 'app',
      parentId: 'env-root',
    });
    expect(curation.generateNodeId('Scenario Editor')).toBe('scenario-editor-2');
  });

  it('does not persist category on saved nodes', () => {
    const node = curation.draftToNode({
      ...curation.emptyNodeDraft(),
      id: 'my-item',
      label: 'My Item',
    });
    expect(node).toEqual(
      jasmine.objectContaining({
        id: 'my-item',
        label: 'My Item',
        type: 'app',
        parentId: 'env-root',
      })
    );
    expect('category' in node).toBeFalse();
  });

  it('treats root-level parent as null in drafts', () => {
    curation.upsertNode({
      id: 'app-demo',
      label: 'Demo App',
      type: 'app',
      parentId: 'env-root',
    });
    const draft = curation.nodeToDraft(doc.findNode('app-demo')!);
    expect(draft.parentId).toBeNull();
    expect(curation.draftToNode({ ...draft, label: 'Demo App' }).parentId).toBe('env-root');
  });

  it('duplicates an item with a new id and label', () => {
    curation.upsertNode({
      id: 'app-demo',
      label: 'Demo App',
      type: 'app',
      tags: ['customer-facing'],
      parentId: 'env-root',
      description: 'A demo',
      content: '## Notes',
      isRoot: true,
    });
    curation.upsertRelationship({
      id: 'rel-demo',
      sourceId: 'app-demo',
      targetId: 'env-root',
      type: 'depends-on',
    });

    const copy = curation.duplicateNode('app-demo');

    expect(copy.id).toBe('demo-app-copy');
    expect(copy.label).toBe('Demo App copy');
    expect(copy.description).toBe('A demo');
    expect(copy.content).toBe('## Notes');
    expect(copy.isRoot).toBeTrue();
    expect(copy.tags).toEqual(['customer-facing']);
    expect(doc.currentDocument().nodes).toHaveSize(3);
    expect(doc.currentDocument().relationships).toHaveSize(1);
  });

  it('rejects duplicating the root node', () => {
    expect(() => curation.duplicateNode('env-root')).toThrowError(/root/i);
  });

  it('renames a node id and updates all board references', () => {
    curation.upsertNode({
      id: 'app-demo',
      label: 'Demo App',
      type: 'app',
      parentId: 'env-root',
    });
    curation.upsertNode({
      id: 'child-item',
      label: 'Child',
      type: 'app',
      parentId: 'app-demo',
    });
    curation.upsertRelationship({
      id: 'rel-demo',
      sourceId: 'app-demo',
      targetId: 'env-root',
      type: 'depends-on',
    });

    curation.renameNodeId('app-demo', 'app-renamed');

    const current = doc.currentDocument();
    expect(current.nodes.find((n) => n.id === 'app-renamed')?.label).toBe('Demo App');
    expect(doc.findNode('child-item')?.parentId).toBe('app-renamed');
    expect(current.relationships[0]?.sourceId).toBe('app-renamed');
    expect(current.nodes.some((n) => n.id === 'app-demo')).toBeFalse();
  });

  it('rewrites inline reference tokens when renaming a node id', () => {
    curation.upsertNode({
      id: 'app-source',
      label: 'Source',
      type: 'app',
      parentId: 'env-root',
      description: 'Uses {app-target}',
      content: 'See also {app-target}',
    });
    curation.upsertNode({
      id: 'app-target',
      label: 'Target',
      type: 'app',
      parentId: 'env-root',
    });
    curation.upsertRelationship({
      id: 'rel-ref',
      sourceId: 'app-source',
      targetId: 'app-target',
      type: 'uses',
      label: 'Reads {app-target}',
    });

    curation.renameNodeId('app-target', 'app-renamed');

    const current = doc.currentDocument();
    expect(doc.findNode('app-source')?.description).toBe('Uses {app-renamed}');
    expect(doc.findNode('app-source')?.content).toBe('See also {app-renamed}');
    expect(current.relationships[0]?.label).toBe('Reads {app-renamed}');
  });

  it('rejects rename when the new id is already taken', () => {
    curation.upsertNode({
      id: 'app-a',
      label: 'A',
      type: 'app',
      parentId: 'env-root',
    });
    curation.upsertNode({
      id: 'app-b',
      label: 'B',
      type: 'app',
      parentId: 'env-root',
    });

    expect(() => curation.renameNodeId('app-a', 'app-b')).toThrowError(/already in use/i);
  });

  it('updates rootId when renaming the root node', () => {
    curation.renameNodeId('env-root', 'board-root');

    const current = doc.currentDocument();
    expect(current.rootId).toBe('board-root');
    expect(doc.findNode('board-root')?.label).toBe('Test board');
  });
});
