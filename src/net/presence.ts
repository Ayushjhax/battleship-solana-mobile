/**
 * Lobby presence ("142 sailors online") — Supabase Realtime, wired in P11.
 * Until then this returns null and the menu hides the line rather than
 * showing a zero.
 */
export function useOnlineCount(): number | null {
  // TODO(P11): subscribe to the 'lobby' presence channel and return its size.
  return null;
}
