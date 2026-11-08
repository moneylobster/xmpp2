import { describe, it, expect } from 'vitest';
import {
  shouldCountUnread,
  getUnreadCount,
  incrementUnread,
  clearUnread,
  type ChatboxLike,
  type ParsedMessageLike,
} from './unread';

const incoming: ParsedMessageLike = { sender: 'them', body: 'hello' };

class FakeChatbox implements ChatboxLike {
  attrs: Record<string, unknown>;
  clearCalls = 0;

  constructor(attrs: Record<string, unknown> = {}) {
    this.attrs = { ...attrs };
  }

  get(attr: string) {
    return this.attrs[attr];
  }

  set(attrs: Record<string, unknown>) {
    Object.assign(this.attrs, attrs);
  }

  save(attrs: Record<string, unknown>) {
    this.set(attrs);
  }

  clearUnreadMsgCounter() {
    this.clearCalls += 1;
    this.set({ num_unread: 0, num_unread_general: 0, has_activity: false });
  }
}

describe('shouldCountUnread', () => {
  it('counts a live incoming message to a non-open chat while foregrounded', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', null, false, false)).toBe(true);
  });

  it('counts when a different chat is open', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', 'alice@example.com', false, false)).toBe(true);
  });

  it('does NOT count a message for the chat currently open', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', 'bob@example.com', false, false)).toBe(false);
  });

  it('does NOT count our own messages', () => {
    expect(shouldCountUnread({ sender: 'me', body: 'hi' }, 'bob@example.com', null, false, false)).toBe(false);
  });

  it('does NOT count messages without a body (typing/receipts/etc.)', () => {
    expect(shouldCountUnread({ sender: 'them', body: '' }, 'bob@example.com', null, false, false)).toBe(false);
    expect(shouldCountUnread({ sender: 'them', body: '   ' }, 'bob@example.com', null, false, false)).toBe(false);
    expect(shouldCountUnread({ sender: 'them' }, 'bob@example.com', null, false, false)).toBe(false);
  });

  it('does NOT count archived+delayed MAM backfill', () => {
    expect(
      shouldCountUnread({ sender: 'them', body: 'old', is_archived: true, is_delayed: true }, 'bob@example.com', null, false, false),
    ).toBe(false);
  });

  it('does NOT count when the document is hidden (Converse counts those itself)', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', null, true, false)).toBe(false);
  });

  it('does NOT count when Converse already considers the chatbox hidden or scrolled', () => {
    expect(shouldCountUnread(incoming, 'room@muc.example.com', null, false, true)).toBe(false);
  });

  it('returns false for missing message or jid', () => {
    expect(shouldCountUnread(null, 'bob@example.com', null, false, false)).toBe(false);
    expect(shouldCountUnread(incoming, null, null, false, false)).toBe(false);
  });
});

describe('getUnreadCount', () => {
  it('uses num_unread for 1:1 chats', () => {
    expect(getUnreadCount(new FakeChatbox({ type: 'chat', num_unread: 3 }))).toBe(3);
  });

  it('uses num_unread_general for groupchats', () => {
    expect(getUnreadCount(new FakeChatbox({ type: 'groupchat', num_unread: 1, num_unread_general: 7 }))).toBe(7);
  });

  it('keeps a larger mention count when general is missing (XEP-0452)', () => {
    expect(getUnreadCount(new FakeChatbox({ type: 'groupchat', num_unread: 4 }))).toBe(4);
  });

  it('treats missing, negative and non-numeric values as zero', () => {
    expect(getUnreadCount(null)).toBe(0);
    expect(getUnreadCount(new FakeChatbox({ type: 'chat', num_unread: -2 }))).toBe(0);
    expect(getUnreadCount(new FakeChatbox({ type: 'chat', num_unread: 'nope' }))).toBe(0);
  });
});

describe('incrementUnread', () => {
  it('increments num_unread for 1:1 chats', () => {
    const chat = new FakeChatbox({ type: 'chat', num_unread: 2 });
    incrementUnread(chat, incoming);
    expect(chat.get('num_unread')).toBe(3);
  });

  it('increments only num_unread_general for a non-mention groupchat message', () => {
    const room = new FakeChatbox({ type: 'groupchat', nick: 'me', num_unread: 0, num_unread_general: 0 });
    incrementUnread(room, { sender: 'them', body: 'hello all', nick: 'bob' });
    expect(room.get('num_unread_general')).toBe(1);
    expect(room.get('num_unread')).toBe(0);
  });

  it('increments both counters for a mention reference', () => {
    const room = new FakeChatbox({ type: 'groupchat', nick: 'me', num_unread: 0, num_unread_general: 0 });
    incrementUnread(room, {
      sender: 'them',
      body: 'ping',
      references: [{ type: 'mention', value: 'me' }],
    });
    expect(room.get('num_unread_general')).toBe(1);
    expect(room.get('num_unread')).toBe(1);
  });

  it('detects a mention in the body when no references are present', () => {
    const room = new FakeChatbox({ type: 'groupchat', nick: 'me', num_unread: 0, num_unread_general: 0 });
    incrementUnread(room, { sender: 'them', body: 'hey me, look at this' });
    expect(room.get('num_unread')).toBe(1);
  });

  it('does not count a mention of a different nick', () => {
    const room = new FakeChatbox({ type: 'groupchat', nick: 'me', num_unread: 0, num_unread_general: 0 });
    incrementUnread(room, { sender: 'them', body: 'hey bob' });
    expect(room.get('num_unread')).toBe(0);
  });
});

describe('clearUnread', () => {
  it('uses the chatbox clearUnreadMsgCounter when available', async () => {
    const room = new FakeChatbox({ type: 'groupchat', num_unread: 2, num_unread_general: 5, has_activity: true });
    await clearUnread(room);
    expect(room.clearCalls).toBe(1);
    expect(room.get('num_unread')).toBe(0);
    expect(room.get('num_unread_general')).toBe(0);
    expect(room.get('has_activity')).toBe(false);
  });

  it('falls back to clearing every counter directly', async () => {
    const attrs: Record<string, unknown> = { type: 'groupchat', num_unread: 2, num_unread_general: 5, has_activity: true };
    const model: ChatboxLike = {
      get: (attr) => attrs[attr],
      set: (next) => Object.assign(attrs, next),
    };
    await clearUnread(model);
    expect(attrs.num_unread).toBe(0);
    expect(attrs.num_unread_general).toBe(0);
    expect(attrs.has_activity).toBe(false);
  });

  it('is a no-op for a missing chatbox', async () => {
    await expect(clearUnread(null)).resolves.toBeUndefined();
  });
});
