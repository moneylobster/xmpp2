import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getLogEntries, clearLogEntries, onLogUpdate, type LogEntry } from '@/utils/logger';

@customElement('log-viewer')
export class LogViewer extends LitElement {
  @state() private entries: readonly LogEntry[] = [];
  @state() private filter: LogEntry['level'] | 'all' = 'all';

  private cleanup?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.entries = getLogEntries();
    this.cleanup = onLogUpdate(() => {
      this.entries = [...getLogEntries()];
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  private get filteredEntries() {
    if (this.filter === 'all') return this.entries;
    return this.entries.filter(e => e.level === this.filter);
  }

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  private handleClear() {
    clearLogEntries();
  }

  private handleCopy() {
    const text = this.filteredEntries.map(e => {
      const t = new Date(e.timestamp).toISOString().slice(11, 23);
      return `[${t}] [${e.level.toUpperCase()}] ${e.message}`;
    }).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-bg, #f8fafc);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background: var(--color-bg-card, #fff);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
      flex-shrink: 0;
    }

    .back-btn {
      background: none;
      border: none;
      color: var(--color-primary, #3b82f6);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
      border-radius: 0.25rem;
    }

    .header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text, #0f172a);
      flex: 1;
    }

    .header-actions {
      display: flex;
      gap: 0.5rem;
    }

    .action-btn {
      background: none;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 0.375rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
    }

    .action-btn:hover {
      background: var(--color-bg-input, #f1f5f9);
    }

    .filters {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem 1rem;
      background: var(--color-bg-card, #fff);
      border-bottom: 1px solid var(--color-border, #e2e8f0);
      flex-shrink: 0;
    }

    .filter-btn {
      padding: 0.25rem 0.625rem;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 1rem;
      background: none;
      font-size: 0.6875rem;
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
    }

    .filter-btn.active {
      background: var(--color-primary, #2563eb);
      border-color: var(--color-primary, #2563eb);
      color: white;
    }

    .filter-btn.active-warn {
      background: #f59e0b;
      border-color: #f59e0b;
      color: white;
    }

    .filter-btn.active-error {
      background: #ef4444;
      border-color: #ef4444;
      color: white;
    }

    .log-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 0.6875rem;
      line-height: 1.5;
      -webkit-overflow-scrolling: touch;
    }

    .log-entry {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--color-border, #f1f5f9);
      word-break: break-word;
      white-space: pre-wrap;
    }

    .log-entry .time {
      color: var(--color-text-secondary, #94a3b8);
      margin-right: 0.5rem;
    }

    .log-entry.log { color: var(--color-text, #334155); }
    .log-entry.info { color: var(--color-primary, #2563eb); }
    .log-entry.warn { color: #f59e0b; }
    .log-entry.error { color: #ef4444; }

    .log-entry .level {
      font-weight: 600;
      margin-right: 0.375rem;
    }

    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-text-secondary, #94a3b8);
      font-size: 0.875rem;
    }

    .count {
      padding: 0.375rem 1rem;
      font-size: 0.6875rem;
      color: var(--color-text-secondary, #94a3b8);
      background: var(--color-bg-card, #fff);
      border-top: 1px solid var(--color-border, #e2e8f0);
      flex-shrink: 0;
    }
  `;

  render() {
    const filtered = this.filteredEntries;
    const warnCount = this.entries.filter(e => e.level === 'warn').length;
    const errorCount = this.entries.filter(e => e.level === 'error').length;

    return html`
      <div class="header">
        <button class="back-btn" @click=${this.handleBack} aria-label="Go back">&larr;</button>
        <h2>Debug Log</h2>
        <div class="header-actions">
          <button class="action-btn" @click=${this.handleCopy}>Copy</button>
          <button class="action-btn" @click=${this.handleClear}>Clear</button>
        </div>
      </div>

      <div class="filters">
        <button
          class="filter-btn ${this.filter === 'all' ? 'active' : ''}"
          @click=${() => this.filter = 'all'}
        >All</button>
        <button
          class="filter-btn ${this.filter === 'log' ? 'active' : ''}"
          @click=${() => this.filter = 'log'}
        >Log</button>
        <button
          class="filter-btn ${this.filter === 'info' ? 'active' : ''}"
          @click=${() => this.filter = 'info'}
        >Info</button>
        <button
          class="filter-btn ${this.filter === 'warn' ? (warnCount ? 'active-warn' : 'active') : ''}"
          @click=${() => this.filter = 'warn'}
        >Warn${warnCount ? ` (${warnCount})` : ''}</button>
        <button
          class="filter-btn ${this.filter === 'error' ? (errorCount ? 'active-error' : 'active') : ''}"
          @click=${() => this.filter = 'error'}
        >Error${errorCount ? ` (${errorCount})` : ''}</button>
      </div>

      <div class="log-list">
        ${filtered.length === 0
          ? html`<div class="empty">No log entries</div>`
          : filtered.map(e => html`
            <div class="log-entry ${e.level}">
              <span class="time">${this.formatTime(e.timestamp)}</span>
              <span class="level">${e.level.toUpperCase()}</span>
              ${e.message}
            </div>
          `)
        }
      </div>

      <div class="count">${filtered.length} entries</div>
    `;
  }

  updated() {
    // Auto-scroll to bottom
    const list = this.shadowRoot?.querySelector('.log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }
}
