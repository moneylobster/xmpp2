/** Shared utilities for chat-view and muc-view */

/** Get the display body from a converse.js message model, preferring decrypted plaintext. */
export function getMessageBody(m: unknown): string {
  if (!m || typeof m !== 'object' || !('get' in m) || typeof m.get !== 'function') return '';
  const plaintext = m.get('plaintext');
  if (typeof plaintext === 'string' && plaintext) return plaintext;
  const body = m.get('body');
  return typeof body === 'string' ? body : '';
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
