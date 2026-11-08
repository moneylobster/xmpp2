import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi, getConverseInternal } from '@/xmpp/client';
import { getMessageBody } from '@/utils/chat-utils';
import { getUnreadCount, type ChatboxLike } from '@/utils/unread';
import './skeleton-loader';

type ChatKind = 'contact' | 'room';

interface ChatInfo {
  kind: ChatKind;
  jid: string;
  name: string;
  presence: string;
  status: string;
  numUnread: number;
  subscription: string;
  lastMessage: string;
  searchText: string;
  topic: string;
}

interface RosterContactLike extends ChatboxLike {
  getDisplayName?(): string;
  getStatus?(): string;
  presence?: { getStatus?(): string };
}

interface ChatModel extends ChatboxLike {
  messages?: {
    last?(): unknown;
    models?: unknown[];
  };
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return value ? [value as T] : [];
}

/** All message bodies for a chat, used by the unified search. */
function getMessagesText(chat: ChatModel): string {
  const models = chat.messages?.models;
  if (!Array.isArray(models)) return '';
  return models.map((m) => getMessageBody(m)).filter(Boolean).join(' ');
}

function getLastMessage(chat: ChatModel): string {
  const last = chat.messages?.last?.();
  if (!last) return '';
  const body = getMessageBody(last);
  if (!body) return '';
  const sender = (last as ChatboxLike).get('sender') === 'me' ? 'You: ' : '';
  return sender + body;
}

@customElement('chat-list')
export class ChatList extends LitElement {
  @state() private chats: ChatInfo[] = [];
  @state() private searchQuery = '';
  @state() private showJoinDialog = false;
  @state() private joinRoomJid = '';
  @state() private joinNick = '';
  @state() private loading = true;
  @property({ type: String }) selectedJid = '';

