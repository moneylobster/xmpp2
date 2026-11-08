import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
  '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
  '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫',
  '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶',
  '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
  '👍', '👎', '👏', '🙌', '🤝', '🙏', '💪', '👀', '❤️', '🧡',
  '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '🔥', '✨',
  '🎉', '🎊', '✅', '❌', '⭐', '🌟', '💡', '📌', '🚀', '☕',
];

@customElement('emoji-picker')
export class EmojiPicker extends LitElement {
  @property({ type: Boolean }) open = false;
  @state() private query = '';

  @query('input') private searchEl?: HTMLInputElement;

  static styles = css`
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 250;
    }

    .panel {
      position: absolute;
      right: 1rem;
      bottom: 4.5rem;
      width: 300px;
      max-width: calc(100vw - 2rem);
      max-height: 320px;
      overflow: auto;
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: 0.75rem;
      box-shadow: var(--shadow-card);
      padding: 0.5rem;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
      padding: 0.375rem 0.5rem;
      font-size: 0.8125rem;
      background: var(--color-bg-input);
      color: var(--color-text);
      outline: none;
      margin-bottom: 0.5rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 0.125rem;
    }

    button {
      border: none;
      background: none;
      font-size: 1.25rem;
      line-height: 1;
      padding: 0.25rem;
      border-radius: 0.375rem;
      cursor: pointer;
    }

    button:hover { background: var(--color-bg-hover); }
  `;

  private close() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private pick(emoji: string) {
    this.dispatchEvent(new CustomEvent('emoji-selected', {
      detail: emoji,
      bubbles: true,
      composed: true,
    }));
    this.close();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this.updateComplete.then(() => this.searchEl?.focus());
    }
  }

  render() {
    if (!this.open) return nothing;
    const q = this.query.trim().toLowerCase();
    const items = q ? EMOJIS.filter((e) => e.includes(q)) : EMOJIS;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <input
            type="search"
            placeholder="Search emoji"
            .value=${this.query}
            @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
          />
          <div class="grid">
            ${items.map((emoji) => html`
              <button @click=${() => this.pick(emoji)} aria-label=${emoji}>${emoji}</button>
            `)}
          </div>
        </div>
      </div>
    `;
  }
}
