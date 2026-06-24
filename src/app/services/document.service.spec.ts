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
          visibility: 'customer-facing',
          parentId: null,
        },
        {
          id: 'app-pokedex',
          label: 'Pokedex',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
        {
          id: 'dt-pokedex-record',
          label: 'Pokedex Record',
          type: 'item-type',
          visibility: 'customer-facing',
          parentId: 'app-pokedex',
        },
        {
          id: 'app-catching',
          label: 'Catching',
          type: 'app',
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

  it('previews a related node on an immersed page before navigating to it', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Preview slice',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          visibility: 'customer-facing',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App A',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
        {
          id: 'app-b',
          label: 'App B',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
      ],
      relationships: [
        {
          id: 'rel-a-b',
          sourceId: 'app-a',
          targetId: 'app-b',
          type: 'uses',
          label: 'Uses',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('app-a');
    expect(service.immersedPreviewNodeId()).toBeNull();
    expect(service.immersedViewNode()?.id).toBe('app-a');

    service.setImmersedPreview('app-b');
    expect(service.immersedPreviewNodeId()).toBe('app-b');
    expect(service.immersedViewNode()?.id).toBe('app-b');
    expect(service.immersedNode()?.id).toBe('app-a');
    expect(
      service.immersedRows().some((row) => row.kind === 'outbound' && row.target.id === 'app-b')
    ).toBeTrue();

    service.navigateToImmersed('app-b');
    expect(service.immersedPreviewNodeId()).toBeNull();
    expect(service.immersedNode()?.id).toBe('app-b');
  });

  it('steps back along the breadcrumb trail instead of the parent hierarchy', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Trail slice',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          visibility: 'customer-facing',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App A',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
        {
          id: 'app-b',
          label: 'App B',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
      ],
      relationships: [
        {
          id: 'rel-a-b',
          sourceId: 'app-a',
          targetId: 'app-b',
          type: 'uses',
          label: 'Uses',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('app-a');
    service.navigateToImmersed('app-b');
    expect(service.navTrailIds()).toEqual(['app-a', 'app-b']);

    expect(service.stepBackInTrail()).toBeTrue();
    expect(service.immersedNode()?.id).toBe('app-a');
    expect(service.navTrailIds()).toEqual(['app-a']);
    expect(service.mode()).toBe('immersed');

    service.focusAfterTrailStepBack('app-b');
    expect(service.immersedPreviewNodeId()).toBe('app-b');
    expect(service.immersedNode()?.id).toBe('app-a');
  });

  it('returns to the root canvas when stepping back from the first trail item', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Trail root slice',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          visibility: 'customer-facing',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App A',
          type: 'app',
          visibility: 'customer-facing',
          parentId: 'root',
        },
      ],
      relationships: [],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('app-a');
    expect(service.navTrailIds()).toEqual(['app-a']);

    expect(service.stepBackInTrail()).toBeTrue();
    expect(service.mode()).toBe('canvas');
    expect(service.navTrailIds()).toEqual([]);
    expect(service.peekId()).toBeNull();

    service.focusAfterTrailStepBack('app-a');
    expect(service.peekId()).toBe('app-a');
  });

  it('opens Voice Clip immersed from Scenario Editor via sidebar navigation', () => {
    service.loadDocument({
      version: '1.0',
      title: 'SimX Platform Overview',
      rootId: 'env-simx',
      nodes: [
        {
          id: 'env-simx',
          label: 'SimX Ecosystem',
          type: 'environment',
          parentId: null,
        },
        {
          id: 'app-scenario-editor',
          label: 'Scenario Editor',
          type: 'app',
          parentId: 'env-simx',
        },
        {
          id: 'dtype-voice-clip',
          label: 'Voice Clip',
          type: 'item-type',
          parentId: 'app-scenario-editor',
        },
        {
          id: 'svc-aws-s3',
          label: 'AWS S3 Bucket',
          type: 'system',
          parentId: 'env-simx',
        },
        {
          id: 'ext-eleven-labs',
          label: 'Eleven Labs',
          type: 'external',
          parentId: 'env-simx',
        },
      ],
      relationships: [
        {
          id: 'rel-editor-creates-voice',
          sourceId: 'app-scenario-editor',
          targetId: 'dtype-voice-clip',
          type: 'creates',
          label: 'Creates',
        },
        {
          id: 'rel-voice-s3',
          sourceId: 'dtype-voice-clip',
          targetId: 'svc-aws-s3',
          type: 'stores-in',
          label: 'Stored in AWS S3',
        },
        {
          id: 'rel-eleven-voice',
          sourceId: 'ext-eleven-labs',
          targetId: 'dtype-voice-clip',
          type: 'generates',
          label: 'Generates',
        },
      ],
    });

    service.navigateTo('app-scenario-editor');
    expect(service.mode()).toBe('immersed');
    expect(service.immersedNode()?.id).toBe('app-scenario-editor');

    service.navigateTo('dtype-voice-clip');
    expect(service.mode()).toBe('immersed');
    expect(service.immersedNode()?.id).toBe('dtype-voice-clip');
    expect(service.immersedRows().some((row) => row.kind === 'outbound' && row.target.id === 'svc-aws-s3')).toBeTrue();
    expect(service.immersedCreators().some((c) => c.source.id === 'ext-eleven-labs')).toBeTrue();
  });

  it('opens immersed view for schema container and external-tool nodes', () => {
    service.loadDocument({
      version: '1.0',
      title: 'SimX Curated',
      rootId: 'env-root',
      nodes: [
        { id: 'env-root', label: 'Root', type: 'environment', parentId: null },
        {
          id: 'aws',
          label: 'AWS',
          type: 'external-tool',
          parentId: 'env-root',
        },
        {
          id: 'external-assets-bucket',
          label: 'External Assets Bucket',
          type: 'container',
          parentId: 'aws',
        },
        {
          id: 'simx-dialog',
          label: 'SimX Dialog',
          type: 'data-type',
          parentId: 'external-assets-bucket',
        },
      ],
      relationships: [],
    });

    service.navigateTo('aws');
    expect(service.mode()).toBe('immersed');
    expect(service.immersedNode()?.id).toBe('aws');
    expect(
      service.immersedRows().some((row) => row.kind === 'outbound' && row.target.id === 'external-assets-bucket')
    ).toBeTrue();

    service.navigateTo('external-assets-bucket');
    expect(service.mode()).toBe('immersed');
    expect(service.immersedNode()?.id).toBe('external-assets-bucket');
    expect(
      service.immersedRows().some((row) => row.kind === 'outbound' && row.target.id === 'simx-dialog')
    ).toBeTrue();
    expect(
      service.immersedRows().some((row) => row.kind === 'outbound' && row.target.id === 'aws')
    ).toBeTrue();
  });

  it('connects a relationship to its target when the label mentions other items', () => {
    service.loadDocument({
      version: '1.0',
      title: 'Reference slice',
      rootId: 'env',
      nodes: [
        { id: 'env', label: 'Env', type: 'environment', parentId: null },
        { id: 'app-client', label: 'Client', type: 'app', parentId: 'env' },
        { id: 'app-admin', label: 'Admin', type: 'app', parentId: 'env' },
        { id: 'dt-mutation', label: 'Mutation', type: 'item-type', parentId: 'app-admin' },
      ],
      relationships: [
        {
          id: 'rel-client-admin',
          sourceId: 'app-client',
          targetId: 'app-admin',
          type: 'retrieves-from',
          label: 'Retrieves {dt-mutation} from {app-admin}',
        },
      ],
    });

    service.navigateTo('app-client');
    expect(service.immersedNode()?.id).toBe('app-client');

    // Label mentions do not spawn extra outbound arrows to referenced items.
    expect(
      service
        .immersedRows()
        .some((row) => row.kind === 'outbound' && row.target.id === 'dt-mutation')
    ).toBeFalse();

    const adminRows = service
      .immersedRows()
      .filter((row) => row.kind === 'outbound' && row.target.id === 'app-admin');
    expect(adminRows.length).toBe(1);
    expect(adminRows[0].kind === 'outbound' && adminRows[0].reference).toBeFalsy();
  });

  it('resolves {id} mentions in a label to item labels', () => {
    service.loadDocument({
      version: '1.0',
      title: 'Reference text slice',
      rootId: 'env',
      nodes: [
        { id: 'env', label: 'Env', type: 'environment', parentId: null },
        { id: 'app-a', label: 'Alpha', type: 'app', parentId: 'env' },
      ],
      relationships: [],
    });

    expect(service.resolveReferenceText('Talk to {app-a} now')).toBe('Talk to Alpha now');
    expect(service.resolveReferenceText('Unknown {nope}')).toBe('Unknown {nope}');
  });

  it('lists map root items when isRoot flags are present', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Map slice',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          parentId: null,
        },
        {
          id: 'app-a',
          label: 'App A',
          type: 'app',
          parentId: 'root',
          isRoot: true,
        },
        {
          id: 'app-b',
          label: 'App B',
          type: 'app',
          parentId: 'root',
        },
        {
          id: 'env-child',
          label: 'Pod',
          type: 'environment',
          parentId: 'root',
          isRoot: true,
        },
      ],
      relationships: [],
    };

    service.loadDocument(doc);
    expect(service.canvasNodes().map((n) => n.id).sort()).toEqual(['app-a', 'env-child']);
  });

  it('computes map view links via shared non-root neighbors', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Map links',
      rootId: 'root',
      nodes: [
        {
          id: 'root',
          label: 'Root',
          type: 'environment',
          parentId: null,
        },
        {
          id: 'app-editor',
          label: 'Scenario Editor',
          type: 'app',
          parentId: 'root',
          isRoot: true,
        },
        {
          id: 'app-portal',
          label: 'Admin Portal',
          type: 'app',
          parentId: 'root',
          isRoot: true,
        },
        {
          id: 'dtype-mutations',
          label: 'Mutations',
          type: 'item-type',
          parentId: 'app-editor',
        },
      ],
      relationships: [
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
      ],
    };

    service.loadDocument(doc);
    const links = service.mapViewLinks();
    expect(
      links.some(
        (l) =>
          l.viaNeighborId === 'dtype-mutations' &&
          ((l.sourceId === 'app-editor' && l.targetId === 'app-portal') ||
            (l.sourceId === 'app-portal' && l.targetId === 'app-editor'))
      )
    ).toBeTrue();
  });

  it('surfaces parent bucket relationships on a process focused page', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Voice storage',
      rootId: 'env',
      nodes: [
        {
          id: 'env',
          label: 'Env',
          type: 'environment',
          visibility: 'internal',
          parentId: null,
        },
        {
          id: 'svc-aws-s3',
          label: 'AWS S3 Bucket',
          type: 'system',
          visibility: 'internal',
          parentId: 'env',
        },
        {
          id: 'aspect-s3-sort',
          label: 'Stores UGC Voice Clips',
          type: 'aspect',
          visibility: 'internal',
          parentId: 'svc-aws-s3',
        },
        {
          id: 'dtype-voice-clip',
          label: 'Voice Clip',
          type: 'item-type',
          visibility: 'internal',
          parentId: 'app-editor',
        },
        {
          id: 'app-editor',
          label: 'Scenario Editor',
          type: 'app',
          visibility: 'internal',
          parentId: 'env',
        },
      ],
      relationships: [
        {
          id: 'rel-voice-s3',
          sourceId: 'dtype-voice-clip',
          targetId: 'svc-aws-s3',
          type: 'stores-in',
          label: 'Stored in AWS S3',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('aspect-s3-sort');
    const rows = service.immersedRows();
    const branch = rows.find((row): row is ImmersedBranchRow => row.kind === 'branch');

    expect(branch).toBeDefined();
    expect(branch!.source.id).toBe('svc-aws-s3');
    expect(branch!.branches.some((b) => b.target.id === 'dtype-voice-clip')).toBeTrue();
  });

  it('opens an application with only aspect children as an immersed page', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'Session',
      rootId: 'env',
      nodes: [
        {
          id: 'env',
          label: 'Env',
          type: 'environment',
          visibility: 'internal',
          parentId: null,
        },
        {
          id: 'app-session-server',
          label: 'Session Server',
          type: 'app',
          visibility: 'internal',
          parentId: 'env',
        },
        {
          id: 'aspect-session-parse',
          label: 'Parses Mutations',
          type: 'aspect',
          visibility: 'internal',
          parentId: 'app-session-server',
        },
      ],
      relationships: [],
    };

    service.loadDocument(doc);
    service.navigateTo('app-session-server');

    expect(service.mode()).toBe('immersed');
    expect(service.immersedNode()?.id).toBe('app-session-server');
  });

  it('hides the structural board root from immersed relationship graphs', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'SimX Board',
      rootId: 'env-root',
      nodes: [
        { id: 'env-root', label: 'Untitled board', type: 'environment', parentId: null },
        { id: 'app-client', label: 'SimX Client', type: 'app', parentId: 'env-root', isRoot: true },
        { id: 'dtype-case', label: 'Case File', type: 'item-type', parentId: 'app-client' },
      ],
      relationships: [
        {
          id: 'rel-root-client',
          sourceId: 'env-root',
          targetId: 'app-client',
          type: 'contains',
          label: 'Part of',
        },
        {
          id: 'rel-client-case',
          sourceId: 'app-client',
          targetId: 'dtype-case',
          type: 'uses',
          label: 'Runs in conjunction with Session Server',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('app-client');

    const rowTargets = service
      .immersedRows()
      .flatMap((row) =>
        row.kind === 'outbound'
          ? [row.target.id]
          : [row.source.id, ...row.branches.map((b) => b.target.id)]
      );

    expect(rowTargets).not.toContain('env-root');
    expect(rowTargets).toContain('dtype-case');
    expect(service.hierarchyCrumbs().map((n) => n.id)).toEqual(['app-client']);
  });

  it('surfaces label-mentioned neighbors when the focused node is the relationship target', () => {
    const doc: AboardDocument = {
      version: '1.0',
      title: 'SimX Board',
      rootId: 'env-root',
      nodes: [
        { id: 'env-root', label: 'Root', type: 'environment', parentId: null },
        { id: 'app-client', label: 'SimX Client', type: 'app', parentId: 'env-root' },
        { id: 'app-session', label: 'Session Server', type: 'app', parentId: 'env-root' },
        { id: 'dtype-case', label: 'Case File', type: 'item-type', parentId: 'app-client' },
      ],
      relationships: [
        {
          id: 'rel-client-case',
          sourceId: 'app-client',
          targetId: 'dtype-case',
          type: 'runs',
          label: 'Runs in conjunction with {app-session}',
        },
      ],
    };

    service.loadDocument(doc);
    service.navigateToImmersed('dtype-case');

    const refs = service
      .immersedRows()
      .filter((row) => row.kind === 'outbound' && row.reference)
      .map((row) => (row.kind === 'outbound' ? row.target.id : ''));
    expect(refs).toContain('app-session');
  });
});