  private cleanups: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    this.initChats();
  }

  willUpdate(changed: Map<string, unknown>) {
    // Refresh when selection changes (e.g. navigating back from a chat clears unread).
    if (changed.has('selectedJid') && !this.loading) {
      this.loadChats();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  private async initChats() {
    const api = getApi();
    if (!api) return;

    await Promise.all([
      api.waitUntil('rosterContactsFetched').catch(() => {}),
      api.waitUntil('roomsAutoJoined').catch(() => {}),
    ]);
    await this.loadChats();
    this.loading = false;

    const events = [
      'rosterContactsFetched',
      'rosterPush',
      'contactPresenceChanged',
      'chatBoxInitialized',
      'chatRoomInitialized',
      'leaveRoom',
      'chatBoxClosed',
    ];
    for (const evt of events) {
      const handler = () => setTimeout(() => this.loadChats(), 100);
      api.listen.on(evt, handler);
      this.cleanups.push(() => api.listen.not(evt, handler));
    }

    const msgHandler = () => setTimeout(() => this.loadChats(), 150);
    api.listen.on('message', msgHandler);
    this.cleanups.push(() => api.listen.not('message', msgHandler));

    // Clearing a badge (or a read marker arriving from another device) changes the
    // model without emitting a `message` event. Reload on those changes too.
    const chatboxes = getConverseInternal()?.state?.chatboxes;
    if (chatboxes?.on) {
      const unreadHandler = () => this.loadChats();
      const unreadEvents = 'change:num_unread change:num_unread_general change:has_activity';
      chatboxes.on(unreadEvents, unreadHandler);
      this.cleanups.push(() => chatboxes.off(unreadEvents, unreadHandler));
    }
  }

  private async loadChats() {
    const api = getApi();
    if (!api) return;

    try {
      const [rosterContacts, allRooms, allChats] = await Promise.all([
        api.contacts.get(),
        api.rooms.get().catch(() => []),
        api.chats.get().catch(() => []),
      ]);

      const unreadByJid = new Map<string, number>();
      const lastByJid = new Map<string, string>();
      const textByJid = new Map<string, string>();

      for (const chat of toArray<ChatModel>(allChats)) {
        const jid = String(chat.get('jid') || '');
        if (!jid) continue;
        unreadByJid.set(jid, getUnreadCount(chat));
        const lastMessage = getLastMessage(chat);
        if (lastMessage) lastByJid.set(jid, lastMessage);
        const messagesText = getMessagesText(chat);
        if (messagesText) textByJid.set(jid, messagesText);
      }

      const contacts: ChatInfo[] = toArray<RosterContactLike>(rosterContacts)
        .filter((c) => {
          const sub = c.get('subscription');
          return sub === 'both' || sub === 'to' || sub === 'from';
        })
        .map((c) => {
          const jid = String(c.get('jid') || '');
          const name = c.getDisplayName?.() || jid;
          const presence = c.getStatus?.() || c.presence?.getStatus?.() || 'offline';
          const status = String(c.get('status') || '');
          const lastMessage = lastByJid.get(jid) || '';
          return {
            kind: 'contact' as const,
            jid,
            name,
            presence,
            status,
            numUnread: unreadByJid.get(jid) || 0,
            subscription: String(c.get('subscription') || 'none'),
            lastMessage,
            searchText: [name, jid, status, lastMessage, textByJid.get(jid)]
              .join(' ')
              .toLowerCase(),
            topic: '',
          };
        });

      const rooms: ChatInfo[] = toArray<ChatboxLike>(allRooms).map((r) => {
        const jid = String(r.get('jid') || '');
        const subject = r.get('subject');
        const topic =
          subject && typeof subject === 'object' && 'text' in subject && typeof subject.text === 'string'
            ? subject.text
            : '';
        const name = String(r.get('name') || jid.split('@')[0]);
        const lastMessage = lastByJid.get(jid) || '';
        return {
          kind: 'room' as const,
          jid,
          name,
          presence: 'room',
          status: '',
          numUnread: unreadByJid.get(jid) ?? getUnreadCount(r),
          subscription: '',
          lastMessage,
          searchText: [name, jid, topic, lastMessage, textByJid.get(jid)]
            .join(' ')
            .toLowerCase(),
          topic,
        };
      });

      this.chats = [...contacts, ...rooms].sort((a, b) => {
        const aOnline = a.kind === 'contact' && a.presence !== 'offline' ? 0 : 1;
        const bOnline = b.kind === 'contact' && b.presence !== 'offline' ? 0 : 1;
        if (aOnline !== bOnline) return aOnline - bOnline;
        return a.name.localeCompare(b.name);
      });
    } catch {
      // Roster/rooms not ready yet.
    }
  }

  private get filteredChats() {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.chats;
    return this.chats.filter((chat) => chat.searchText.includes(q));
  }

  private selectChat(chat: ChatInfo) {
    this.selectJid(chat.jid, chat.kind);
  }

  private selectJid(jid: string, kind: ChatKind) {
    this.dispatchEvent(
      new CustomEvent('chat-selected', {
        detail: { type: kind === 'room' ? 'room' : 'chat', jid },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleKeyDown(e: KeyboardEvent, chat: ChatInfo) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectChat(chat);
    }
  }

  private presenceColor(chat: ChatInfo): string {
    switch (chat.presence) {
      case 'online':
      case 'chat':
        return '#22c55e';
      case 'away':
      case 'xa':
        return '#f59e0b';
      case 'dnd':
        return '#ef4444';
      default:
        return '#94a3b8';
    }
  }

  private presenceLabel(chat: ChatInfo): string {
    switch (chat.presence) {
      case 'online':
      case 'chat':
        return 'Online';
      case 'away':
        return 'Away';
      case 'xa':
        return 'Extended away';
      case 'dnd':
        return 'Do not disturb';
      case 'room':
        return 'Group chat';
      default:
        return 'Offline';
    }
  }

  private subtitle(chat: ChatInfo): string {
    if (chat.lastMessage) return chat.lastMessage;
    if (chat.kind === 'room') return chat.topic || 'Group chat';
    return chat.status || this.presenceLabel(chat);
  }

  private initials(name: string): string {
    return name
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }

  private openJoinDialog() {
    this.showJoinDialog = true;
    const api = getApi();
    const fullJid = api?.user?.jid?.() || '';
    this.joinNick = fullJid.split('/')[0].split('@')[0] || '';
  }

  private closeJoinDialog() {
    this.showJoinDialog = false;
    this.joinRoomJid = '';
  }

  private async joinRoom() {
    const jid = this.joinRoomJid.trim();
    const nick = this.joinNick.trim();
    if (!jid) return;

    const api = getApi();
    if (!api) return;

    try {
      await api.rooms.open(jid, { nick: nick || undefined });
      this.closeJoinDialog();
      setTimeout(() => {
        this.loadChats();
        this.selectJid(jid, 'room');
      }, 500);
    } catch (err) {
      console.error('Failed to join room:', err);
    }
  }

  private handleJoinKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.joinRoom();
    }
    if (e.key === 'Escape') {
      this.closeJoinDialog();
    }
  }

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
    }

    .search-box input {
      flex: 1;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      border: none;
      border-radius: 0.5rem;
      background: var(--color-sidebar-input);
      color: white;
      font-size: 0.8125rem;
      outline: none;
      box-sizing: border-box;
      transition: background var(--duration-fast);
    }

    .search-box input::placeholder {
      color: var(--color-text-sidebar-muted);
    }

    .search-box input:focus {
      background: var(--color-sidebar-input-focus);
    }

    .join-btn {
      width: 2rem;
      height: 2rem;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 0.5rem;
      background: none;
      color: #94a3b8;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      transition: background var(--duration-fast), color var(--duration-fast);
    }

    .join-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: white;
    }

    .list {
      flex: 1;
      overflow-y: auto;
      padding: 0 0.5rem;
    }

    .chat {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: 0.5rem;
      cursor: pointer;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .chat:hover {
      background: var(--color-bg-hover);
    }

    .chat:active {
      transform: scale(0.98);
    }

    .chat.selected {
      background: var(--color-bg-selected);
    }

    .avatar {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: var(--color-avatar-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-avatar-text);
      flex-shrink: 0;
      position: relative;
    }

    .avatar.room {
      border-radius: 0.5rem;
      background: var(--color-room-icon-bg);
      color: var(--color-room-icon-text);
      font-size: 0.875rem;
    }

    .presence-dot {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      border: 2px solid var(--color-bg-sidebar);
    }

    .presence-dot.online {
      animation: pulse-presence 2s ease-in-out infinite;
    }

    @keyframes pulse-presence {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
      50% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0); }
    }

    .info {
      flex: 1;
      min-width: 0;
    }

    .name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-sidebar);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-text {
      font-size: 0.75rem;
      color: var(--color-text-sidebar-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.125rem;
    }

    .badge {
      background: var(--color-badge);
      color: var(--color-badge-text);
      font-size: 0.6875rem;
      font-weight: 600;
      min-width: 1.25rem;
      height: 1.25rem;
      border-radius: 0.625rem;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0.375rem;
      flex-shrink: 0;
    }

    .empty-state {
      text-align: center;
      padding: 2rem 1.5rem;
      color: var(--color-text-sidebar-muted);
    }

    .empty-state svg {
      margin-bottom: 0.75rem;
      opacity: 0.4;
    }

    .empty-state p {
      margin: 0;
      font-size: 0.8125rem;
      line-height: 1.4;
    }

    .empty-state .title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-sidebar);
      margin-bottom: 0.25rem;
    }

    .empty-action {
      margin-top: 0.5rem;
      border: none;
      background: none;
      color: var(--color-room-icon-text);
      cursor: pointer;
      font-size: 0.75rem;
    }

    .empty-action:hover {
      text-decoration: underline;
    }

    /* Join dialog */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: var(--color-bg-overlay);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 1rem;
      animation: fadeIn 0.15s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .dialog {
      background: var(--color-bg-card, #fff);
      border-radius: 0.75rem;
      padding: 1.5rem;
      width: 100%;
      max-width: 360px;
      box-shadow: var(--shadow-card);
      animation: dialogIn 0.2s ease-out;
    }

    @keyframes dialogIn {
      from { transform: scale(0.95) translateY(10px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }

    .dialog h3 {
      margin: 0 0 1rem;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text, #0f172a);
    }

    .dialog label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-secondary, #334155);
      margin-bottom: 0.25rem;
    }

    .dialog input {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 0.375rem;
      font-size: 0.875rem;
      color: var(--color-text, #0f172a);
      background: var(--color-bg-input, #f8fafc);
      outline: none;
      box-sizing: border-box;
      margin-bottom: 0.75rem;
      transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
    }

    .dialog input:focus {
      border-color: var(--color-border-focus, #3b82f6);
      box-shadow: 0 0 0 2px var(--color-focus-ring);
    }

    .dialog-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
      margin-top: 0.5rem;
    }

    .dialog-actions button {
      padding: 0.4375rem 0.875rem;
      border-radius: 0.375rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .dialog-actions button:active { transform: scale(0.97); }

    .btn-cancel {
      background: var(--color-border, #f1f5f9);
      color: var(--color-text-secondary, #475569);
    }

    .btn-cancel:hover {
      background: var(--color-border, #e2e8f0);
    }

    .btn-join {
      background: var(--color-primary, #2563eb);
      color: var(--color-primary-text, white);
    }

    .btn-join:hover {
      background: var(--color-primary-hover, #1d4ed8);
    }

    .btn-join:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  private renderChat(chat: ChatInfo) {
    const selected = this.selectedJid === chat.jid;
    return html`
      <div
        class="chat ${selected ? 'selected' : ''}"
        @click=${() => this.selectChat(chat)}
        @keydown=${(e: KeyboardEvent) => this.handleKeyDown(e, chat)}
        title="${chat.jid} — ${this.presenceLabel(chat)}"
        role="option"
        tabindex="0"
        aria-selected=${selected}
      >
        ${chat.kind === 'room'
          ? html`<div class="avatar room">#</div>`
          : html`
              <div class="avatar">
                ${this.initials(chat.name)}
                <span
                  class="presence-dot ${chat.presence === 'online' || chat.presence === 'chat' ? 'online' : ''}"
                  style="background: ${this.presenceColor(chat)}"
                ></span>
              </div>
            `}
        <div class="info">
          <div class="name">${chat.name}</div>
          <div class="status-text">${this.subtitle(chat)}</div>
        </div>
        ${chat.numUnread > 0 ? html`<span class="badge">${chat.numUnread}</span>` : nothing}
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="search-box">
          <input type="text" placeholder="Search messages, people, rooms..." disabled />
        </div>
        <skeleton-loader rows="4" variant="contact"></skeleton-loader>
      `;
    }

    const filtered = this.filteredChats;

    return html`
      <div class="search-box">
        <input
          type="text"
          placeholder="Search messages, people, rooms..."
          .value=${this.searchQuery}
          @input=${(e: Event) => (this.searchQuery = (e.target as HTMLInputElement).value)}
          aria-label="Search messages, people, and rooms"
        />
        <button class="join-btn" @click=${this.openJoinDialog} title="Join a room" aria-label="Join a room">+</button>
      </div>
      <div class="list" role="listbox" aria-label="Conversations">
        ${filtered.length === 0
          ? this.chats.length === 0
            ? html`<div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p class="title">No conversations yet</p>
                <p>Join a room to get started</p>
                <button class="empty-action" @click=${this.openJoinDialog}>Join a room</button>
              </div>`
            : html`<div class="empty-state"><p>No matches found</p></div>`
          : repeat(
              filtered,
              (chat) => `${chat.kind}:${chat.jid}`,
              (chat) => this.renderChat(chat),
            )}
      </div>

      ${this.showJoinDialog
        ? html`
            <div class="dialog-overlay" @click=${this.closeJoinDialog} role="dialog" aria-modal="true" aria-label="Join room">
              <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
                <h3>Join Room</h3>
                <label for="room-jid">Room address</label>
                <input
                  id="room-jid"
                  type="text"
                  placeholder="room@conference.example.com"
                  .value=${this.joinRoomJid}
                  @input=${(e: Event) => (this.joinRoomJid = (e.target as HTMLInputElement).value)}
                  @keydown=${this.handleJoinKeyDown}
                  autofocus
                />
                <label for="room-nick">Nickname</label>
                <input
                  id="room-nick"
                  type="text"
                  placeholder="Your nickname"
                  .value=${this.joinNick}
                  @input=${(e: Event) => (this.joinNick = (e.target as HTMLInputElement).value)}
                  @keydown=${this.handleJoinKeyDown}
                />
                <div class="dialog-actions">
                  <button class="btn-cancel" @click=${this.closeJoinDialog}>Cancel</button>
                  <button
                    class="btn-join"
                    @click=${this.joinRoom}
                    ?disabled=${!this.joinRoomJid.trim()}
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
          `
        : nothing}
    `;
  }
}
