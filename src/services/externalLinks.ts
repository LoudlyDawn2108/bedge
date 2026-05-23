const SAFE_EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function openSafeExternalLink(uri: string): boolean {
  let url: URL;

  try {
    url = new URL(uri, window.location.href);
  } catch {
    return false;
  }

  if (!SAFE_EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) {
    return false;
  }

  window.open(url.href, '_blank', 'noopener,noreferrer');
  return true;
}
