import { getApi, getConverseInternal } from '@/xmpp/client';

/** Aggregated XEP-0444 reactions for a message. */
export interface ReactionSummary {
  emoji: string;
  count: number;
}

const store = new Map<string, Map<string, Set<string>>>();

export function recordReactions(msgid: string, emojis: string[], from: string): void {
  if (!msgid) return;
  let bySender = store.get(msgid);
  if (!bySender) {
    bySender = new Map();
    store.set(msgid, bySender);
  }
  bySender.set(from || 'them', new Set(emojis.filter(Boolean)));
}

export function getReactions(msgid: string | null | undefined): ReactionSummary[] {
  if (!msgid) return [];
  const bySender = store.get(msgid);
  if (!bySender) return [];
  const counts = new Map<string, number>();
  for (const emojis of bySender.values()) {
    for (const emoji of emojis) counts.set(emoji, (counts.get(emoji) || 0) + 1);
  }
  return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
}

/** Send a XEP-0444 reaction and update the local summary. */
export function sendReaction(chatbox: unknown, msgid: string, emoji: string): void {
  if (!msgid || !emoji) return;
  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse || !chatbox || typeof chatbox !== 'object') return;

  const model = chatbox as { get(attr: string): unknown };
  const to = String(model.get('jid') || '');
  const type = model.get('type') === 'groupchat' ? 'groupchat' : 'chat';
  if (!to) return;

  try {
    const { $msg } = _converse.env;
    const stanza = $msg({ to, type })
      .c('reactions', { xmlns: 'urn:xmpp:reactions:0', id: msgid })
      .c('reaction')
      .t(emoji)
      .up()
      .up();
    api.connection.get().send(stanza.tree());
    recordReactions(msgid, [emoji], 'me');
    window.dispatchEvent(new CustomEvent('reactions-changed'));
  } catch (err) {
    console.error('Failed to send reaction:', err);
  }
}
