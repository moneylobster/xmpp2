import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';

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

    // Listen for roster and presence changes
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

    // Listen for message events to update unread counts
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
          // Online first, then alphabetical
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
    this.dispatchEvent(
      new CustomEvent('contact-selected', { detail: { jid }, bubbles: true, composed: true }),
    );
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
      background: rgba(255, 255, 255, 0.08);
      color: white;
      font-size: 0.8125rem;
      outline: none;
      box-sizing: border-box;
    }

    .search-box input::placeholder {
      color: #64748b;
    }

    .search-box input:focus {
      background: rgba(255, 255, 255, 0.12);
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
      transition: background 0.12s;
    }

    .contact:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .contact.selected {
      background: rgba(255, 255, 255, 0.1);
    }

    .avatar {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: #334155;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: #94a3b8;
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
      border: 2px solid #0f172a;
    }

    .info {
      flex: 1;
      min-width: 0;
    }

    .name {
      font-size: 0.875rem;
      font-weight: 500;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-text {
      font-size: 0.75rem;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.125rem;
    }

    .badge {
      background: #3b82f6;
      color: white;
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

    .empty {
      text-align: center;
      padding: 2rem 1rem;
      color: #64748b;
      font-size: 0.8125rem;
    }
  `;

  render() {
    const filtered = this.filteredContacts;

    return html`
      <div class="search-box">
        <input
          type="text"
          placeholder="Search contacts..."
          .value=${this.searchQuery}
          @input=${(e: Event) => (this.searchQuery = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="list">
        ${filtered.length === 0
          ? html`<div class="empty">
              ${this.contacts.length === 0 ? 'No contacts yet' : 'No matches found'}
            </div>`
          : repeat(
              filtered,
              (c) => c.jid,
              (c) => html`
                <div
                  class="contact ${this.selectedJid === c.jid ? 'selected' : ''}"
                  @click=${() => this.selectContact(c.jid)}
                  title="${c.jid} — ${this.presenceLabel(c)}"
                >
                  <div class="avatar">
                    ${this.initials(c.name)}
                    <span
                      class="presence-dot"
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
