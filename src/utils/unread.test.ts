import { describe, it, expect } from 'vitest';
import { shouldCountUnread, nextUnread, type ParsedMessageLike } from './unread';

const incoming: ParsedMessageLike = { sender: 'them', body: 'hello' };

describe('shouldCountUnread', () => {
  it('counts a live incoming message to a non-open chat while foregrounded', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', null, false)).toBe(true);
  });

  it('counts when a different chat is open', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', 'alice@example.com', false)).toBe(true);
  });

  it('does NOT count a message for the chat currently open', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', 'bob@example.com', false)).toBe(false);
  });

  it('does NOT count our own messages', () => {
    expect(shouldCountUnread({ sender: 'me', body: 'hi' }, 'bob@example.com', null, false)).toBe(false);
  });

  it('does NOT count messages without a body (typing/receipts/etc.)', () => {
    expect(shouldCountUnread({ sender: 'them', body: '' }, 'bob@example.com', null, false)).toBe(false);
    expect(shouldCountUnread({ sender: 'them', body: '   ' }, 'bob@example.com', null, false)).toBe(false);
    expect(shouldCountUnread({ sender: 'them' }, 'bob@example.com', null, false)).toBe(false);
  });

  it('does NOT count archived+delayed MAM backfill', () => {
    expect(
      shouldCountUnread({ sender: 'them', body: 'old', is_archived: true, is_delayed: true }, 'bob@example.com', null, false),
    ).toBe(false);
  });

  it('does NOT count when the document is hidden (Converse counts those itself)', () => {
    expect(shouldCountUnread(incoming, 'bob@example.com', null, true)).toBe(false);
  });

  it('returns false for missing message or jid', () => {
    expect(shouldCountUnread(null, 'bob@example.com', null, false)).toBe(false);
    expect(shouldCountUnread(incoming, null, null, false)).toBe(false);
  });
});

describe('nextUnread', () => {
  it('increments from a number', () => {
    expect(nextUnread(2)).toBe(3);
  });
  it('treats null/undefined/0 as 0', () => {
    expect(nextUnread(0)).toBe(1);
    expect(nextUnread(null)).toBe(1);
    expect(nextUnread(undefined)).toBe(1);
  });
});
