import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';
import { hapticLight } from '@/utils/haptics';
import './skeleton-loader';

interface ContactInfo {
  jid: string;
  name: string;
  presence: string;
  show: string | null;
  status: string;
  numUnread: number;
  subscription: string;
}

@customElement('contact-list')
export class ContactList extends LitElement {
  @state() private contacts: ContactInfo[] = [];
  @state() private searchQuery = '';
  @state() private loading = true;
  @property({ type: String }) selectedJid = '';

  private cleanups: Array<() => void> = [];

  connectedCallback() {
    super.connectedCallback();
    this.initRoster();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  private async initRoster() {
    const api = getApi();
    if (!api) return;

    await api.waitUntil('rosterContactsFetched');
    this.loadContacts();
    this.loading = false;

    const events = [
      'rosterContactsFetched',
      'rosterPush',
      'contactPresenceChanged',
      'chatBoxInitialized',
    ];
    for (const evt of events) {
      const handler = () => this.loadContacts();
      api.listen.on(evt, handler);
      this.cleanups.push(() => api.listen.not(evt, handler));
    }

    const msgHandler = () => setTimeout(() => this.loadContacts(), 100);
    api.listen.on('message', msgHandler);
    this.cleanups.push(() => api.listen.not('message', msgHandler));
  }

  private async loadContacts() {
    const api = getApi();
    if (!api) return;

    try {
      const rosterContacts = await api.contacts.get();
      if (!rosterContacts) {
        this.contacts = [];
        return;
      }

      const list = Array.isArray(rosterContacts) ? rosterContacts : [rosterContacts];
      this.contacts = list
        .filter((c: any) => {
          const sub = c.get('subscription');
          return sub === 'both' || sub === 'to' || sub === 'from';
        })
        .map((c: any) => ({
          jid: c.get('jid'),
          name: c.getDisplayName() || c.get('jid'),
          presence: c.get('presence') || 'offline',
          show: c.get('show') || null,
          status: c.get('status') || '',
          numUnread: c.get('num_unread') || 0,
          subscription: c.get('subscription') || 'none',
        }))
        .sort((a: ContactInfo, b: ContactInfo) => {
          const aOnline = a.presence === 'online' ? 0 : 1;
          const bOnline = b.presence === 'online' ? 0 : 1;
          if (aOnline !== bOnline) return aOnline - bOnline;
          return a.name.localeCompare(b.name);
        });
    } catch {
      // Roster not ready yet
    }
  }

  private get filteredContacts() {
    if (!this.searchQuery) return this.contacts;
    const q = this.searchQuery.toLowerCase();
    return this.contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q),
    );
  }

  private selectContact(jid: string) {
    hapticLight();
    this.dispatchEvent(
      new CustomEvent('contact-selected', { detail: { jid }, bubbles: true, composed: true }),
    );
  }

  private handleKeyDown(e: KeyboardEvent, jid: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectContact(jid);
    }
  }

  private presenceColor(contact: ContactInfo): string {
    if (contact.presence !== 'online') return '#94a3b8';
    switch (contact.show) {
      case 'away':
      case 'xa':
        return '#f59e0b';
      case 'dnd':
        return '#ef4444';
      default:
        return '#22c55e';
    }
  }

  private presenceLabel(contact: ContactInfo): string {
    if (contact.presence !== 'online') return 'Offline';
    switch (contact.show) {
      case 'away':
        return 'Away';
      case 'xa':
        return 'Extended away';
      case 'dnd':
        return 'Do not disturb';
      default:
        return 'Online';
    }
  }

  private initials(name: string): string {
    return name
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .search-box {
      padding: 0.75rem;
    }

    .search-box input {
      width: 100%;
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

    .list {
      flex: 1;
      overflow-y: auto;
      padding: 0 0.5rem;
    }

    .contact {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: 0.5rem;
      cursor: pointer;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .contact:hover {
      background: var(--color-bg-hover);
    }

    .contact:active {
      transform: scale(0.98);
    }

    .contact.selected {
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
  `;

  render() {
    if (this.loading) {
      return html`
        <div class="search-box">
          <input type="text" placeholder="Search contacts..." disabled />
        </div>
        <skeleton-loader rows="4" variant="contact"></skeleton-loader>
      `;
    }

    const filtered = this.filteredContacts;

    return html`
      <div class="search-box">
        <input
          type="text"
          placeholder="Search contacts..."
          .value=${this.searchQuery}
          @input=${(e: Event) => (this.searchQuery = (e.target as HTMLInputElement).value)}
          aria-label="Search contacts"
        />
      </div>
      <div class="list" role="listbox" aria-label="Contacts">
        ${filtered.length === 0
          ? this.contacts.length === 0
            ? html`<div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
                <p class="title">No contacts yet</p>
                <p>Add a contact to get started</p>
              </div>`
            : html`<div class="empty-state"><p>No matches found</p></div>`
          : repeat(
              filtered,
              (c) => c.jid,
              (c) => html`
                <div
                  class="contact ${this.selectedJid === c.jid ? 'selected' : ''}"
                  @click=${() => this.selectContact(c.jid)}
                  @keydown=${(e: KeyboardEvent) => this.handleKeyDown(e, c.jid)}
                  title="${c.jid} — ${this.presenceLabel(c)}"
                  role="option"
                  tabindex="0"
                  aria-selected=${this.selectedJid === c.jid}
                >
                  <div class="avatar">
                    ${this.initials(c.name)}
                    <span
                      class="presence-dot ${c.presence === 'online' && !c.show ? 'online' : ''}"
                      style="background: ${this.presenceColor(c)}"
                    ></span>
                  </div>
                  <div class="info">
                    <div class="name">${c.name}</div>
                    <div class="status-text">
                      ${c.status || this.presenceLabel(c)}
                    </div>
                  </div>
                  ${c.numUnread > 0 ? html`<span class="badge">${c.numUnread}</span>` : nothing}
                </div>
              `,
            )}
      </div>
    `;
  }
}
