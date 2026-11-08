/** Local-only per-chat preferences: drafts, mute, pin, archive. */

const DRAFTS_KEY = 'xmpp-drafts';
const MUTED_KEY = 'xmpp-muted';
const PINNED_KEY = 'xmpp-pinned';
const ARCHIVED_KEY = 'xmpp-archived';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

let drafts: Record<string, string> | null = null;

function getDrafts(): Record<string, string> {
  if (!drafts) drafts = readJson<Record<string, string>>(DRAFTS_KEY, {});
  return drafts;
}

export function getDraft(jid: string): string {
  return getDrafts()[jid] || '';
}

export function setDraft(jid: string, text: string): void {
  const all = getDrafts();
  if (text) all[jid] = text;
  else delete all[jid];
  writeJson(DRAFTS_KEY, all);
}

export function clearDraft(jid: string): void {
  setDraft(jid, '');
}

function loadSet(key: string): Set<string> {
  return new Set(readJson<string[]>(key, []));
}

function saveSet(key: string, set: Set<string>): void {
  writeJson(key, [...set]);
}

const muted = loadSet(MUTED_KEY);
const pinned = loadSet(PINNED_KEY);
const archived = loadSet(ARCHIVED_KEY);

export function isMuted(jid: string): boolean {
  return muted.has(jid);
}

export function setMuted(jid: string, value: boolean): void {
  if (value) muted.add(jid); else muted.delete(jid);
  saveSet(MUTED_KEY, muted);
}

export function isPinned(jid: string): boolean {
  return pinned.has(jid);
}

export function setPinned(jid: string, value: boolean): void {
  if (value) pinned.add(jid); else pinned.delete(jid);
  saveSet(PINNED_KEY, pinned);
}

export function isArchived(jid: string): boolean {
  return archived.has(jid);
}

export function setArchived(jid: string, value: boolean): void {
  if (value) archived.add(jid); else archived.delete(jid);
  saveSet(ARCHIVED_KEY, archived);
}
