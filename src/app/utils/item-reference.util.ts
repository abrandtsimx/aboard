/**
 * Inline item references let authors mention other board items inside text using
 * a `{itemId}` token, e.g. a relationship label `"Retrieves {dtype-case} from {app-admin}"`.
 * In the board editor, type `@` to open a searchable picker that inserts these tokens.
 *
 * Two consumers exist:
 *  - Relationship labels: tokens resolve to the referenced item's label on the
 *    arrow; when the relationship target is peeked or in focused view, other
 *    `{id}` mentions in that label also appear as dotted reference links.
 *  - Node markdown: tokens become clickable links that navigate to the item.
 *
 * Only tokens whose id resolves to a real node are replaced; anything else is
 * left untouched so ordinary braces in prose/code survive.
 */

/** Markdown/anchor href scheme used for in-board navigation links. */
export const NODE_REF_HREF_PREFIX = '#aboard-node:';

// `{ id }` — first inner char must be non-space so empty `{}` and `{ }` are ignored.
const REFERENCE_RE = /\{\s*([^{}\s][^{}]*?)\s*\}/g;

/** Ordered, de-duplicated ids referenced in `text` that resolve to a known node. */
export function extractReferenceIds(
  text: string | undefined | null,
  isKnownId: (id: string) => boolean
): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(REFERENCE_RE)) {
    const id = match[1].trim();
    if (!id || seen.has(id) || !isKnownId(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Replace `{id}` tokens with the resolved item label (plain text). */
export function resolveReferencesToText(
  text: string | undefined | null,
  getLabel: (id: string) => string | undefined
): string {
  if (!text) return text ?? '';
  return text.replace(REFERENCE_RE, (whole, rawId: string) => {
    const label = getLabel(rawId.trim());
    return label ?? whole;
  });
}

/** Replace `{id}` tokens with a markdown navigation link `[Label](#aboard-node:id)`. */
export function injectReferenceMarkdown(
  markdown: string | undefined | null,
  getLabel: (id: string) => string | undefined
): string {
  if (!markdown) return markdown ?? '';
  return markdown.replace(REFERENCE_RE, (whole, rawId: string) => {
    const id = rawId.trim();
    const label = getLabel(id);
    if (label == null) return whole;
    // Square brackets would break the markdown link text; drop them.
    const safe = label.replace(/[\[\]]/g, '').trim() || id;
    return `[${safe}](${NODE_REF_HREF_PREFIX}${encodeURIComponent(id)})`;
  });
}

/** Rewrite `{oldId}` tokens to `{newId}` across a text field (e.g. after a node rename). */
export function replaceReferenceIdInText(
  text: string | undefined | null,
  oldId: string,
  newId: string
): string {
  if (!text) return text ?? '';
  return text.replace(REFERENCE_RE, (whole, rawId: string) => {
    return rawId.trim() === oldId ? `{${newId}}` : whole;
  });
}

export interface MentionCandidate {
  id: string;
  label: string;
}

/** Active `@` mention span at the text cursor, if any. */
export interface MentionState {
  start: number;
  query: string;
  end: number;
}

const MENTION_BREAK_RE = /[\s\n{}]/;

/** Detect an in-progress `@query` mention ending at `cursor`. */
export function findActiveMention(text: string, cursor: number): MentionState | null {
  if (cursor < 0 || cursor > text.length) return null;

  const at = text.lastIndexOf('@', cursor - 1);
  if (at < 0) return null;

  const query = text.slice(at + 1, cursor);
  if (query.includes('@') || MENTION_BREAK_RE.test(query)) return null;
  if (at > 0 && !MENTION_BREAK_RE.test(text[at - 1])) return null;

  return { start: at, query, end: cursor };
}

/** Insert a `{nodeId}` token where the user typed `@query`. */
export function insertReferenceToken(
  text: string,
  mention: MentionState,
  nodeId: string
): { text: string; cursor: number } {
  const token = `{${nodeId}}`;
  const nextText = text.slice(0, mention.start) + token + text.slice(mention.end);
  return { text: nextText, cursor: mention.start + token.length };
}

const MENTION_RESULT_LIMIT = 12;

/** Filter board items for the `@` mention picker. */
export function filterMentionCandidates(
  nodes: MentionCandidate[],
  query: string,
  excludeId?: string
): MentionCandidate[] {
  const pool = excludeId ? nodes.filter((n) => n.id !== excludeId) : nodes;
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...pool]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, MENTION_RESULT_LIMIT);
  }

  const scored = pool
    .map((node) => {
      const label = node.label.toLowerCase();
      const id = node.id.toLowerCase();
      let score = 0;
      if (label.startsWith(q)) score = 100;
      else if (id.startsWith(q)) score = 90;
      else if (label.includes(q)) score = 50;
      else if (id.includes(q)) score = 40;
      return { node, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort(
    (a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label)
  );
  return scored.slice(0, MENTION_RESULT_LIMIT).map((entry) => entry.node);
}
