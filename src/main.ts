import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { initClient, getConnectionStatus } from '@/xmpp/client';
import { events, CONNECTION_STATUS_CHANGED, LOGGED_OUT } from '@/xmpp/events';
import type { ConnectionStatus } from '@/types';

import './components/login-view';
import './components/app-shell';

@customElement('xmpp-app')
export class XmppApp extends LitElement {
  @state() private view: 'login' | 'app' = 'login';

  private cleanup: Array<() => void> = [];

  async connectedCallback() {
    super.connectedCallback();
    await initClient();

    this.cleanup.push(
      events.on(CONNECTION_STATUS_CHANGED, (status: ConnectionStatus) => {
        if (status === 'connected') this.view = 'app';
      }),
      events.on(LOGGED_OUT, () => {
        this.view = 'login';
      }),
    );
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
  `;

  render() {
    return this.view === 'login'
      ? html`<login-view></login-view>`
      : html`<app-shell></app-shell>`;
  }
}
