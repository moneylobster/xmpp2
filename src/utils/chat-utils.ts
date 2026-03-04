/** Shared utilities for chat-view and muc-view */

/** Get the display body from a converse.js message model, preferring decrypted plaintext. */
export function getMessageBody(m: any): string {
  return m.get('plaintext') || m.get('body') || '';
}

export function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function dateKey(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString([], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
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

/** Set up OMEMO state tracking on a chatbox/muc model. Returns cleanup function. */
export function trackOmemo(
  model: any,
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
