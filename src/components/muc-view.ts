import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { getApi } from '@/xmpp/client';
import { getMessageBody, formatTime, dateKey, formatDateLabel, trackOmemo } from '@/utils/chat-utils';
import {
  uploadAndSend, validateFile, isImageUrl, formatFileSize,
  getFilesFromPaste, getFilesFromDrop, isAesgcmUrl, decryptAesgcmUrl,
  type UploadProgress,
} from '@/utils/file-upload';
import { hapticLight } from '@/utils/haptics';
import './skeleton-loader';

interface MucMessage {
  id: string;
  body: string;
  sender: 'me' | 'them';
  nick: string;
  time: string;
  timeISO: string;
  dateKey: string;
  isError: boolean;
  isEncrypted: boolean;
  decryptedUrl?: string | null;
}

interface OccupantInfo {
  jid: string;
  nick: string;
  role: string;
  affiliation: string;
  presence: string;
}

@customElement('muc-view')
export class MucView extends LitElement {
  @property({ type: String }) jid = '';
  @state() private messages: MucMessage[] = [];
  @state() private occupants: OccupantInfo[] = [];
  @state() private inputText = '';
  @state() private roomName = '';
  @state() private roomTopic = '';
  @state() private loading = true;
  @state() private showOccupants = false;
  @state() private omemoActive = false;
  @state() private omemoSupported = false;
  @state() private uploading = false;
  @state() private uploadProgress = 0;
  @state() private uploadError = '';
  @state() private dragOver = false;

  @query('.messages') private messagesEl!: HTMLElement;
  @query('#file-input') private fileInput!: HTMLInputElement;

  private muc: any = null;
  private cleanups: Array<() => void> = [];
  private autoScroll = true;
  private decryptedCache = new Map<string, string | null>();

