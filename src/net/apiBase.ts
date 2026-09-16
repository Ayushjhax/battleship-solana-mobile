/**
 * Where the match server lives, derived once.
 *
 * EXPO_PUBLIC_API_URL wins when it is set; otherwise the websocket URL is
 * reused with its scheme swapped, because the HTTP API and the socket are the
 * same process on the same host.
 */
export function apiBaseOrNull(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const ws = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (!ws) return null;
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
