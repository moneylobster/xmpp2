import { describe, it, expect } from 'vitest';
import { splitLinks, getSingleHttpUrl } from './chat-utils';

describe('splitLinks', () => {
  it('leaves plain text alone', () => {
    expect(splitLinks('hello there')).toEqual([{ type: 'text', value: 'hello there' }]);
  });

  it('detects a single URL', () => {
    expect(splitLinks('https://example.com/path?q=1')).toEqual([
      { type: 'url', value: 'https://example.com/path?q=1' },
    ]);
  });

  it('keeps text before and after an embedded URL', () => {
    expect(splitLinks('look at https://example.com now')).toEqual([
      { type: 'text', value: 'look at ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('does not include trailing punctuation in the URL', () => {
    expect(splitLinks('see https://example.com, then')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ', then' },
    ]);
  });

  it('detects multiple URLs', () => {
    expect(splitLinks('https://a.example https://b.example')).toEqual([
      { type: 'url', value: 'https://a.example' },
      { type: 'text', value: ' ' },
      { type: 'url', value: 'https://b.example' },
    ]);
  });

  it('does not treat a malformed URL as a link', () => {
    expect(splitLinks('https://')).toEqual([{ type: 'text', value: 'https://' }]);
  });
});

describe('getSingleHttpUrl', () => {
  it('returns the URL when the body is only a URL', () => {
    expect(getSingleHttpUrl('https://example.com/file.png')).toBe('https://example.com/file.png');
  });

  it('returns null when text is next to the URL', () => {
    expect(getSingleHttpUrl('https://example.com hello')).toBeNull();
    expect(getSingleHttpUrl('hello https://example.com')).toBeNull();
  });

  it('returns null when the body is not a URL', () => {
    expect(getSingleHttpUrl('hello')).toBeNull();
  });
});
