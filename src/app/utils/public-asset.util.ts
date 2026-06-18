export function publicAssetUrl(path: string): string {
  const relativePath = path.replace(/^\/+/, '');
  return new URL(relativePath, document.baseURI).toString();
}
