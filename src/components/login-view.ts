import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { login } from '@/xmpp/client';
import { events, CONNECTION_STATUS_CHANGED } from '@/xmpp/events';
import type { ConnectionStatus } from '@/types';

@customElement('login-view')
export class LoginView extends LitElement {
  @state() private jid = '';
  @state() private password = '';
  @state() private status: ConnectionStatus = 'disconnected';
  @state() private error = '';
  @state() private loading = false;

  private cleanup?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.cleanup = events.on(CONNECTION_STATUS_CHANGED, (s: ConnectionStatus) => {
      this.status = s;
      if (s === 'connected') this.loading = false;
      if (s === 'authfail') {
        this.error = 'Authentication failed. Check your JID and password.';
        this.loading = false;
      }
      if (s === 'connfail' || s === 'error') {
        this.error = 'Connection failed. Check your server address.';
        this.loading = false;
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  private async handleSubmit(e: Event) {
    e.preventDefault();
    this.error = '';
    this.loading = true;

    try {
      await login({ jid: this.jid, password: this.password });
    } catch (err: any) {
      this.error = err.message || 'Failed to connect';
      this.loading = false;
    }
  }

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      background-attachment: fixed;
      padding: 1rem;
    }

    .card {
      background: var(--color-bg-card, #fff);
      border-radius: 1rem;
      padding: 2.5rem;
      width: 100%;
      max-width: 400px;
      box-shadow: var(--shadow-card);
      animation: cardIn 0.3s ease-out;
    }

    @keyframes cardIn {
      from { opacity: 0; transform: translateY(16px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--color-text, #0f172a);
    }

    .subtitle {
      margin: 0 0 2rem;
      font-size: 0.875rem;
      color: var(--color-text-secondary, #64748b);
    }

    label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-secondary, #334155);
      margin-bottom: 0.375rem;
    }

    input {
      display: block;
      width: 100%;
      padding: 0.625rem 0.875rem;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      color: var(--color-text, #0f172a);
      background: var(--color-bg-input, #f8fafc);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      box-sizing: border-box;
      margin-bottom: 1rem;
    }

    input:focus {
      border-color: var(--color-border-focus, #3b82f6);
      box-shadow: 0 0 0 3px var(--color-focus-ring, rgba(59, 130, 246, 0.15));
      background: var(--color-bg-card, #fff);
    }

    button[type="submit"] {
      display: block;
      width: 100%;
      padding: 0.75rem;
      background: var(--color-primary, #2563eb);
      color: var(--color-primary-text, #fff);
      border: none;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform var(--duration-fast, 0.12s);
      margin-top: 0.5rem;
    }

    button[type="submit"]:hover:not(:disabled) {
      background: var(--color-primary-hover, #1d4ed8);
    }

    button[type="submit"]:active:not(:disabled) {
      transform: scale(0.98);
    }

    button[type="submit"]:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error {
      background: var(--color-error-bg, #fef2f2);
      color: var(--color-error, #dc2626);
      padding: 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      margin-bottom: 1rem;
      animation: shakeX 0.4s ease-out;
    }

    @keyframes shakeX {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(6px); }
      60% { transform: translateX(-4px); }
      80% { transform: translateX(4px); }
    }

    .status {
      text-align: center;
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #64748b);
      margin-top: 1rem;
    }

    .spinner {
      display: inline-block;
      width: 1rem;
      height: 1rem;
      border: 2px solid var(--color-border, #e2e8f0);
      border-top-color: var(--color-primary, #3b82f6);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 0.5rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  render() {
    return html`
      <div class="card">
        <h1>XMPP Chat</h1>
        <p class="subtitle">Sign in with your XMPP account</p>

        ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : ''}

        <form @submit=${this.handleSubmit}>
          <label for="jid">JID (user@server.com)</label>
          <input
            id="jid"
            type="text"
            placeholder="alice@example.com"
            .value=${this.jid}
            @input=${(e: Event) => this.jid = (e.target as HTMLInputElement).value}
            ?disabled=${this.loading}
            autocomplete="username"
            required
            aria-required="true"
          />

          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Your password"
            .value=${this.password}
            @input=${(e: Event) => this.password = (e.target as HTMLInputElement).value}
            ?disabled=${this.loading}
            autocomplete="current-password"
            required
            aria-required="true"
          />

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? 'Connecting...' : 'Sign In'}
          </button>
        </form>

        ${this.loading ? html`
          <div class="status" role="status" aria-live="polite">
            <span class="spinner"></span>
            ${this.status === 'connecting' ? 'Connecting to server...' :
              this.status === 'authenticating' ? 'Authenticating...' :
              'Please wait...'}
          </div>
        ` : ''}
      </div>
    `;
  }
}
