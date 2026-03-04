import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { logout, getApi } from '@/xmpp/client';
import './contact-list';
import './chat-view';
import './room-list';
import './muc-view';

type ChatSelection = { type: 'chat' | 'room'; jid: string } | null;

@customElement('app-shell')
export class AppShell extends LitElement {
  @state() private userJid = '';
  @state() private selection: ChatSelection = null;
  @state() private mobileShowChat = false;

  connectedCallback() {
    super.connectedCallback();
    const api = getApi();
    this.userJid = api?.user?.jid?.() || '';
  }

  private handleContactSelected(e: CustomEvent) {
    this.selection = { type: 'chat', jid: e.detail.jid };
    this.mobileShowChat = true;
  }

  private handleRoomSelected(e: CustomEvent) {
    this.selection = { type: 'room', jid: e.detail.jid };
    this.mobileShowChat = true;
  }

  private handleBack() {
    this.mobileShowChat = false;
  }

  private async handleLogout() {
    await logout();
  }

  static styles = css`
    :host {
      display: flex;
      height: 100%;
    }

    .sidebar {
      width: 320px;
      background: #0f172a;
      color: white;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-header h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
    }

    .user-info {
      padding: 0.625rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .user-jid {
      font-size: 0.75rem;
      color: #94a3b8;
      margin: 0;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.6875rem;
      color: #4ade80;
    }

    .status-dot {
      width: 0.4375rem;
      height: 0.4375rem;
      background: #4ade80;
      border-radius: 50%;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .contacts-section {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .rooms-section {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      max-height: 40%;
      display: flex;
      flex-direction: column;
    }

    .logout-btn {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      transition: background 0.12s, color 0.12s;
    }

    .logout-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: white;
    }

    .main {
      flex: 1;
      display: flex;
      min-width: 0;
    }

    .main-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      background: #f8fafc;
    }

    .main-placeholder-inner {
      text-align: center;
      color: #94a3b8;
    }

    .main-placeholder-inner h3 {
      margin: 0 0 0.375rem;
      font-size: 1rem;
      font-weight: 500;
      color: #64748b;
    }

    .main-placeholder-inner p {
      margin: 0;
      font-size: 0.8125rem;
    }

    @media (max-width: 768px) {
      .sidebar { width: 100%; }
      .sidebar.hidden-mobile { display: none; }
      .main { display: none; }
      .main.show-mobile {
        display: flex;
        position: fixed;
        inset: 0;
        z-index: 10;
      }
    }
  `;

  private renderMainContent() {
    if (!this.selection) {
      return html`
        <div class="main-placeholder">
          <div class="main-placeholder-inner">
            <h3>Welcome to XMPP Chat</h3>
            <p>Select a conversation or room to start messaging</p>
          </div>
        </div>
      `;
    }

    if (this.selection.type === 'room') {
      return html`<muc-view .jid=${this.selection.jid} @back=${this.handleBack} style="flex:1"></muc-view>`;
    }

    return html`<chat-view .jid=${this.selection.jid} @back=${this.handleBack} style="flex:1"></chat-view>`;
  }

  render() {
    return html`
      <aside class="sidebar ${this.mobileShowChat ? 'hidden-mobile' : ''}">
        <div class="sidebar-header">
          <h2>XMPP Chat</h2>
          <button class="logout-btn" @click=${this.handleLogout}>Sign out</button>
        </div>
        <div class="user-info">
          <p class="user-jid">${this.userJid}</p>
          <span class="status-badge">
            <span class="status-dot"></span>
            Online
          </span>
        </div>
        <div class="sidebar-content">
          <div class="contacts-section">
            <contact-list
              .selectedJid=${this.selection?.type === 'chat' ? this.selection.jid : ''}
              @contact-selected=${this.handleContactSelected}
            ></contact-list>
          </div>
          <div class="rooms-section">
            <room-list
              .selectedJid=${this.selection?.type === 'room' ? this.selection.jid : ''}
              @room-selected=${this.handleRoomSelected}
            ></room-list>
          </div>
        </div>
      </aside>

      <div class="main ${this.mobileShowChat ? 'show-mobile' : ''}">
        ${this.renderMainContent()}
      </div>
    `;
  }
}
