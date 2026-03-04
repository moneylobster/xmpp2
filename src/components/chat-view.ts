import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';
import { getMessageBody, formatTime, dateKey, formatDateLabel, trackOmemo } from '@/utils/chat-utils';
import {
  uploadAndSend, validateFile, isImageUrl, formatFileSize,
  getFilesFromPaste, getFilesFromDrop, isAesgcmUrl, decryptAesgcmUrl,
  type UploadProgress,
} from '@/utils/file-upload';
import './skeleton-loader';

interface MessageInfo {
  id: string;
  body: string;
  sender: 'me' | 'them';
  time: string;
  timeISO: string;
  dateKey: string;
  isError: boolean;
  isEdited: boolean;
  isEncrypted: boolean;
  decryptedUrl?: string | null;
}

@customElement('chat-view')
export class ChatView extends LitElement {
  @property({ type: String }) jid = '';
  @state() private messages: MessageInfo[] = [];
  @state() private inputText = '';
  @state() private contactName = '';
  @state() private contactPresence = 'offline';
  @state() private contactShow: string | null = null;
  @state() private theirChatState = '';
  @state() private loading = true;
  @state() private loadingOlder = false;
  @state() private allHistoryLoaded = false;
  @state() private omemoActive = false;
  @state() private omemoSupported = false;
  @state() private uploading = false;
  @state() private uploadProgress = 0;
  @state() private uploadError = '';
  @state() private dragOver = false;

  @query('.messages') private messagesEl!: HTMLElement;
  @query('#file-input') private fileInput!: HTMLInputElement;

  private chatbox: any = null;
  private cleanups: Array<() => void> = [];
  private autoScroll = true;
  private decryptedCache = new Map<string, string | null>();

