import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('media-lightbox')
export class MediaLightbox extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: String }) url = '';
  @property({ type: String }) name = '';

  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 300;
      background: rgba(0, 0, 0, 0.88);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    img {
      max-width: 92vw;
      max-height: 84vh;
      object-fit: contain;
      border-radius: 0.25rem;
    }

    .toolbar {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      display: flex;
      gap: 0.5rem;
    }

    .toolbar a,
    .toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.25rem;
      height: 2.25rem;
      padding: 0 0.75rem;
      border: none;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      text-decoration: none;
      font-size: 0.8125rem;
      cursor: pointer;
    }

    .toolbar a:hover,
    .toolbar button:hover { background: rgba(255, 255, 255, 0.25); }
  `;

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  render() {
    if (!this.open || !this.url) return nothing;
    return html`
      <div class="overlay" @click=${this.close}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); }}
        tabindex="0">
        <img src=${this.url} alt=${this.name || 'Image'} @click=${(e: Event) => e.stopPropagation()} />
        <div class="toolbar" @click=${(e: Event) => e.stopPropagation()}>
          <a href=${this.url} download=${this.name || 'image'} title="Download">Download</a>
          <button @click=${this.close} aria-label="Close">×</button>
        </div>
      </div>
    `;
  }
}
