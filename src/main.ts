import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { initClient, tryAutoLogin } from '@/xmpp/client';
import { events, CONNECTION_STATUS_CHANGED, LOGGED_OUT } from '@/xmpp/events';
import type { ConnectionStatus } from '@/types';

import './utils/theme';
import { installLogCapture } from './utils/logger';
import { hideSplashScreen, initCapacitor } from './utils/capacitor';

installLogCapture();
import './components/login-view';
import './components/app-shell';

@customElement('xmpp-app')
export class XmppApp extends LitElement {
  @state() private view: 'login' | 'app' | 'loading' = 'login';

  private cleanup: Array<() => void> = [];

  async connectedCallback() {
    super.connectedCallback();
    await initClient();

    this.cleanup.push(
      events.on(CONNECTION_STATUS_CHANGED, (status: ConnectionStatus) => {
        if (status === 'connected') {
          this.view = 'app';
          initCapacitor();
        }
      }),
      events.on(LOGGED_OUT, () => {
        this.view = 'login';
      }),
    );

    // Attempt auto-login if stored session exists
    const storedJid = localStorage.getItem('conversejs-session-jid');
    if (storedJid) {
      this.view = 'loading';
      const ok = await tryAutoLogin();
      if (!ok) this.view = 'login';
    }

    hideSplashScreen();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup.forEach((fn) => fn());
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 1rem;
      color: var(--color-text-secondary, #666);
    }
    .spinner {
      width: 2rem;
      height: 2rem;
      border: 3px solid var(--color-border, #e5e7eb);
      border-top-color: var(--color-primary, #3b82f6);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  render() {
    if (this.view === 'loading') {
      return html`<div class="loading-container">
        <div class="spinner"></div>
        <p>Connecting...</p>
      </div>`;
    }
    return this.view === 'login'
      ? html`<login-view></login-view>`
      : html`<app-shell></app-shell>`;
  }
}
