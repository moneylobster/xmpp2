/**
 * Pure helpers for deciding when an incoming chat/room message should bump the
 * unread counter (which in turn drives the contact-list badge, the tab-title
 * badge and the notification sound).
 *
 * Background: Converse.js only increments a chatbox's `num_unread` when the
 * chat `isHidden()` — i.e. `document.hidden` is true, the chat is scrolled up,
 * or the chatbox's `hidden` flag is set (see
 * node_modules/converse.js/src/headless/shared/model-with-messages.js
 * `handleUnreadMessage` / `isHidden`). While the app is foregrounded on the
 * contact list, none of these hold for an un-opened chat, so Converse never
 * counts the message — no sound, no badge.
 *
 * We replicate the count ourselves, but ONLY for the case Converse skips
 * (document visible), so we never double-count messages Converse already
 * counted while the document was hidden.
 */

/** Subset of Converse's parsed message attributes that we care about. */
export interface ParsedMessageLike {
  sender?: string;
  body?: string;
  is_archived?: boolean;
  is_delayed?: boolean;
}

/**
 * Whether an incoming message should bump the unread counter for its chat.
 *
 * @param msg            Parsed message attributes (from the Converse `message` event).
 * @param chatJid        Bare JID of the chat/room the message belongs to.
 * @param activeJid      JID of the chat currently open, or null/undefined.
 * @param documentHidden Whether `document.hidden` is true. When hidden, Converse
 *                       counts the message itself, so we must not.
 */
export function shouldCountUnread(
  msg: ParsedMessageLike | null | undefined,
  chatJid: string | null | undefined,
  activeJid: string | null | undefined,
  documentHidden: boolean,
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
  // When the document is hidden, Converse already increments num_unread — avoid double-count.
  if (documentHidden) return false;
  return true;
}

/** The next unread value after receiving one more unread message. */
export function nextUnread(current: number | null | undefined): number {
  return (current || 0) + 1;
}
