import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { toast } from './notification-toast';

export interface InfoMember {
  nick: string;
  role: string;
  affiliation: string;
  presence: string;
}

export interface InfoMediaItem {
  url: string;
  name: string;
  isImage: boolean;
}

@customElement('chat-info')
export class ChatInfo extends LitElement {
  @property({ type: String }) title = '';
  @property({ type: String }) subtitle = '';
  @property({ type: String }) jid = '';
  @property({ type: Boolean }) isGroup = false;
  @property({ type: Array }) members: InfoMember[] = [];
  @property({ type: Array }) media: InfoMediaItem[] = [];
  @property({ type: Boolean }) omemoActive = false;
  @property({ type: Boolean }) omemoSupported = false;
  @property({ type: Boolean }) canLeave = false;
  @property({ type: Boolean }) pinned = false;
  @property({ type: Boolean }) muted = false;
  @property({ type: Boolean }) archived = false;

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private toggleOmemo() {
    this.dispatchEvent(new CustomEvent('toggle-omemo', { bubbles: true, composed: true }));
  }

  private leave() {
    this.dispatchEvent(new CustomEvent('leave', { bubbles: true, composed: true }));
  }

  private togglePin() {
    this.dispatchEvent(new CustomEvent('toggle-pin', { bubbles: true, composed: true }));
  }

  private toggleMute() {
    this.dispatchEvent(new CustomEvent('toggle-mute', { bubbles: true, composed: true }));
  }

  private toggleArchive() {
    this.dispatchEvent(new CustomEvent('toggle-archive', { bubbles: true, composed: true }));
  }

  private async copyJid() {
    try {
      await navigator.clipboard.writeText(this.jid);
      toast.success('JID copied');
    } catch {
      toast.error('Could not copy JID');
    }
  }

  private initials(name: string): string {
    return name
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }

  private renderMedia(item: InfoMediaItem) {
    if (item.isImage) {
      return html`
        <a class="media-item" href=${item.url} target="_blank" rel="noopener noreferrer" title=${item.name}>
          <img src=${item.url} alt=${item.name} loading="lazy" />
        </a>
      `;
    }
    return html`
      <a class="file-item" href=${item.url} target="_blank" rel="noopener noreferrer" download=${item.name}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
        <span>${item.name}</span>
      </a>
    `;
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 200;
    }

    .overlay {
      position: absolute;
      inset: 0;
      background: var(--color-bg-overlay);
      display: flex;
      justify-content: flex-end;
    }

    .panel {
      width: min(380px, 100%);
      height: 100%;
      overflow-y: auto;
      background: var(--color-bg-card);
      color: var(--color-text);
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
      animation: slideIn 0.2s ease-out;
      box-sizing: border-box;
    }

