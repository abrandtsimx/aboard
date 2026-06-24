import {
  buildShareUrl,
  decodeBoardPayload,
  encodeBoardPayload,
  encodeBoardPayloadCompressed,
  isShareUrlTooLarge,
  readSharePayloadFromHash,
} from './share-link.util';

describe('share-link.util', () => {
  const sampleJson = JSON.stringify({ title: 'Test board', nodes: [{ id: 'n1', label: 'α' }] });

  it('round-trips board JSON through base64url encoding', async () => {
    const encoded = encodeBoardPayload(sampleJson);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(await decodeBoardPayload(encoded)).toBe(sampleJson);
  });

  it('round-trips board JSON through gzip compression', async () => {
    const repeated = JSON.stringify({
      title: 'Large',
      nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: 'Repeated label text' })),
    });
    const encoded = await encodeBoardPayloadCompressed(repeated);
    expect(encoded.startsWith('g.')).toBeTrue();
    expect(await decodeBoardPayload(encoded)).toBe(repeated);
  });

  it('reads payload from a share hash', async () => {
    const encoded = encodeBoardPayload(sampleJson);
    expect(await readSharePayloadFromHash(`#b=${encoded}`)).toBe(sampleJson);
  });

  it('builds a share URL under the share path', async () => {
    const url = await buildShareUrl(sampleJson);
    expect(url).toContain('/share#b=');
    const hash = url.split('#')[1] ? `#${url.split('#')[1]}` : '';
    expect(await readSharePayloadFromHash(hash)).toBe(sampleJson);
  });

  it('flags oversized share URLs', () => {
    expect(isShareUrlTooLarge('x'.repeat(100), 50)).toBeTrue();
    expect(isShareUrlTooLarge('short', 50)).toBeFalse();
  });
});
