import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'info' | 'success' | 'error' | 'warning';
  duration: number;
  removing?: boolean;
}

let nextId = 0;

/** Global toast API */
class ToastManager {
  private el: NotificationToast | null = null;

  register(el: NotificationToast) { this.el = el; }
  unregister(el: NotificationToast) { if (this.el === el) this.el = null; }

  show(text: string, type: ToastMessage['type'] = 'info', duration = 4000) {
    this.el?.addToast({ id: nextId++, text, type, duration });
  }

  info(text: string) { this.show(text, 'info'); }
  success(text: string) { this.show(text, 'success'); }
  error(text: string) { this.show(text, 'error', 6000); }
  warning(text: string) { this.show(text, 'warning'); }
}

export const toast = new ToastManager();

@customElement('notification-toast')
export class NotificationToast extends LitElement {
  @state() private toasts: ToastMessage[] = [];
  private timers = new Map<number, number>();

  connectedCallback() {
    super.connectedCallback();
    toast.register(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    toast.unregister(this);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  addToast(t: ToastMessage) {
    this.toasts = [...this.toasts, t].slice(-5); // max 5
    const timer = window.setTimeout(() => this.removeToast(t.id), t.duration);
    this.timers.set(t.id, timer);
  }

  private removeToast(id: number) {
    // Mark as removing for exit animation
    this.toasts = this.toasts.map((t) =>
      t.id === id ? { ...t, removing: true } : t
    );
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.timers.delete(id);
    }, 200);
  }

  private dismiss(id: number) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.removeToast(id);
  }

  private iconFor(type: ToastMessage['type']) {
    switch (type) {
      case 'success': return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      case 'error': return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      case 'warning': return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      default: return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }
  }

  static styles = css`
    :host {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9999;
      display: flex;
      flex-direction: column-reverse;
      gap: 0.5rem;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      background: var(--color-bg-card, #fff);
      color: var(--color-text, #0f172a);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
      font-size: 0.8125rem;
      min-width: 240px;
      max-width: 380px;
      pointer-events: auto;
      animation: toast-in 0.25s ease-out;
      overflow: hidden;
      position: relative;
    }

    .toast.removing {
      animation: toast-out 0.2s ease-in forwards;
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(16px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes toast-out {
      to { opacity: 0; transform: translateY(-8px) scale(0.95); }
    }

    .icon {
      flex-shrink: 0;
      display: flex;
    }

    .toast.info .icon { color: #3b82f6; }
    .toast.success .icon { color: #22c55e; }
    .toast.error .icon { color: #ef4444; }
    .toast.warning .icon { color: #f59e0b; }

    .text {
      flex: 1;
      line-height: 1.4;
    }

    .dismiss {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text-muted, #94a3b8);
      padding: 0.25rem;
      flex-shrink: 0;
      line-height: 1;
      font-size: 1rem;
      border-radius: 0.25rem;
      transition: color 0.12s;
    }

    .dismiss:hover { color: var(--color-text, #0f172a); }

    .progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      border-radius: 0 0 0.75rem 0.75rem;
    }

    .toast.info .progress { background: #3b82f6; }
    .toast.success .progress { background: #22c55e; }
    .toast.error .progress { background: #ef4444; }
    .toast.warning .progress { background: #f59e0b; }

    @media (max-width: 480px) {
      :host {
        left: 1rem;
        right: 1rem;
        bottom: 1rem;
      }
      .toast { min-width: 0; max-width: none; }
    }
  `;

  render() {
    return html`
      ${this.toasts.map((t) => html`
        <div class="toast ${t.type} ${t.removing ? 'removing' : ''}" role="alert">
          <span class="icon">${this.iconFor(t.type)}</span>
          <span class="text">${t.text}</span>
          <button class="dismiss" @click=${() => this.dismiss(t.id)} aria-label="Dismiss">&times;</button>
          <div class="progress" style="animation: progress-shrink ${t.duration}ms linear forwards"></div>
        </div>
      `)}
    `;
  }
}