  connectedCallback() {
    super.connectedCallback();
    if (this.jid) this.openChat();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.teardown();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('jid') && this.jid) {
      this.teardown();
      this.openChat();
    }
  }

  private teardown() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.chatbox = null;
    this.messages = [];
    this.inputText = '';
    this.theirChatState = '';
    this.allHistoryLoaded = false;
    this.loadingOlder = false;
    this.omemoActive = false;
    this.omemoSupported = false;
  }

  private async openChat() {
    const api = getApi();
    if (!api || !this.jid) return;
    this.loading = true;

    try {
      const contact = await api.contacts.get(this.jid);
      if (contact) {
        this.contactName = contact.getDisplayName() || this.jid;
        this.contactPresence = contact.get('presence') || 'offline';
        this.contactShow = contact.get('show') || null;

        const presHandler = () => {
          this.contactPresence = contact.get('presence') || 'offline';
          this.contactShow = contact.get('show') || null;
        };
        contact.on('change:presence', presHandler);
        contact.on('change:show', presHandler);
        this.cleanups.push(() => {
          contact.off('change:presence', presHandler);
          contact.off('change:show', presHandler);
        });
      } else {
        this.contactName = this.jid;
      }
    } catch {
      this.contactName = this.jid;
    }

    try {
      this.chatbox = await api.chats.open(this.jid, {}, true);
      if (!this.chatbox) return;

      if (this.chatbox.messages?.fetched) {
        await this.chatbox.messages.fetched;
      }

      this.loadMessages();
      this.loading = false;
      this.scrollToBottom();

      const addHandler = () => {
        this.loadMessages();
        if (this.autoScroll) this.scrollToBottom();
      };
      this.chatbox.messages.on('add', addHandler);
      this.chatbox.messages.on('change', addHandler);
      this.cleanups.push(() => {
        this.chatbox?.messages?.off('add', addHandler);
        this.chatbox?.messages?.off('change', addHandler);
      });

      this.cleanups.push(trackOmemo(this.chatbox, (active, supported) => {
        this.omemoActive = active;
        this.omemoSupported = supported;
      }));

      const notifHandler = () => {
        const notif = this.chatbox?.notifications;
        this.theirChatState = notif?.get('chat_state') || '';
      };
      if (this.chatbox.notifications) {
        this.chatbox.notifications.on('change:chat_state', notifHandler);
        this.cleanups.push(() =>
          this.chatbox?.notifications?.off('change:chat_state', notifHandler),
        );
      }
    } catch (err) {
      console.error('Failed to open chat:', err);
      this.loading = false;
    }
  }

  private loadMessages() {
    if (!this.chatbox?.messages) return;

    this.messages = this.chatbox.messages
      .filter((m: any) => {
        const body = m.get('body');
        const type = m.get('type');
        return body && (type === 'chat' || type === 'normal' || !type);
      })
      .map((m: any) => {
        const timeISO = m.get('time') || '';
        const body = getMessageBody(m);
        return {
          id: m.get('msgid') || m.get('id') || m.cid,
          body,
          sender: m.get('sender') === 'me' ? 'me' as const : 'them' as const,
          time: formatTime(timeISO),
          timeISO,
          dateKey: dateKey(timeISO),
          isError: !!m.get('is_error'),
          isEdited: !!m.get('edited'),
          isEncrypted: !!m.get('is_encrypted'),
          decryptedUrl: isAesgcmUrl(body) ? (this.decryptedCache.get(body) ?? undefined) : undefined,
        };
      })
      .sort((a: MessageInfo, b: MessageInfo) => a.timeISO.localeCompare(b.timeISO));

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

  private async fetchOlderMessages() {
    if (this.loadingOlder || this.allHistoryLoaded || !this.chatbox) return;

    const api = getApi();
    if (!api) return;

    this.loadingOlder = true;

    const el = this.messagesEl;
    const prevScrollHeight = el?.scrollHeight || 0;

    try {
      const oldest = this.chatbox.getOldestMessage?.();
      const oldestTime = oldest?.get('time');

      const result = await api.archive.query({
        with: this.jid,
        rsm: { max: 50, before: oldest?.get(`stanza_id ${api.connection.get()?.domain}`) || '' },
        start: undefined,
        end: oldestTime || undefined,
      });

      if (!result || !result.messages || result.messages.length === 0) {
        this.allHistoryLoaded = true;
      } else {
        this.loadMessages();
      }
    } catch (err) {
      console.error('Failed to fetch older messages:', err);
    }

    this.loadingOlder = false;

    requestAnimationFrame(() => {
      if (el) {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = newScrollHeight - prevScrollHeight;
      }
    });
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.messagesEl) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    });
  }

  private handleScroll() {
    if (!this.messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    this.autoScroll = scrollHeight - scrollTop - clientHeight < 50;

    if (scrollTop < 80 && !this.loadingOlder && !this.allHistoryLoaded) {
      this.fetchOlderMessages();
    }
  }

  private async sendMessage() {
    const text = this.inputText.trim();
    if (!text || !this.chatbox) return;

    this.inputText = '';
    try {
      await this.chatbox.sendMessage({ body: text });
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

  private handleInput(e: Event) {
    this.inputText = (e.target as HTMLTextAreaElement).value;
    try {
      this.chatbox?.setChatState('composing');
    } catch {
      // ignore
    }
  }

  private toggleOmemo() {
    if (!this.chatbox) return;
    const newState = !this.omemoActive;
    this.chatbox.set('omemo_active', newState);
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
    if (!this.chatbox) return;

    this.uploading = true;
    this.uploadProgress = 0;
    this.uploadError = '';

    try {
      await uploadAndSend(this.chatbox, file, (p: UploadProgress) => {
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
    this.dispatchEvent(
      new CustomEvent('back', { bubbles: true, composed: true }),
    );
  }

  private get presenceText(): string {
    if (this.contactPresence !== 'online') return 'Offline';
    switch (this.contactShow) {
      case 'away': return 'Away';
      case 'xa': return 'Extended away';
      case 'dnd': return 'Do not disturb';
      default: return 'Online';
    }
  }

  private get presenceColor(): string {
    if (this.contactPresence !== 'online') return '#94a3b8';
    switch (this.contactShow) {
      case 'away': case 'xa': return '#f59e0b';
      case 'dnd': return '#ef4444';
      default: return '#22c55e';
    }
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

    .header-avatar {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 50%;
      background: var(--color-avatar-bg-light);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-avatar-text-light);
      flex-shrink: 0;
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

    .header-status {
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .header-status-dot {
      width: 0.4375rem;
      height: 0.4375rem;
      border-radius: 50%;
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

    /* Messages */
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

    .load-more {
      text-align: center;
      padding: 0.5rem;
    }

    .load-more-spinner {
      display: inline-block;
      width: 1.25rem;
      height: 1.25rem;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    .history-end {
      text-align: center;
      font-size: 0.75rem;
      color: var(--color-text-muted);
      padding: 0.5rem;
    }

    .msg {
      max-width: 75%;
      padding: 0.5rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.875rem;
      line-height: 1.45;
      word-wrap: break-word;
      overflow-wrap: break-word;
      position: relative;
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

    .msg.error {
      background: var(--color-error-bg);
      color: var(--color-error);
      border: 1px solid var(--color-error-border);
    }

    .msg-meta {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin-top: 0.25rem;
      font-size: 0.6875rem;
      opacity: 0.7;
    }

    .msg.me .msg-meta { justify-content: flex-end; }

    .typing-indicator {
      align-self: flex-start;
      padding: 0.5rem 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }

    .typing-dots {
      display: flex;
      gap: 3px;
    }

    .typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-text-muted);
      animation: bounce-dot 1.4s ease-in-out infinite;
    }

    .typing-dots span:nth-child(2) { animation-delay: 0.16s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.32s; }

    @keyframes bounce-dot {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
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

    .empty-chat p {
      margin: 0;
      font-size: 0.875rem;
    }

    .empty-chat .subtitle {
      font-size: 0.8125rem;
      color: var(--color-text-secondary);
    }

    /* Input */
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

    .input-bar textarea:focus {
      border-color: var(--color-border-focus);
      background: var(--color-bg-card);
    }

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

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;

  private renderMessageBody(msg: MessageInfo) {
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

  private renderMessage(msg: MessageInfo) {
    const cls = `msg ${msg.sender}${msg.isError ? ' error' : ''}`;
    return html`
      <div class=${cls}>
        ${this.renderMessageBody(msg)}
        <div class="msg-meta">
          ${msg.isEncrypted ? html`<span title="Encrypted">&#x1F512;</span>` : nothing}
          ${msg.isEdited ? html`<span>edited</span>` : nothing}
          <span>${msg.time}</span>
        </div>
      </div>
    `;
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
      items.push(this.renderMessage(msg));
    }

    return items;
  }

  render() {
    const initials = this.contactName
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');

    return html`
      <div class="header">
        <button class="back-btn" @click=${this.handleBack} aria-label="Go back">&larr;</button>
        <div class="header-avatar">${initials}</div>
        <div class="header-info">
          <div class="header-name">${this.contactName}</div>
          <div class="header-status">
            <span class="header-status-dot" style="background: ${this.presenceColor}"></span>
            <span style="color: ${this.presenceColor}">${this.presenceText}</span>
          </div>
        </div>
        <button
          class="omemo-btn ${this.omemoActive ? 'active' : ''}"
          @click=${this.toggleOmemo}
          title="${this.omemoActive ? 'OMEMO encryption enabled' : 'OMEMO encryption disabled'}"
          aria-label="${this.omemoActive ? 'Disable OMEMO' : 'Enable OMEMO'}"
        >
          ${this.omemoActive ? '\u{1F512}' : '\u{1F513}'}
        </button>
      </div>

      ${this.dragOver ? html`<div class="drag-overlay">Drop file to upload</div>` : nothing}

      ${this.loading
        ? html`<div class="loading"><skeleton-loader rows="5" variant="message"></skeleton-loader></div>`
        : html`
            <div class="messages" @scroll=${this.handleScroll}
              @dragover=${this.handleDragOver} @dragleave=${this.handleDragLeave} @drop=${this.handleDrop}
              role="log" aria-label="Messages">
              ${this.allHistoryLoaded
                ? html`<div class="history-end">Beginning of conversation</div>`
                : nothing}
              ${this.loadingOlder
                ? html`<div class="load-more"><span class="load-more-spinner"></span></div>`
                : nothing}
              ${this.messages.length === 0
                ? html`<div class="empty-chat">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <p>No messages yet</p>
                    <p class="subtitle">Send a message to start the conversation</p>
                  </div>`
                : this.renderMessages()}
              ${this.theirChatState === 'composing'
                ? html`<div class="typing-indicator">
                    <div class="typing-dots"><span></span><span></span><span></span></div>
                    ${this.contactName} is typing
                  </div>`
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
          placeholder="Type a message..."
          .value=${this.inputText}
          @input=${this.handleInput}
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
