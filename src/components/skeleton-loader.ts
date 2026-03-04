import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('skeleton-loader')
export class SkeletonLoader extends LitElement {
  /** Number of skeleton rows to show */
  @property({ type: Number }) rows = 3;
  /** Variant: 'contact' for avatar+lines, 'message' for chat bubbles, 'room' for room items */
  @property({ type: String }) variant: 'contact' | 'message' | 'room' = 'contact';

  static styles = css`
    :host {
      display: block;
      padding: 0.5rem;
    }

    .skeleton-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .skeleton-row:nth-child(2) { animation-delay: 0.15s; }
    .skeleton-row:nth-child(3) { animation-delay: 0.3s; }
    .skeleton-row:nth-child(4) { animation-delay: 0.45s; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .circle {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 50%;
      background: var(--skel-bg, rgba(255, 255, 255, 0.08));
      flex-shrink: 0;
    }

    .circle.small {
      width: 2rem;
      height: 2rem;
      border-radius: 0.375rem;
    }

    .lines {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .line {
      height: 0.625rem;
      border-radius: 0.25rem;
      background: var(--skel-bg, rgba(255, 255, 255, 0.08));
    }

    .line.short { width: 50%; }
    .line.medium { width: 75%; }
    .line.long { width: 90%; }

    /* Message variant */
    .msg-skel {
      padding: 0.5rem 0.75rem;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .msg-skel:nth-child(odd) { align-self: flex-start; }
    .msg-skel:nth-child(even) { align-self: flex-end; }
    .msg-skel:nth-child(2) { animation-delay: 0.2s; }
    .msg-skel:nth-child(3) { animation-delay: 0.4s; }

    .msg-bubble {
      height: 2rem;
      border-radius: 1rem;
      background: var(--skel-bg, rgba(255, 255, 255, 0.08));
    }

    .msg-bubble.w1 { width: 60%; }
    .msg-bubble.w2 { width: 40%; }
    .msg-bubble.w3 { width: 70%; }

    :host([variant="message"]) {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
    }
  `;

  render() {
    if (this.variant === 'message') {
      return html`
        ${Array.from({ length: this.rows }, (_, i) => html`
          <div class="msg-skel" style="animation-delay: ${i * 0.15}s">
            <div class="msg-bubble ${['w1', 'w2', 'w3'][i % 3]}"></div>
          </div>
        `)}
      `;
    }

    const isRoom = this.variant === 'room';
    return html`
      ${Array.from({ length: this.rows }, (_, i) => html`
        <div class="skeleton-row" style="animation-delay: ${i * 0.15}s">
          <div class="circle ${isRoom ? 'small' : ''}"></div>
          <div class="lines">
            <div class="line ${['medium', 'long', 'short'][i % 3]}"></div>
            <div class="line short"></div>
          </div>
        </div>
      `)}
    `;
  }
}