    @keyframes slideIn {
      from { transform: translateX(24px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @media (max-width: 480px) {
      .panel { width: 100%; }
    }

    .panel-header {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.875rem 1rem;
      background: var(--color-bg-card);
      border-bottom: 1px solid var(--color-border);
    }

    .panel-header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      flex: 1;
    }

    .close-btn {
      border: none;
      background: none;
      color: var(--color-text-secondary);
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 0.25rem;
    }

    .close-btn:hover { background: var(--color-bg-input); }

    .identity {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 1.25rem 1rem;
    }

    .avatar {
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 50%;
      background: var(--color-avatar-bg-light);
      color: var(--color-avatar-text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 600;
      flex-shrink: 0;
    }

    .avatar.group {
      border-radius: 0.75rem;
      background: var(--color-room-icon-bg);
      color: var(--color-room-icon-text);
      font-size: 1.25rem;
    }

    .identity-text { min-width: 0; }

    .identity-name {
      font-size: 1rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .identity-subtitle,
    .identity-jid {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      margin-top: 0.125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
      padding: 0 1rem 1rem;
      flex-wrap: wrap;
    }

    .action {
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
      background: var(--color-bg-card);
      color: var(--color-text);
      padding: 0.5rem 0.75rem;
      font-size: 0.8125rem;
      cursor: pointer;
    }

    .action:hover { background: var(--color-bg-input); }

    .action.active {
      border-color: var(--color-success);
      background: var(--color-success-bg);
      color: var(--color-success);
    }

    .section {
      padding: 1rem;
      border-top: 1px solid var(--color-border);
    }

    .section h3 {
      margin: 0 0 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-secondary);
    }

    .muted {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }

    .media-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.375rem;
    }

    .media-item {
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 0.375rem;
      background: var(--color-bg-input);
    }

    .media-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      margin-bottom: 0.375rem;
      border-radius: 0.375rem;
      background: var(--color-bg-input);
      color: var(--color-text);
      font-size: 0.8125rem;
      text-decoration: none;
    }

    .file-item:hover { text-decoration: underline; }

    .file-item span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .member {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.375rem 0;
    }

    .member-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .member-info { min-width: 0; }

    .member-nick {
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .member-meta {
      font-size: 0.6875rem;
      color: var(--color-text-muted);
      text-transform: capitalize;
    }

    .leave-btn {
      width: 100%;
      padding: 0.625rem;
      border: 1px solid var(--color-error-border);
      border-radius: 0.5rem;
      background: var(--color-error-bg);
      color: var(--color-error);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
    }

    .leave-btn:hover { border-color: var(--color-error); }
  `;

  render() {
    return html`
      <div class="overlay" @click=${this.close}>
        <aside class="panel" @click=${(e: Event) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div class="panel-header">
            <h2>${this.isGroup ? 'Group info' : 'Contact info'}</h2>
            <button class="close-btn" @click=${this.close} aria-label="Close">&times;</button>
          </div>

          <div class="identity">
            <div class="avatar ${this.isGroup ? 'group' : ''}">
              ${this.isGroup ? '#' : this.initials(this.title)}
            </div>
            <div class="identity-text">
              <div class="identity-name">${this.title}</div>
              ${this.subtitle ? html`<div class="identity-subtitle">${this.subtitle}</div>` : nothing}
              <div class="identity-jid">${this.jid}</div>
            </div>
          </div>

          <div class="actions">
            <button class="action" @click=${this.copyJid}>Copy JID</button>
            <button class="action ${this.pinned ? 'active' : ''}" @click=${this.togglePin}>
              ${this.pinned ? 'Pinned' : 'Pin'}
            </button>
            <button class="action ${this.muted ? 'active' : ''}" @click=${this.toggleMute}>
              ${this.muted ? 'Muted' : 'Mute'}
            </button>
            <button class="action ${this.archived ? 'active' : ''}" @click=${this.toggleArchive}>
              ${this.archived ? 'Archived' : 'Archive'}
            </button>
            ${this.omemoSupported
              ? html`<button class="action ${this.omemoActive ? 'active' : ''}" @click=${this.toggleOmemo}>
                  ${this.omemoActive ? 'Encryption on' : 'Encryption off'}
                </button>`
              : nothing}
          </div>

          <div class="section">
            <h3>Media</h3>
            ${this.media.length === 0
              ? html`<p class="muted">No media yet</p>`
              : html`
                  ${this.media.some((m) => m.isImage)
                    ? html`<div class="media-grid">
                        ${this.media.filter((m) => m.isImage).map((m) => this.renderMedia(m))}
                      </div>`
                    : nothing}
                  ${this.media.filter((m) => !m.isImage).map((m) => this.renderMedia(m))}
                `}
          </div>

          ${this.isGroup
            ? html`
                <div class="section">
                  <h3>Members (${this.members.length})</h3>
                  ${this.members.length === 0
                    ? html`<p class="muted">No members loaded</p>`
                    : this.members.map(
                        (m) => html`
                          <div class="member" title=${m.nick}>
                            <span
                              class="member-dot"
                              style="background: ${m.presence === 'online' ? '#22c55e' : '#94a3b8'}"
                            ></span>
                            <div class="member-info">
                              <div class="member-nick">${m.nick}</div>
                              <div class="member-meta">${m.affiliation !== 'none' ? m.affiliation : m.role}</div>
                            </div>
                          </div>
                        `,
                      )}
                </div>
              `
            : nothing}

          ${this.canLeave
            ? html`
                <div class="section">
                  <h3>Options</h3>
                  <button class="leave-btn" @click=${this.leave}>Leave group</button>
                </div>
              `
            : nothing}
        </aside>
      </div>
    `;
  }
}
