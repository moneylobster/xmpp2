/** Shared utilities for chat-view and muc-view */

/** Get the display body from a converse.js message model, preferring decrypted plaintext. */
export function getMessageBody(m: unknown): string {
  if (!m || typeof m !== 'object' || !('get' in m) || typeof m.get !== 'function') return '';
  const plaintext = m.get('plaintext');
  if (typeof plaintext === 'string' && plaintext) return plaintext;
  const body = m.get('body');
  return typeof body === 'string' ? body : '';
}

export interface TextSegment {
  type: 'text' | 'url';
  value: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function trimUrlEnd(url: string): string {
  let end = url.length;
  while (end > 0 && /[.,!?;:)\]}]/.test(url[end - 1])) end--;
  return url.slice(0, end);
}

/**
 * Split a message body into plain-text and http(s) URL segments.
 * This keeps a URL embedded in text as a link without swallowing the surrounding text.
 */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text))) {
    const url = trimUrlEnd(match[0]);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'url', value: url });
    // Leave trailing punctuation (and anything after it) in the next text segment.
    lastIndex = match.index + url.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

/** Return the URL only when the whole body is exactly one http(s) URL. */
export function getSingleHttpUrl(text: string): string | null {
  const segments = splitLinks(text);
  return segments.length === 1 && segments[0].type === 'url' ? segments[0].value : null;
}

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso: string): string {
  const date = parseDate(iso);
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

export function dateKey(iso: string): string {
  const date = parseDate(iso);
  return date
    ? date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
}

export function formatDateLabel(key: string): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const fmt = { year: 'numeric' as const, month: 'long' as const, day: 'numeric' as const };
  const todayKey = today.toLocaleDateString([], fmt);
  const yesterdayKey = yesterday.toLocaleDateString([], fmt);
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  return key;
}

interface OmemoModel {
  get(attr: string): unknown;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

/** Set up OMEMO state tracking on a chatbox/muc model. Returns cleanup function. */
export function trackOmemo(
  model: OmemoModel,
  onChange: (active: boolean, supported: boolean) => void,
): () => void {
  onChange(!!model.get('omemo_active'), !!model.get('omemo_supported'));
  const handler = () => {
    onChange(!!model.get('omemo_active'), !!model.get('omemo_supported'));
  };
  model.on('change:omemo_active', handler);
  model.on('change:omemo_supported', handler);
  return () => {
    model.off('change:omemo_active', handler);
    model.off('change:omemo_supported', handler);
  };
}
