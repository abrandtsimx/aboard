import {
  extractReferenceIds,
  filterMentionCandidates,
  findActiveMention,
  injectReferenceMarkdown,
  insertReferenceToken,
  NODE_REF_HREF_PREFIX,
  replaceReferenceIdInText,
  resolveReferencesToText,
} from './item-reference.util';

const known = new Set(['item-a', 'item-b', 'external-assets-bucket']);
const isKnown = (id: string) => known.has(id);
const labels: Record<string, string> = {
  'item-a': 'Item A',
  'item-b': 'Item B',
  'external-assets-bucket': 'External Assets Bucket',
};
const getLabel = (id: string) => labels[id];

describe('extractReferenceIds', () => {
  it('returns ordered unique known ids', () => {
    expect(
      extractReferenceIds('Retrieves {item-a} from {item-b} and {item-a}', isKnown)
    ).toEqual(['item-a', 'item-b']);
  });

  it('ignores unknown ids and empty braces', () => {
    expect(extractReferenceIds('Has {unknown} and {} and { }', isKnown)).toEqual([]);
  });

  it('handles undefined text', () => {
    expect(extractReferenceIds(undefined, isKnown)).toEqual([]);
  });

  it('trims whitespace inside the token', () => {
    expect(extractReferenceIds('a { item-a } b', isKnown)).toEqual(['item-a']);
  });
});

describe('resolveReferencesToText', () => {
  it('replaces known tokens with labels', () => {
    expect(resolveReferencesToText('Retrieves {item-a} from {item-b}', getLabel)).toBe(
      'Retrieves Item A from Item B'
    );
  });

  it('leaves unknown tokens untouched', () => {
    expect(resolveReferencesToText('Keep {unknown} as-is', getLabel)).toBe(
      'Keep {unknown} as-is'
    );
  });
});

describe('injectReferenceMarkdown', () => {
  it('rewrites tokens to navigation links', () => {
    expect(injectReferenceMarkdown('See {item-a} now', getLabel)).toBe(
      `See [Item A](${NODE_REF_HREF_PREFIX}item-a) now`
    );
  });

  it('encodes ids that need escaping', () => {
    expect(injectReferenceMarkdown('{external-assets-bucket}', getLabel)).toBe(
      `[External Assets Bucket](${NODE_REF_HREF_PREFIX}external-assets-bucket)`
    );
  });

  it('leaves unknown tokens untouched', () => {
    expect(injectReferenceMarkdown('keep {nope}', getLabel)).toBe('keep {nope}');
  });
});

describe('replaceReferenceIdInText', () => {
  it('rewrites matching tokens only', () => {
    expect(replaceReferenceIdInText('See {item-a} and {item-b}', 'item-a', 'item-z')).toBe(
      'See {item-z} and {item-b}'
    );
  });

  it('handles whitespace inside tokens', () => {
    expect(replaceReferenceIdInText('a { item-a } b', 'item-a', 'item-z')).toBe('a {item-z} b');
  });
});

describe('findActiveMention', () => {
  it('detects @query at the cursor', () => {
    const text = 'Talk to @adm';
    expect(findActiveMention(text, text.length)).toEqual({
      start: 8,
      query: 'adm',
      end: 12,
    });
  });

  it('returns null when cursor is not in a mention', () => {
    expect(findActiveMention('Talk to Admin', 5)).toBeNull();
  });

  it('opens an empty query immediately after @', () => {
    const text = 'Uses {item-a} @';
    expect(findActiveMention(text, text.length)).toEqual({
      start: 14,
      query: '',
      end: 15,
    });
  });
});

describe('insertReferenceToken', () => {
  it('replaces @query with a reference token', () => {
    const mention = { start: 8, query: 'adm', end: 12 };
    expect(insertReferenceToken('Talk to @adm now', mention, 'app-admin')).toEqual({
      text: 'Talk to {app-admin} now',
      cursor: 19,
    });
  });
});

describe('filterMentionCandidates', () => {
  const nodes = [
    { id: 'app-admin', label: 'Admin Portal' },
    { id: 'app-client', label: 'Client App' },
    { id: 'dtype-case', label: 'Case Data' },
  ];

  it('returns all items when query is empty', () => {
    expect(filterMentionCandidates(nodes, '').map((n) => n.id)).toEqual([
      'app-admin',
      'dtype-case',
      'app-client',
    ]);
  });

  it('matches label and id fragments', () => {
    expect(filterMentionCandidates(nodes, 'client').map((n) => n.id)).toEqual(['app-client']);
    expect(filterMentionCandidates(nodes, 'dtype').map((n) => n.id)).toEqual(['dtype-case']);
  });

  it('excludes a node id when requested', () => {
    expect(filterMentionCandidates(nodes, '', 'app-admin').map((n) => n.id)).toEqual([
      'dtype-case',
      'app-client',
    ]);
  });
});