  connectedCallback() {
    super.connectedCallback();
    if (this.jid) this.openRoom();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardown();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('jid') && this.jid) {
      this.teardown();
      this.openRoom();
    }
  }

  private teardown() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.muc = null;
    this.messages = [];
    this.occupants = [];
    this.inputText = '';
    this.omemoActive = false;
    this.omemoSupported = false;
  }

  private async openRoom() {
    const api = getApi();
    if (!api || !this.jid) return;
    this.loading = true;

    try {
      this.muc = await api.rooms.get(this.jid);
      if (!this.muc) {
        this.muc = await api.rooms.open(this.jid);
      }
      if (!this.muc) return;

      this.roomName = this.muc.get('name') || this.jid.split('@')[0];
      this.roomTopic = this.muc.get('subject')?.text || '';

      if (this.muc.messages?.fetched) {
        await this.muc.messages.fetched;
      }

      this.loadMessages();
      this.loadOccupants();
      this.loading = false;
      this.scrollToBottom();

      const msgHandler = () => {
        this.loadMessages();
        if (this.autoScroll) this.scrollToBottom();
      };
      this.muc.messages.on('add', msgHandler);
      this.muc.messages.on('change', msgHandler);
      this.cleanups.push(() => {
        this.muc?.messages?.off('add', msgHandler);
        this.muc?.messages?.off('change', msgHandler);
      });

      const occHandler = () => this.loadOccupants();
      this.muc.occupants.on('add', occHandler);
      this.muc.occupants.on('remove', occHandler);
      this.muc.occupants.on('change', occHandler);
      this.cleanups.push(() => {
        this.muc?.occupants?.off('add', occHandler);
        this.muc?.occupants?.off('remove', occHandler);
        this.muc?.occupants?.off('change', occHandler);
      });

      const topicHandler = () => {
        this.roomTopic = this.muc?.get('subject')?.text || '';
      };
      this.muc.on('change:subject', topicHandler);
      this.cleanups.push(() => this.muc?.off('change:subject', topicHandler));

      this.cleanups.push(trackOmemo(this.muc, (active, supported) => {
        this.omemoActive = active;
        this.omemoSupported = supported;
      }));
    } catch (err) {
      console.error('Failed to open room:', err);
      this.loading = false;
    }
  }

  private loadMessages() {
    if (!this.muc?.messages) return;

    this.messages = this.muc.messages
      .filter((m: any) => !!m.get('body'))
      .map((m: any) => {
        const timeISO = m.get('time') || '';
        const body = getMessageBody(m);
        return {
          id: m.get('msgid') || m.get('id') || m.cid,
          body,
          sender: m.get('sender') === 'me' ? 'me' as const : 'them' as const,
          nick: m.get('nick') || m.get('from')?.split('/').pop() || '?',
          time: formatTime(timeISO),
          timeISO,
          dateKey: dateKey(timeISO),
          isError: !!m.get('is_error'),
          isEncrypted: !!m.get('is_encrypted'),
          decryptedUrl: isAesgcmUrl(body) ? (this.decryptedCache.get(body) ?? undefined) : undefined,
        };
      })
      .sort((a: MucMessage, b: MucMessage) => a.timeISO.localeCompare(b.timeISO));

    for (const msg of this.messages) {
      if (isAesgcmUrl(msg.body) && !this.decryptedCache.has(msg.body)) {
        this.decryptedCache.set(msg.body, null);
        decryptAesgcmUrl(msg.body).then((blobUrl) => {
          this.decryptedCache.set(msg.body, blobUrl);
          this.requestUpdate();
        });
      }
    }
  }

  private loadOccupants() {
    if (!this.muc?.occupants) return;

    this.occupants = this.muc.occupants
      .filter((o: any) => o.get('nick'))
      .map((o: any) => ({
        jid: o.get('jid') || '',
        nick: o.get('nick') || '',
        role: o.get('role') || 'participant',
        affiliation: o.get('affiliation') || 'none',
        presence: o.get('presence') || 'offline',
      }))
      .sort((a: OccupantInfo, b: OccupantInfo) => a.nick.localeCompare(b.nick));
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  private handleScroll() {
    if (!this.messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    this.autoScroll = scrollHeight - scrollTop - clientHeight < 50;
  }

  private async sendMessage() {
    const text = this.inputText.trim();
    if (!text || !this.muc) return;
    this.inputText = '';
    try {
      await this.muc.sendMessage({ body: text });
      hapticLight();
      this.autoScroll = true;
      this.scrollToBottom();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  private toggleOmemo() {
    if (!this.muc) return;
    const newState = !this.omemoActive;
    this.muc.set('omemo_active', newState);
    this.omemoActive = newState;
  }

  private openFilePicker() {
    this.fileInput?.click();
  }

  private handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) this.handleFileUpload(input.files[0]);
    input.value = '';
  }

  private async handleFileUpload(file: File) {
    const validation = validateFile(file);
    if (!validation.valid) {
      this.uploadError = validation.error || 'Invalid file';
      setTimeout(() => (this.uploadError = ''), 4000);
      return;
    }
    if (!this.muc) return;

    this.uploading = true;
    this.uploadProgress = 0;
    this.uploadError = '';

    try {
      await uploadAndSend(this.muc, file, (p: UploadProgress) => {
        this.uploadProgress = p.percent;
      });
      this.autoScroll = true;
      this.scrollToBottom();
    } catch (err: any) {
      console.error('File upload failed:', err);
      this.uploadError = err?.message || 'Upload failed';
      setTimeout(() => (this.uploadError = ''), 4000);
    } finally {
      this.uploading = false;
      this.uploadProgress = 0;
    }
  }

  private handlePaste(e: ClipboardEvent) {
    const files = getFilesFromPaste(e);
    if (files.length > 0) {
      e.preventDefault();
      this.handleFileUpload(files[0]);
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver = true;
  }

  private handleDragLeave() {
    this.dragOver = false;
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
    const files = getFilesFromDrop(e);
    if (files.length > 0) this.handleFileUpload(files[0]);
  }

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  private nickColor(nick: string): string {
    let hash = 0;
    for (let i = 0; i < nick.length; i++) {
      hash = nick.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 45%)`;
  }

  private roleIcon(occ: OccupantInfo): string {
    if (occ.affiliation === 'owner') return '\u{1F451}';
    if (occ.affiliation === 'admin') return '\u2B50';
    if (occ.role === 'moderator') return '\u{1F6E1}\uFE0F';
    return '';
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-bg);
      position: relative;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background: var(--color-bg-card);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .back-btn {
      display: none;
      background: none;
      border: none;
      color: var(--color-primary);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
      border-radius: 0.25rem;
    }

    @media (max-width: 768px) {
      .back-btn { display: block; }
    }

    .header-icon {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.375rem;
      background: var(--color-primary-light);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      color: var(--color-primary);
      flex-shrink: 0;
      font-weight: 700;
    }

    .header-info { flex: 1; min-width: 0; }

    .header-name {
      font-size: 0.9375rem;
      font-weight: 600;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .header-topic {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .omemo-btn {
      background: none;
      border: 1px solid var(--color-border);
      border-radius: 0.375rem;
      padding: 0.25rem 0.5rem;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all var(--duration-fast);
      flex-shrink: 0;
    }

    .omemo-btn:hover { background: var(--color-bg); }
    .omemo-btn.active { border-color: var(--color-success); background: var(--color-success-bg); }

    .occupants-btn {
      background: none;
      border: 1px solid var(--color-border);
      border-radius: 0.375rem;
      padding: 0.25rem 0.5rem;
      cursor: pointer;
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      flex-shrink: 0;
      transition: all var(--duration-fast);
    }

    .occupants-btn:hover { background: var(--color-bg); }
    .occupants-btn.active { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }

    .body { display: flex; flex: 1; overflow: hidden; }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .date-separator {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin: 0.75rem 0;
    }

    .date-separator::before,
    .date-separator::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border);
    }

    .date-label {
      font-size: 0.6875rem;
      font-weight: 500;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.025em;
      white-space: nowrap;
    }

    .msg {
      max-width: 80%;
      padding: 0.375rem 0.75rem 0.5rem;
      border-radius: 0.75rem;
      font-size: 0.875rem;
      line-height: 1.45;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: msgIn 0.2s ease-out;
    }

    @keyframes msgIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .msg.me {
      align-self: flex-end;
      background: var(--color-msg-me);
      color: var(--color-msg-me-text);
      border-bottom-right-radius: 0.25rem;
    }

    .msg.them {
      align-self: flex-start;
      background: var(--color-msg-them);
      color: var(--color-msg-them-text);
      border-bottom-left-radius: 0.25rem;
      box-shadow: var(--shadow-msg);
    }

    .msg-nick {
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 0.125rem;
    }

    .msg-meta {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin-top: 0.1875rem;
      font-size: 0.6875rem;
      opacity: 0.7;
    }

    .msg.me .msg-meta { justify-content: flex-end; }

    /* Occupants panel */
    .occupants-panel {
      width: 200px;
      background: var(--color-bg-card);
      border-left: 1px solid var(--color-border);
      overflow-y: auto;
      flex-shrink: 0;
    }

    .occ-header {
      padding: 0.75rem;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      border-bottom: 1px solid var(--color-border);
    }

    .occ {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.75rem;
    }

    .occ-dot {
      width: 0.4375rem;
      height: 0.4375rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .occ-nick {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .occ-role {
      font-size: 0.6875rem;
      flex-shrink: 0;
    }

    @media (max-width: 768px) {
      .occupants-panel { display: none; }
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
    }

    .empty-chat {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem;
      gap: 0.75rem;
    }

    .empty-chat svg { opacity: 0.3; }
    .empty-chat p { margin: 0; font-size: 0.875rem; }

    .input-bar {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--color-bg-card);
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .input-bar textarea {
      flex: 1;
      border: 1px solid var(--color-border);
      border-radius: 1.25rem;
      padding: 0.5rem 0.875rem;
      font-size: 0.875rem;
      font-family: inherit;
      resize: none;
      outline: none;
      max-height: 120px;
      line-height: 1.4;
      color: var(--color-text);
      background: var(--color-bg-input);
      transition: border-color var(--duration-fast), background var(--duration-fast);
    }

    .input-bar textarea:focus { border-color: var(--color-border-focus); background: var(--color-bg-card); }

    .send-btn {
      width: 2.25rem;
      height: 2.25rem;
      border: none;
      border-radius: 50%;
      background: var(--color-primary);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .send-btn:hover { background: var(--color-primary-hover); }
    .send-btn:active { transform: scale(0.93); }
    .send-btn:disabled { background: var(--color-text-muted); cursor: default; }
    .send-btn:disabled:active { transform: none; }
    .send-btn svg { width: 1.125rem; height: 1.125rem; }

    .attach-btn {
      width: 2.25rem;
      height: 2.25rem;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color var(--duration-fast), transform var(--duration-fast);
    }

    .attach-btn:hover { color: var(--color-primary); }
    .attach-btn:active { transform: scale(0.93); }
    .attach-btn:disabled { color: var(--color-text-muted); cursor: default; }
    .attach-btn svg { width: 1.25rem; height: 1.25rem; }

    .upload-bar {
      padding: 0.25rem 1rem 0.5rem;
      background: var(--color-bg-card);
    }

    .upload-progress {
      height: 3px;
      background: var(--color-border);
      border-radius: 2px;
      overflow: hidden;
    }

    .upload-progress-fill {
      height: 100%;
      background: var(--color-primary);
      transition: width 0.15s;
    }

    .upload-error {
      font-size: 0.75rem;
      color: var(--color-error);
      padding: 0.25rem 1rem;
      background: var(--color-error-bg);
    }

    .drag-overlay {
      position: absolute;
      inset: 0;
      background: rgba(37, 99, 235, 0.08);
      border: 2px dashed var(--color-primary);
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-primary);
      z-index: 10;
      pointer-events: none;
    }

    .msg-image {
      max-width: 280px;
      max-height: 280px;
      border-radius: 0.5rem;
      cursor: pointer;
      display: block;
      margin-top: 0.25rem;
    }

    .msg-file-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.625rem;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 0.375rem;
      font-size: 0.8125rem;
      text-decoration: none;
      color: inherit;
      margin-top: 0.25rem;
    }

    .msg.me .msg-file-link {
      background: rgba(255, 255, 255, 0.15);
      color: white;
    }

    .msg-file-link:hover { text-decoration: underline; }
  `;

  private renderMessageBody(msg: MucMessage) {
    const body = msg.body.trim();

    if (isAesgcmUrl(body)) {
      const blobUrl = msg.decryptedUrl;
      if (blobUrl === undefined || blobUrl === null) {
        return html`<div class="msg-file-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          ${blobUrl === null ? 'Decrypting...' : 'Encrypted file'}
        </div>`;
      }
      if (isImageUrl(body)) {
        return html`<img class="msg-image" src="${blobUrl}" alt="encrypted image" loading="lazy"
          @click=${() => window.open(blobUrl, '_blank')} />`;
      }
      const parsed = new URL(body.replace('aesgcm://', 'https://'));
      const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'file');
      return html`<a class="msg-file-link" href="${blobUrl}" download="${filename}" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        ${filename}
      </a>`;
    }

    try {
      const url = new URL(body);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (isImageUrl(body)) {
          return html`<img class="msg-image" src="${body}" alt="image" loading="lazy"
            @click=${() => window.open(body, '_blank')} />`;
        }
        const filename = decodeURIComponent(url.pathname.split('/').pop() || 'file');
        return html`<a class="msg-file-link" href="${body}" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          ${filename}
        </a>`;
      }
    } catch { /* not a URL */ }
    return html`<div>${body}</div>`;
  }

  private renderMessages() {
    const items: any[] = [];
    let lastDateKey = '';

    for (const msg of this.messages) {
      if (msg.dateKey !== lastDateKey) {
        items.push(html`
          <div class="date-separator">
            <span class="date-label">${formatDateLabel(msg.dateKey)}</span>
          </div>
        `);
        lastDateKey = msg.dateKey;
      }

      items.push(html`
        <div class="msg ${msg.sender}">
          ${msg.sender === 'them'
            ? html`<div class="msg-nick" style="color: ${this.nickColor(msg.nick)}">${msg.nick}</div>`
            : nothing}
          ${this.renderMessageBody(msg)}
          <div class="msg-meta">
            ${msg.isEncrypted ? html`<span title="Encrypted">&#x1F512;</span>` : nothing}
            <span>${msg.time}</span>
          </div>
        </div>
      `);
    }
    return items;
  }

  render() {
    return html`
      <div class="header">
        <button class="back-btn" @click=${this.handleBack} aria-label="Go back">&larr;</button>
        <div class="header-icon">#</div>
        <div class="header-info">
          <div class="header-name">${this.roomName}</div>
          ${this.roomTopic ? html`<div class="header-topic">${this.roomTopic}</div>` : nothing}
        </div>
        <button
          class="omemo-btn ${this.omemoActive ? 'active' : ''}"
          @click=${this.toggleOmemo}
          title="${this.omemoActive ? 'OMEMO encryption enabled' : 'OMEMO encryption disabled'}"
          aria-label="${this.omemoActive ? 'Disable OMEMO' : 'Enable OMEMO'}"
        >
          ${this.omemoActive ? '\u{1F512}' : '\u{1F513}'}
        </button>
        <button
          class="occupants-btn ${this.showOccupants ? 'active' : ''}"
          @click=${() => (this.showOccupants = !this.showOccupants)}
          aria-label="Toggle members panel"
        >
          ${this.occupants.length} members
        </button>
      </div>

      ${this.dragOver ? html`<div class="drag-overlay">Drop file to upload</div>` : nothing}

      ${this.loading
        ? html`<div class="loading"><skeleton-loader rows="5" variant="message"></skeleton-loader></div>`
        : html`
            <div class="body">
              <div class="messages" @scroll=${this.handleScroll}
                @dragover=${this.handleDragOver} @dragleave=${this.handleDragLeave} @drop=${this.handleDrop}
                role="log" aria-label="Room messages">
                ${this.messages.length === 0
                  ? html`<div class="empty-chat">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        <line x1="9" y1="10" x2="15" y2="10"/>
                      </svg>
                      <p>No messages yet</p>
                    </div>`
                  : this.renderMessages()}
              </div>
              ${this.showOccupants
                ? html`
                    <div class="occupants-panel" role="complementary" aria-label="Room members">
                      <div class="occ-header">Members (${this.occupants.length})</div>
                      ${this.occupants.map(
                        (o) => html`
                          <div class="occ" title="${o.jid || o.nick}">
                            <span
                              class="occ-dot"
                              style="background: ${o.presence === 'online' ? '#22c55e' : '#94a3b8'}"
                            ></span>
                            <span class="occ-nick">${o.nick}</span>
                            <span class="occ-role">${this.roleIcon(o)}</span>
                          </div>
                        `,
                      )}
                    </div>
                  `
                : nothing}
            </div>
          `}

      ${this.uploadError ? html`<div class="upload-error">${this.uploadError}</div>` : nothing}
      ${this.uploading ? html`
        <div class="upload-bar">
          <div class="upload-progress">
            <div class="upload-progress-fill" style="width: ${this.uploadProgress}%"></div>
          </div>
        </div>
      ` : nothing}

      <input type="file" id="file-input" hidden @change=${this.handleFileSelect} />
      <div class="input-bar">
        <button class="attach-btn" @click=${this.openFilePicker} ?disabled=${this.uploading} title="Attach file" aria-label="Attach file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <textarea
          rows="1"
          placeholder="Message #${this.roomName}..."
          .value=${this.inputText}
          @input=${(e: Event) => (this.inputText = (e.target as HTMLTextAreaElement).value)}
          @keydown=${this.handleKeyDown}
          @paste=${this.handlePaste}
          aria-label="Message input"
        ></textarea>
        <button
          class="send-btn"
          @click=${this.sendMessage}
          ?disabled=${!this.inputText.trim()}
          title="Send"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    `;
  }
}
