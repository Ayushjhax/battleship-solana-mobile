/**
 * Emotes over the Supabase Realtime match channel — wired in P13. Until then
 * sending is a local no-op that still resolves, so the UI can float the
 * sticker regardless.
 */
export interface EmoteMessage {
  readonly matchId: string;
  readonly from: string;
  readonly emoteId: number;
}

export async function sendEmote(message: EmoteMessage): Promise<void> {
  // TODO(P13): supabase.channel(`match:${message.matchId}`).send({ type: 'broadcast', event: 'emote', payload: message })
  void message;
}

export function subscribeEmotes(
  _matchId: string,
  _onEmote: (message: EmoteMessage) => void,
): () => void {
  // TODO(P13): subscribe to the channel and return the unsubscribe.
  return () => {};
}
