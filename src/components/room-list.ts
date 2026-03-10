import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';
import { hapticLight } from '@/utils/haptics';
import './skeleton-loader';

interface RoomInfo {
  jid: string;
  name: string;
  numUnread: number;
  topic: string;
}

@customElement('room-list')
export class RoomList extends LitElement {
  @state() private rooms: RoomInfo[] = [];
  @state() private showJoinDialog = false;
  @state() private joinRoomJid = '';
  @state() private joinNick = '';
  @state() private loading = true;
  @property({ type: String }) selectedJid = '';

  private cleanups: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    this.initRooms();
  }

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('selectedJid') && !this.loading) {
      this.loadRooms();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  private async initRooms() {
    const api = getApi();
    if (!api) return;

    await api.waitUntil('roomsAutoJoined').catch(() => {});
    this.loadRooms();
    this.loading = false;

    const events = ['chatRoomInitialized', 'leaveRoom', 'chatBoxClosed'];
    for (const evt of events) {
      const handler = () => setTimeout(() => this.loadRooms(), 200);
      api.listen.on(evt, handler);
      this.cleanups.push(() => api.listen.not(evt, handler));
    }

    const msgHandler = () => setTimeout(() => this.loadRooms(), 200);
    api.listen.on('message', msgHandler);
    this.cleanups.push(() => api.listen.not('message', msgHandler));
  }

  private async loadRooms() {
    const api = getApi();
    if (!api) return;

    try {
      const allRooms = await api.rooms.get();
      if (!allRooms) {
        this.rooms = [];
        return;
      }

      const list = Array.isArray(allRooms) ? allRooms : [allRooms];
      this.rooms = list.map((r: any) => ({
        jid: r.get('jid'),
        name: r.get('name') || r.get('jid').split('@')[0],
        numUnread: r.get('num_unread') || 0,
        topic: r.get('subject')?.text || '',
      }));
    } catch {
      // Rooms not ready yet
    }
  }

  private selectRoom(jid: string) {
    hapticLight();
    this.dispatchEvent(
      new CustomEvent('room-selected', { detail: { jid }, bubbles: true, composed: true }),
    );
  }

  private handleRoomKeyDown(e: KeyboardEvent, jid: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectRoom(jid);
    }
  }

  private openJoinDialog() {
    this.showJoinDialog = true;
    const api = getApi();
    const userJid = api?.user?.jid?.() || '';
    this.joinNick = userJid.split('@')[0] || '';
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
        this.loadRooms();
        this.selectRoom(jid);
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
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem 0.375rem;
    }

    .section-title {
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-sidebar-muted);
    }

    .add-btn {
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #94a3b8;
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0.1875rem 0.5rem;
      border-radius: 0.25rem;
      transition: all var(--duration-fast);
    }

    .add-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: white;
    }

    .add-btn:active {
      transform: scale(0.95);
    }

    .list {
      flex: 1;
      overflow-y: auto;
      padding: 0 0.5rem;
    }

    .room {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      cursor: pointer;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .room:hover {
      background: var(--color-bg-hover);
    }

    .room:active {
      transform: scale(0.98);
    }

    .room.selected {
      background: var(--color-bg-selected);
    }

    .room-icon {
      width: 2rem;
      height: 2rem;
      border-radius: 0.375rem;
      background: var(--color-room-icon-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: var(--color-room-icon-text);
      flex-shrink: 0;
      font-weight: 600;
    }

    .room-info {
      flex: 1;
      min-width: 0;
    }

    .room-name {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-sidebar);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .room-topic {
      font-size: 0.6875rem;
      color: var(--color-text-sidebar-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      background: var(--color-badge);
      color: var(--color-badge-text);
      font-size: 0.6875rem;
      font-weight: 600;
      min-width: 1.125rem;
      height: 1.125rem;
      border-radius: 0.5625rem;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0.3rem;
      flex-shrink: 0;
    }

    .empty-state {
      text-align: center;
      padding: 1.25rem 1rem;
      color: var(--color-text-sidebar-muted);
    }

    .empty-state svg {
      margin-bottom: 0.5rem;
      opacity: 0.4;
    }

    .empty-state p {
      margin: 0;
      font-size: 0.75rem;
      line-height: 1.4;
    }

    .empty-state .action {
      display: inline-block;
      margin-top: 0.5rem;
      color: var(--color-room-icon-text);
      cursor: pointer;
      font-size: 0.75rem;
    }

    .empty-state .action:hover { text-decoration: underline; }

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

  render() {
    return html`
      <div class="section-header">
        <span class="section-title">Rooms</span>
        <button class="add-btn" @click=${this.openJoinDialog} aria-label="Join a room">+ Join</button>
      </div>
      <div class="list" role="listbox" aria-label="Rooms">
        ${this.loading
          ? html`<skeleton-loader rows="2" variant="room"></skeleton-loader>`
          : this.rooms.length === 0
            ? html`<div class="empty-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <line x1="9" y1="10" x2="15" y2="10"/>
                </svg>
                <p>No rooms joined</p>
                <span class="action" @click=${this.openJoinDialog}>Join a room</span>
              </div>`
            : repeat(
                this.rooms,
                (r) => r.jid,
                (r) => html`
                  <div
                    class="room ${this.selectedJid === r.jid ? 'selected' : ''}"
                    @click=${() => this.selectRoom(r.jid)}
                    @keydown=${(e: KeyboardEvent) => this.handleRoomKeyDown(e, r.jid)}
                    title=${r.jid}
                    role="option"
                    tabindex="0"
                    aria-selected=${this.selectedJid === r.jid}
                  >
                    <div class="room-icon">#</div>
                    <div class="room-info">
                      <div class="room-name">${r.name}</div>
                      ${r.topic ? html`<div class="room-topic">${r.topic}</div>` : nothing}
                    </div>
                    ${r.numUnread > 0 ? html`<span class="badge">${r.numUnread}</span>` : nothing}
                  </div>
                `,
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
