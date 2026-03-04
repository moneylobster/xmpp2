import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/utils/theme';

const SOUND_KEY = 'xmpp-notification-sound';

@customElement('settings-view')
export class SettingsView extends LitElement {
  @state() private theme: ThemePreference = 'auto';
  @state() private soundEnabled = true;

  connectedCallback() {
    super.connectedCallback();
    this.theme = getThemePreference();
    this.soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';
  }

  private setTheme(t: ThemePreference) {
    this.theme = t;
    setThemePreference(t);
  }

  private toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem(SOUND_KEY, String(this.soundEnabled));
  }

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
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
    }

    .content {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      max-width: 480px;
    }

    .section {
      margin-bottom: 2rem;
    }

    .section h3 {
      margin: 0 0 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-secondary, #64748b);
    }

    .option-group {
      display: flex;
      gap: 0.5rem;
    }

    .theme-btn {
      flex: 1;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 0.5rem;
      background: var(--color-bg-card, #fff);
      color: var(--color-text, #0f172a);
      font-size: 0.8125rem;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }

    .theme-btn:hover {
      border-color: var(--color-primary, #3b82f6);
    }

    .theme-btn.active {
      border-color: var(--color-primary, #3b82f6);
      background: var(--color-primary-light, #eff6ff);
      color: var(--color-primary, #2563eb);
      font-weight: 600;
    }

    .theme-btn .icon {
      display: block;
      font-size: 1.25rem;
      margin-bottom: 0.25rem;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
    }

    .toggle-label {
      font-size: 0.875rem;
      color: var(--color-text, #0f172a);
    }

    .toggle-desc {
      font-size: 0.75rem;
      color: var(--color-text-secondary, #64748b);
      margin-top: 0.125rem;
    }

    .toggle {
      position: relative;
      width: 2.75rem;
      height: 1.5rem;
      border-radius: 0.75rem;
      background: var(--color-border, #e2e8f0);
      cursor: pointer;
      border: none;
      padding: 0;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .toggle.on {
      background: var(--color-primary, #2563eb);
    }

    .toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .toggle.on::after {
      transform: translateX(1.25rem);
    }

    .about {
      padding: 1rem;
      background: var(--color-bg-input, #f8fafc);
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #64748b);
      line-height: 1.5;
    }

    .about strong {
      color: var(--color-text, #0f172a);
    }
  `;

  render() {
    return html`
      <div class="header">
        <button class="back-btn" @click=${this.handleBack} aria-label="Go back">&larr;</button>
        <h2>Settings</h2>
      </div>
      <div class="content">
        <div class="section">
          <h3>Appearance</h3>
          <div class="option-group" role="radiogroup" aria-label="Theme preference">
            <button
              class="theme-btn ${this.theme === 'light' ? 'active' : ''}"
              @click=${() => this.setTheme('light')}
              role="radio"
              aria-checked=${this.theme === 'light'}
            >
              <span class="icon">&#9728;</span>
              Light
            </button>
            <button
              class="theme-btn ${this.theme === 'dark' ? 'active' : ''}"
              @click=${() => this.setTheme('dark')}
              role="radio"
              aria-checked=${this.theme === 'dark'}
            >
              <span class="icon">&#9790;</span>
              Dark
            </button>
            <button
              class="theme-btn ${this.theme === 'auto' ? 'active' : ''}"
              @click=${() => this.setTheme('auto')}
              role="radio"
              aria-checked=${this.theme === 'auto'}
            >
              <span class="icon">&#9881;</span>
              Auto
            </button>
          </div>
        </div>

        <div class="section">
          <h3>Notifications</h3>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">Notification sound</div>
              <div class="toggle-desc">Play a sound when a new message arrives</div>
            </div>
            <button
              class="toggle ${this.soundEnabled ? 'on' : ''}"
              @click=${this.toggleSound}
              role="switch"
              aria-checked=${this.soundEnabled}
              aria-label="Notification sound"
            ></button>
          </div>
        </div>

        <div class="section">
          <h3>About</h3>
          <div class="about">
            <strong>XMPP Chat</strong><br>
            A modern XMPP client built with Converse.js and Lit.<br>
            Phase 8 — UI &amp; UX Polish
          </div>
        </div>
      </div>
    `;
  }
}
