import { TestBed } from '@angular/core/testing';
import { AboardDocument } from '../models/aboard.models';
import { DocumentService, ImmersedBranchRow } from './document.service';

describe('DocumentService', () => {
  let service: DocumentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DocumentService);
  });

  it('shows inbound relationships for a focused node child', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Pokemon slice',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Collection',
          type: 'environment',
          category: 'environment',
          visibility: 'customer-facing',
          parentId: null,
        },
        {
          id: 'app-pokedex',
          label: 'Pokedex',
          type: 'app',
          category: 'application',
          visibility: 'customer-facing',
          parentId: 'root',
        },
        {
          id: 'dt-pokedex-record',
          label: 'Pokedex Record',
          type: 'item-type',
          category: 'data-type',
          visibility: 'customer-facing',
          parentId: 'app-pokedex',
        },
        {
          id: 'app-catching',
          label: 'Catching',
          type: 'app',
          category: 'application',
          visibility: 'customer-facing',
          parentId: 'root',
        },
      ],
      relationships: [
        {
          id: 'rel-pokedex-builds-record',
          sourceId: 'app-pokedex',
          targetId: 'dt-pokedex-record',
          type: 'builds',
          label: 'Builds',
        },
        {
          id: 'rel-catching-updates-pokedex',
          sourceId: 'app-catching',
          targetId: 'dt-pokedex-record',
          type: 'creates',
          label: 'Creates',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('app-pokedex');

    const recordRow = service.immersedRows().find(
      (row): row is ImmersedBranchRow =>
        row.kind === 'branch' && row.source.id === 'dt-pokedex-record'
    );

    expect(recordRow).toBeDefined();
    expect(recordRow?.entryLabel).toBe('Builds');
    expect(
      recordRow?.branches.some(
        (branch) =>
          branch.incoming === true &&
          branch.target.id === 'app-catching' &&
          branch.relationship.id === 'rel-catching-updates-pokedex'
      )
    ).toBeTrue();
  });
});
