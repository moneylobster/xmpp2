import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getApi } from '@/xmpp/client';
import { events, CONNECTION_STATUS_CHANGED } from '@/xmpp/events';
import { shouldCountUnread, incrementUnread, getUnreadCount, clearUnread } from '@/utils/unread';
import { toast } from './notification-toast';
import type { ConnectionStatus } from '@/types';
import './chat-list';
import './chat-view';
import './muc-view';
import './settings-view';
import './notification-toast';

type ChatSelection = { type: 'chat' | 'room'; jid: string } | null;
type ViewMode = 'chat' | 'settings';

const SOUND_KEY = 'xmpp-notification-sound';
const notificationSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1mZWFsc4aCe3Bka2RjaHWDi4V7cWdlY2V0goiDeXBnZGRndIKIg3pvZ2RlZ3SCiIN5b2dkZWh2goiCeG5mZGVpdoKIgndtZmRlaneDiIF2bGZkZmt4g4eBdWtlZGdseYOHgHRqZWRocHuDhn5zamVkaHF8g4Z+cmllZGhyfIOFfHFoZWVpdXyDhHtvZ2VlanlDhHtvaGVlanl+g4R7b2hlZWp5foOEe29oZWVqeX6DhA==');

@customElement('app-shell')
export class AppShell extends LitElement {
  @state() private userJid = '';
  @state() private selection: ChatSelection = null;
  @state() private mobileShowChat = false;
  @state() private viewMode: ViewMode = 'chat';
  @state() private totalUnread = 0;

  private cleanups: Array<() => void> = [];
  private originalTitle = document.title;
  private unreadInitialized = false;

  connectedCallback() {
    super.connectedCallback();
    const api = getApi();
    const fullJid = api?.user?.jid?.() || '';
    this.userJid = fullJid.split('/')[0];
    if (fullJid.includes('/')) console.info('[XMPP] full JID', fullJid);

    // Connection status toasts
    this.cleanups.push(
      events.on(CONNECTION_STATUS_CHANGED, (s: ConnectionStatus) => {
        if (s === 'connected') toast.success('Connected');
        else if (s === 'disconnected') toast.warning('Disconnected');
        else if (s === 'connfail') toast.error('Connection failed');
        else if (s === 'authfail') toast.error('Authentication failed');
      })
    );

    // Android back button: navigate back from chat/settings to contact list
    const backHandler = () => {
      if (this.mobileShowChat || this.viewMode === 'settings') {
        this.handleBack();
      }
    };
    window.addEventListener('app-back-button', backHandler);
    this.cleanups.push(() => window.removeEventListener('app-back-button', backHandler));

    // Track unread messages for tab badge + sound
    if (api) {
      const msgHandler = (data: unknown) => this.handleIncomingMessage(data);
      api.listen.on('message', msgHandler);
      this.cleanups.push(() => api.listen.not('message', msgHandler));
    }
  }

  /**
   * Handle a live incoming message from Converse's global `message` event.
   * Converse skips counting (num_unread) while the app is foregrounded and the
   * chat isn't open, so we count it ourselves for that case (see utils/unread).
   * Then recompute totals, which plays the sound + updates the tab badge, and
   * which also picks up Converse's own count when the document was hidden.
   */
  private handleIncomingMessage(data: unknown) {
    try {
      const { chatbox, attrs } = data as {
        chatbox?: { get(attr: string): unknown; ui?: { get(attr: string): unknown } };
        attrs?: Parameters<typeof shouldCountUnread>[0];
      };
      const chatJid = chatbox?.get?.('jid');
      // On mobile the chat panel is hidden while the sidebar/settings is shown,
      // so a retained selection is not actually being read.
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const activeJid =
        this.viewMode === 'chat' && (!isMobile || this.mobileShowChat)
          ? this.selection?.jid ?? null
          : null;
      // Converse counts messages itself when the chatbox is hidden/scrolled, or
      // when the document is hidden. Only count the cases it skips.
      const converseHidden = !!chatbox?.get?.('hidden') || !!chatbox?.ui?.get?.('scrolled');
      if (chatbox && typeof chatJid === 'string' &&
          shouldCountUnread(attrs, chatJid, activeJid, document.hidden, converseHidden)) {
        incrementUnread(chatbox, attrs);
      }
    } catch { /* ignore */ }
    setTimeout(() => this.updateUnreadCount(), 200);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    document.title = this.originalTitle;
  }

