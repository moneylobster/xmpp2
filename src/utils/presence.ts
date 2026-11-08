import { getApi, getConverseInternal } from '@/xmpp/client';

export type PresenceShow = 'online' | 'away' | 'xa' | 'dnd';

const KEY = 'xmpp-presence';

export function getSavedPresence(): PresenceShow {
  const value = localStorage.getItem(KEY);
  return value === 'away' || value === 'xa' || value === 'dnd' ? value : 'online';
}

export function presenceLabel(show: PresenceShow): string {
  switch (show) {
    case 'away': return 'Away';
    case 'xa': return 'Extended away';
    case 'dnd': return 'Do not disturb';
    default: return 'Online';
  }
}

export function setPresence(show: PresenceShow): void {
  localStorage.setItem(KEY, show);
  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return;

  try {
    const { $pres } = _converse.env;
    const stanza = $pres();
    if (show !== 'online') stanza.c('show').t(show).up();
    api.connection.get().send(stanza.tree());
  } catch (err) {
    console.error('Failed to set presence:', err);
  }
}
