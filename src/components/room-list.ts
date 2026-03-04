import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';

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
  @property({ type: String }) selectedJid = '';

  private cleanups: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    this.initRooms();
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

    const events = ['chatRoomInitialized', 'leaveRoom', 'chatBoxClosed'];
    for (const evt of events) {
      const handler = () => setTimeout(() => this.loadRooms(), 200);
      api.listen.on(evt, handler);
      this.cleanups.push(() => api.listen.not(evt, handler));
    }

    // Refresh on new messages for unread counts
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
    this.dispatchEvent(
      new CustomEvent('room-selected', { detail: { jid }, bubbles: true, composed: true }),
    );
  }

  private openJoinDialog() {
    this.showJoinDialog = true;
    // Pre-fill nickname from current JID
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
      color: #64748b;
    }

    .add-btn {
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #94a3b8;
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0.1875rem 0.5rem;
      border-radius: 0.25rem;
      transition: all 0.12s;
    }

    .add-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: white;
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
      transition: background 0.12s;
    }

    .room:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .room.selected {
      background: rgba(255, 255, 255, 0.1);
    }

    .room-icon {
      width: 2rem;
      height: 2rem;
      border-radius: 0.375rem;
      background: #1e3a5f;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      color: #60a5fa;
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
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .room-topic {
      font-size: 0.6875rem;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .badge {
      background: #3b82f6;
      color: white;
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

    .empty {
      text-align: center;
      padding: 1rem;
      color: #64748b;
      font-size: 0.75rem;
    }

    /* Join dialog */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 1rem;
    }

    .dialog {
      background: white;
      border-radius: 0.75rem;
      padding: 1.5rem;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    }

    .dialog h3 {
      margin: 0 0 1rem;
      font-size: 1rem;
      font-weight: 600;
      color: #0f172a;
    }

    .dialog label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: #334155;
      margin-bottom: 0.25rem;
    }

    .dialog input {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.375rem;
      font-size: 0.875rem;
      color: #0f172a;
      outline: none;
      box-sizing: border-box;
      margin-bottom: 0.75rem;
    }

    .dialog input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
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
    }

    .btn-cancel {
      background: #f1f5f9;
      color: #475569;
    }

    .btn-cancel:hover {
      background: #e2e8f0;
    }

    .btn-join {
      background: #2563eb;
      color: white;
    }

    .btn-join:hover {
      background: #1d4ed8;
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
        <button class="add-btn" @click=${this.openJoinDialog}>+ Join</button>
      </div>
      <div class="list">
        ${this.rooms.length === 0
          ? html`<div class="empty">No rooms joined</div>`
          : repeat(
              this.rooms,
              (r) => r.jid,
              (r) => html`
                <div
                  class="room ${this.selectedJid === r.jid ? 'selected' : ''}"
                  @click=${() => this.selectRoom(r.jid)}
                  title=${r.jid}
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
            <div class="dialog-overlay" @click=${this.closeJoinDialog}>
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