  private async updateUnreadCount() {
    const api = getApi();
    if (!api) return;

    let total = 0;
    try {
      // `api.chats.get()` returns every chatbox, including MUCs. Do not also add
      // `api.rooms.get()`: that is the same set filtered to groupchats and would
      // double-count every room.
      const chats = await api.chats.get();
      const chatList = Array.isArray(chats) ? chats : chats ? [chats] : [];
      for (const c of chatList) total += getUnreadCount(c);
    } catch { /* ignore */ }

    const prev = this.totalUnread;
    this.totalUnread = total;

    // Tab title badge
    document.title = total > 0
      ? `(${total}) ${this.originalTitle}`
      : this.originalTitle;

    // Play sound on new unread, but not for counts restored on the first load.
    if (this.unreadInitialized && total > prev && localStorage.getItem(SOUND_KEY) !== 'false') {
      notificationSound.play().catch(() => {});
    }
    this.unreadInitialized = true;
  }

  private async handleChatSelected(e: CustomEvent) {
    const { type, jid } = e.detail as { type: 'chat' | 'room'; jid: string };
    this.selection = { type, jid };
    this.mobileShowChat = true;
    this.viewMode = 'chat';
    // Clear unread immediately (covers the race before the chat view mounts), then refresh totals.
    await this.clearUnreadFor(jid);
    await this.updateUnreadCount();
  }

  /** Zero the unread counters for a chat/room so its badge clears on open. */
  private async clearUnreadFor(jid: string) {
    const api = getApi();
    if (!api) return;
    try {
      await clearUnread(await api.chats.get(jid));
    } catch { /* ignore */ }
  }

  private handleBack() {
    if (this.viewMode === 'settings') {
      this.viewMode = 'chat';
    }
    this.mobileShowChat = false;
    // Refresh unread counts after leaving a chat (counts were cleared while viewing)
    this.updateUnreadCount();
  }

  static styles = css`
    :host {
      display: flex;
      height: 100%;
    }

    .sidebar {
      width: 320px;
      background: var(--color-bg-sidebar, #0f172a);
      color: white;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--color-border-sidebar);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .sidebar-header h2 {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .icon-btn {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 1rem;
      padding: 0.25rem 0.375rem;
      border-radius: 0.25rem;
      transition: background var(--duration-fast), color var(--duration-fast);
      line-height: 1;
    }

    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: white;
    }

    .user-info {
      padding: 0.625rem 1.25rem;
      border-bottom: 1px solid var(--color-border-sidebar);
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
      animation: pulse-online 2s ease-in-out infinite;
    }

    @keyframes pulse-online {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4); }
      50% { opacity: 0.8; box-shadow: 0 0 0 4px rgba(74, 222, 128, 0); }
    }

    .sidebar-content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
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
      background: var(--color-bg, #f8fafc);
    }

    .main-placeholder-inner {
      text-align: center;
      color: var(--color-text-muted, #94a3b8);
    }

    .main-placeholder-inner .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .main-placeholder-inner h3 {
      margin: 0 0 0.375rem;
      font-size: 1rem;
      font-weight: 500;
      color: var(--color-text-secondary, #64748b);
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
        /* html already pads top/bottom by the safe-area insets, so this fixed
           panel must align to that padded box (0/0), not re-offset by the inset. */
        position: fixed;
        top: var(--safe-top, 0px);
        left: 0;
        right: 0;
        bottom: var(--safe-bottom, 0px);
        z-index: 10;
        animation: slideInRight 0.2s ease-out;
      }
    }

    @keyframes slideInRight {
      from { transform: translateX(30%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;

  private renderMainContent() {
    if (this.viewMode === 'settings') {
      return html`<settings-view @back=${this.handleBack} style="flex:1"></settings-view>`;
    }

    if (!this.selection) {
      return html`
        <div class="main-placeholder">
          <div class="main-placeholder-inner">
            <div class="icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
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
      <aside class="sidebar ${this.mobileShowChat ? 'hidden-mobile' : ''}" role="navigation" aria-label="Sidebar">
        <div class="sidebar-header">
          <h2>XMPP Chat</h2>
          <div class="header-actions">
            <button class="icon-btn" @click=${() => { this.viewMode = 'settings'; this.mobileShowChat = true; }} title="Settings" aria-label="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>
        <div class="user-info">
          <p class="user-jid">${this.userJid}</p>
          <span class="status-badge">
            <span class="status-dot"></span>
            Online
          </span>
        </div>
        <div class="sidebar-content">
          <chat-list
            .selectedJid=${this.selection?.jid ?? ''}
            @chat-selected=${this.handleChatSelected}
          ></chat-list>
        </div>
      </aside>

      <div class="main ${this.mobileShowChat ? 'show-mobile' : ''}" role="main">
        ${this.renderMainContent()}
      </div>

      <notification-toast></notification-toast>
    `;
  }
}
