/**
 * Pure helpers for deciding when an incoming chat/room message should bump the
 * unread counter (which in turn drives the contact/room badges, the tab-title
 * badge and the notification sound), and for reading/clearing those counters.
 *
 * Background: Converse.js only increments a chatbox's unread counters when the
 * chatbox `isHidden()` — i.e. `chatbox.get('hidden')`, the chat is scrolled up,
 * or `document.hidden` is true (see
 * node_modules/converse.js/src/headless/shared/model-with-messages.js
 * `handleUnreadMessage` / `isHidden`). While the app is foregrounded on the
 * contact list, none of these hold for an un-opened 1:1 chat, so Converse never
 * counts the message — no sound, no badge.
 *
 * We replicate the count ourselves, but ONLY for the case Converse skips, so we
 * never double-count. Note that groupchats are different: they default to
 * `hidden: true` until opened, so Converse *does* count those even while the
 * document is visible. That is why `shouldCountUnread` takes `converseHidden`
 * (the chatbox's own hidden/scrolled state) as well as `documentHidden`.
 *
 * Unread attribute semantics in Converse:
 *  - 1:1 chats: `num_unread` is the number of unread messages.
 *  - MUCs: `num_unread_general` is the number of unread messages (all of them),
 *    while `num_unread` counts only unread mentions. A mention increments both.
 *    `has_activity` is set by XEP-0452 activity notifications.
 */

/** Subset of Converse's parsed message attributes that we care about. */
export interface ParsedMessageLike {
  sender?: string;
  body?: string;
  is_archived?: boolean;
  is_delayed?: boolean;
  nick?: string;
  references?: Array<{ type?: string; value?: string }> | null;
}

/** Minimal surface of a Converse chatbox/MUC model used by these helpers. */
export interface ChatboxLike {
  get(attr: string): unknown;
  set?(attrs: Record<string, unknown>): unknown;
  save?(attrs: Record<string, unknown>): unknown;
  clearUnreadMsgCounter?(): unknown;
}

const GROUPCHAT_TYPE = 'groupchat';

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Total unread messages for a chatbox, using the right counter for its type. */
export function getUnreadCount(chatbox: ChatboxLike | null | undefined): number {
  if (!chatbox?.get) return 0;
  const mentions = toCount(chatbox.get('num_unread'));
  if (chatbox.get('type') !== GROUPCHAT_TYPE) return mentions;
  // `num_unread` can exceed `num_unread_general` for XEP-0452 mention
  // notifications, which are counted without a general unread bump.
  return Math.max(toCount(chatbox.get('num_unread_general')), mentions);
}

/** Whether the chatbox should show an unread indicator (including activity). */
export function hasUnread(chatbox: ChatboxLike | null | undefined): boolean {
  return getUnreadCount(chatbox) > 0 || !!chatbox?.get?.('has_activity');
}

/**
 * Whether an incoming message should bump the unread counter for its chat.
 *
 * @param msg             Parsed message attributes (from the Converse `message` event).
 * @param chatJid         Bare JID of the chat/room the message belongs to.
 * @param activeJid       JID of the chat currently open, or null/undefined.
 * @param documentHidden  Whether `document.hidden` is true.
 * @param converseHidden  Whether Converse considers the chatbox hidden/scrolled
 *                        (`chatbox.get('hidden') || chatbox.isScrolledUp()`).
 *                        Converse counts those messages itself, so we must not.
 */
export function shouldCountUnread(
  msg: ParsedMessageLike | null | undefined,
  chatJid: string | null | undefined,
  activeJid: string | null | undefined,
  documentHidden: boolean,
  converseHidden = false,
): boolean {
  if (!msg || !chatJid) return false;
  // Archived + delayed = MAM backfill, never a "new" message (mirrors Converse's isNewMessage).
  if (msg.is_archived && msg.is_delayed) return false;
  // Our own messages don't count as unread.
  if (msg.sender === 'me') return false;
  // Must carry actual text.
  if (!msg.body || !msg.body.trim()) return false;
  // The chat the user is currently viewing is being read — not unread.
  if (activeJid && chatJid === activeJid) return false;
  // Converse already increments the counters in these cases — avoid double-counting.
  if (documentHidden || converseHidden) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Mirrors Converse's `MUC.isUserMentioned`. */
function isUserMentioned(chatbox: ChatboxLike, msg: ParsedMessageLike): boolean {
  const nick = chatbox.get('nick');
  if (typeof nick !== 'string' || !nick) return false;
  const references = msg.references;
  if (Array.isArray(references) && references.length) {
    return references.some((ref) => ref?.type === 'mention' && ref?.value === nick);
  }
  return typeof msg.body === 'string' && new RegExp(`\\b${escapeRegExp(nick)}\\b`).test(msg.body);
}

function updateChatbox(chatbox: ChatboxLike, attrs: Record<string, unknown>): void {
  if (typeof chatbox.save === 'function') {
    chatbox.save(attrs);
  } else {
    chatbox.set?.(attrs);
  }
}

/**
 * Increment the appropriate unread counter for a message Converse did not count.
 * MUCs track all unread messages in `num_unread_general` and mentions separately
 * in `num_unread`, exactly like Converse's `MUC.incrementUnreadMsgsCounter`.
 */
export function incrementUnread(
  chatbox: ChatboxLike | null | undefined,
  msg: ParsedMessageLike | null | undefined,
): void {
  if (!chatbox?.get) return;

  if (chatbox.get('type') === GROUPCHAT_TYPE) {
    const attrs: Record<string, unknown> = {
      num_unread_general: toCount(chatbox.get('num_unread_general')) + 1,
    };
    if (msg && isUserMentioned(chatbox, msg)) {
      attrs.num_unread = toCount(chatbox.get('num_unread')) + 1;
    }
    updateChatbox(chatbox, attrs);
    return;
  }

  updateChatbox(chatbox, { num_unread: toCount(chatbox.get('num_unread')) + 1 });
}

/**
 * Clear all unread state for a chatbox.
 *
 * Prefer Converse's own `clearUnreadMsgCounter()`: for MUCs it also clears
 * `num_unread_general` / `has_activity` and sends a XEP-0333 read marker. The
 * direct attribute fallback covers models without that method.
 */
export async function clearUnread(chatbox: ChatboxLike | null | undefined): Promise<void> {
  if (!chatbox?.get) return;

  const forceClear = () =>
    updateChatbox(chatbox, { num_unread: 0, num_unread_general: 0, has_activity: false });

  if (typeof chatbox.clearUnreadMsgCounter === 'function') {
    try {
      const result = chatbox.clearUnreadMsgCounter();
      // Clear synchronously as well: a MUC's implementation awaits a read-marker
      // send before saving the counters, and callers need the badge gone now.
      forceClear();
      if (result instanceof Promise) await result.catch(forceClear);
      return;
    } catch {
      // Fall through to the direct clear below.
    }
  }
  forceClear();
}
