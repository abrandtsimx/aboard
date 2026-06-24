const SHARE_HASH_PREFIX = 'b=';
const GZIP_PAYLOAD_PREFIX = 'g.';
/** Practical max URL length for clipboard/browser sharing (hash included). */
export const SHARE_URL_LENGTH_LIMIT = 32_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  const pad = trimmed.length % 4;
  const normalized =
    trimmed.replace(/-/g, '+').replace(/_/g, '/') + (pad ? '='.repeat(4 - pad) : '');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function canUseCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode board JSON as a URL-safe base64 fragment (UTF-8, uncompressed). */
export function encodeBoardPayload(json: string): string {
  return bytesToBase64Url(new TextEncoder().encode(json));
}

/** Gzip-compress then base64url-encode board JSON. */
export async function encodeBoardPayloadCompressed(json: string): Promise<string> {
  if (!canUseCompression()) return encodeBoardPayload(json);

  const compressed = await gzipCompress(new TextEncoder().encode(json));
  return `${GZIP_PAYLOAD_PREFIX}${bytesToBase64Url(compressed)}`;
}

/** Decode a share-link payload back to board JSON. */
export async function decodeBoardPayload(encoded: string): Promise<string> {
  const trimmed = encoded.trim();
  if (!trimmed) throw new Error('Share link is missing board data.');

  if (trimmed.startsWith(GZIP_PAYLOAD_PREFIX)) {
    if (!canUseCompression()) {
      throw new Error('This share link uses compression that this browser does not support.');
    }
    const bytes = await gzipDecompress(base64UrlToBytes(trimmed.slice(GZIP_PAYLOAD_PREFIX.length)));
    return new TextDecoder().decode(bytes);
  }

  return new TextDecoder().decode(base64UrlToBytes(trimmed));
}

/** View-only share page URL (no embedded board data). */
export function buildShareViewerUrl(): string {
  const sharePath = new URL('share', document.baseURI).pathname;
  return `${window.location.origin}${sharePath}`;
}

/** Build a view-only share URL with the board embedded in the hash. */
export async function buildShareUrl(boardJson: string): Promise<string> {
  const sharePath = new URL('share', document.baseURI).pathname;
  const raw = encodeBoardPayload(boardJson);
  const compressed = await encodeBoardPayloadCompressed(boardJson);
  const payload = compressed.length < raw.length ? compressed : raw;
  return `${window.location.origin}${sharePath}#${SHARE_HASH_PREFIX}${payload}`;
}

/** Read encoded board JSON from the current location hash, if present. */
export async function readSharePayloadFromHash(hash = window.location.hash): Promise<string | null> {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;

  const payload = raw.startsWith(SHARE_HASH_PREFIX) ? raw.slice(SHARE_HASH_PREFIX.length) : raw;
  if (!payload) return null;

  return decodeBoardPayload(payload);
}

/** Rough browser URL length guard for encoded share links. */
export function isShareUrlTooLarge(url: string, limit = SHARE_URL_LENGTH_LIMIT): boolean {
  return url.length > limit;
}

/**
 * Self-opening HTML file that loads the hosted viewer and passes board JSON via postMessage.
 * Works for boards of any size (no URL length limit).
 */
export function buildShareHtmlFile(title: string, boardJson: string): string {
  const viewerUrl = `${buildShareViewerUrl()}?embed=1`;
  const viewerOrigin = new URL(viewerUrl).origin;
  const safeTitle = title.trim() || 'Shared board';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(safeTitle)} — Aboard</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Lato, system-ui, sans-serif;
      background: #091d3c;
      color: #fff;
    }
    p { margin: 0; opacity: 0.85; }
    iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <p id="status">Opening shared board…</p>
  <script>
    (function () {
      var VIEWER = ${JSON.stringify(viewerUrl)};
      var ORIGIN = ${JSON.stringify(viewerOrigin)};
      var BOARD_JSON = ${JSON.stringify(boardJson)};
      var frame = document.createElement('iframe');
      frame.src = VIEWER;
      frame.title = ${JSON.stringify(safeTitle)};
      frame.onload = function () {
        frame.contentWindow.postMessage({ type: 'aboard-share', json: BOARD_JSON }, ORIGIN);
        document.body.innerHTML = '';
        document.body.appendChild(frame);
      };
      frame.onerror = function () {
        document.getElementById('status').textContent = 'Could not load the Aboard viewer.';
      };
      document.body.appendChild(frame);
    })();
  </script>
</body>
</html>`;
}

/** Extract board JSON embedded in an `.aboard.html` share file. */
export function extractBoardJsonFromShareHtml(html: string): string {
  const match = html.match(/var BOARD_JSON = (.+);\r?\n/);
  if (!match?.[1]) {
    throw new Error('This HTML file is not a valid Aboard share file.');
  }
  return JSON.parse(match[1]) as string;
}

export function downloadShareHtml(title: string, boardJson: string): void {
  const html = buildShareHtmlFile(title, boardJson);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugifyFilename(title)}.aboard.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugifyFilename(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return slug || 'shared-board';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
