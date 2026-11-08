import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state, property, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getApi } from '@/xmpp/client';
import {
  getMessageBody, formatTime, dateKey, formatDateLabel, trackOmemo,
  splitLinks, getSingleHttpUrl, type TextSegment,
} from '@/utils/chat-utils';
import {
  uploadAndSend, validateFile, isImageUrl, isFileUrl, fileNameFromUrl, formatFileSize,
  getFilesFromPaste, getFilesFromDrop, isAesgcmUrl, decryptAesgcmUrl,
  type UploadProgress,
} from '@/utils/file-upload';
import { hapticLight } from '@/utils/haptics';
import { clearUnread } from '@/utils/unread';
import { autoResizeTextarea } from '@/utils/textarea';
import { suppressOwnMessageNotifications } from '@/utils/push';
import { getReply } from '@/utils/replies';
import { getAvatar } from '@/utils/avatar';
import { getReactions, sendReaction, type ReactionSummary } from '@/utils/reactions';
import { toast } from './notification-toast';
import {
  getDraft, setDraft, clearDraft, isMuted, isPinned, isArchived,
  setMuted, setPinned, setArchived,
} from '@/utils/preferences';
import './skeleton-loader';
import './chat-info';
import './media-lightbox';
import './emoji-picker';
import type { InfoMediaItem } from './chat-info';

interface MessageInfo {
  id: string;
  msgid: string;
  body: string;
  sender: 'me' | 'them';
  time: string;
  timeISO: string;
  dateKey: string;
  isError: boolean;
  isEdited: boolean;
  isEncrypted: boolean;
  decryptedUrl?: string | null;
  retracted: boolean;
  editable: boolean;
  received: boolean;
  displayed: boolean;
  model: MessageModel;
  replyToBody: string;
  replyToName: string;
  reactions: ReactionSummary[];
}

interface MessageModel {
  get(attr: string): unknown;
  save?(attrs: Record<string, unknown>): unknown;
  cid?: string;
}

@customElement('chat-view')
export class ChatView extends LitElement {
  @property({ type: String }) jid = '';
  @property({ type: Boolean }) connected = true;
  @state() private messages: MessageInfo[] = [];
  @state() private inputText = '';
  @state() private contactName = '';
  @state() private contactPresence = 'offline';
  @state() private avatarUrl = '';
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
  @state() private showInfo = false;
  @state() private pinned = false;
  @state() private muted = false;
  @state() private archived = false;
  @state() private firstUnreadId = '';
  @state() private showJump = false;
  @state() private actionMessage: MessageInfo | null = null;
  @state() private editingMessage: MessageInfo | null = null;
  @state() private replyTo: MessageInfo | null = null;
  @state() private lightboxOpen = false;
  @state() private lightboxUrl = '';
  @state() private lightboxName = '';
  @state() private emojiOpen = false;

  @query('.messages') private messagesEl!: HTMLElement;
  @query('#file-input') private fileInput!: HTMLInputElement;
  @query('#message-input') private inputEl!: HTMLTextAreaElement;

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

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('jid') && this.jid) {
      this.teardown();
      this.openChat();
    }
  }

  private teardown() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    // Revoke decrypted blob URLs so switching chats doesn't leak object URLs.
    for (const url of this.decryptedCache.values()) {
      if (url) URL.revokeObjectURL(url);
    }
    this.decryptedCache.clear();
    this.chatbox = null;
    this.messages = [];
    this.inputText = '';
    this.theirChatState = '';
    this.allHistoryLoaded = false;
    this.loadingOlder = false;
    this.restoringScroll = false;
    this.omemoActive = false;
    this.omemoSupported = false;
    this.showInfo = false;
    this.firstUnreadId = '';
    this.showJump = false;
    this.actionMessage = null;
    this.editingMessage = null;
    this.replyTo = null;
    this.lightboxOpen = false;
    this.lightboxUrl = '';
    this.lightboxName = '';
    this.emojiOpen = false;
    this.avatarUrl = '';
  }

  private openLightbox(url: string, name: string) {
    this.lightboxUrl = url;
    this.lightboxName = name;
    this.lightboxOpen = true;
  }

  private async openChat() {
    const api = getApi();
    if (!api || !this.jid) return;
    this.loading = true;
    this.pinned = isPinned(this.jid);
    this.muted = isMuted(this.jid);
    this.archived = isArchived(this.jid);
    this.inputText = getDraft(this.jid);

    try {
      const contact = await api.contacts.get(this.jid);
      if (contact) {
        this.contactName = contact.getDisplayName() || this.jid;
        this.avatarUrl = getAvatar(contact.vcard);
        this.contactPresence = contact.getStatus?.() || contact.presence?.getStatus?.() || 'offline';

        const presHandler = () => {
          this.contactPresence = contact.getStatus?.() || contact.presence?.getStatus?.() || 'offline';
        };
        contact.on('presence:change', presHandler);
        this.cleanups.push(() => {
          contact.off('presence:change', presHandler);
        });
      } else {
        this.contactName = this.jid;
      }
    } catch {
      this.contactName = this.jid;
    }

    try {
      this.chatbox = await api.chats.open(this.jid, {}, true);
      if (!this.chatbox) {
        this.loading = false;
        return;
      }

      if (this.chatbox.messages?.fetched) {
        await this.chatbox.messages.fetched;
      }

      // Capture the first unread message before clearing the counter, so the
      // conversation can render a "New messages" divider at that point.
      this.firstUnreadId = String(this.chatbox.get('first_unread_id') || '');

      // Clear unread count when chat is opened.
      void clearUnread(this.chatbox);

      this.loadMessages();
      this.loading = false;
      this.scrollToBottom();
      this.updateComplete.then(() => autoResizeTextarea(this.inputEl));

      const addHandler = () => {
        this.loadMessages();
        if (this.autoScroll) {
          this.scrollToBottom();
          // User is at the bottom and viewing this chat, so it is being read.
          void clearUnread(this.chatbox);
        }
      };
      this.chatbox.messages.on('add', addHandler);
      this.chatbox.messages.on('change', addHandler);
      this.cleanups.push(() => {
        this.chatbox?.messages?.off('add', addHandler);
        this.chatbox?.messages?.off('change', addHandler);
      });

      const reactionsHandler = () => this.loadMessages();
      window.addEventListener('reactions-changed', reactionsHandler);
      this.cleanups.push(() => window.removeEventListener('reactions-changed', reactionsHandler));

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
      .filter((m: MessageModel) => {
        const body = m.get('body');
        const type = m.get('type');
        return (!!body || !!m.get('retracted')) && (type === 'chat' || type === 'normal' || !type);
      })
      .map((m: MessageModel) => {
        const timeISO = String(m.get('time') || '');
        const msgid = String(m.get('msgid') || m.get('id') || m.cid || '');
        const retracted = !!m.get('retracted');
        const body = retracted ? 'Message deleted' : getMessageBody(m);
        const reply = getReply(msgid) ||
          (m.get('reply_to')
            ? { id: String(m.get('reply_to')), to: String(m.get('reply_to_jid') || '') }
            : undefined);
        const quoted = reply
          ? (this.chatbox?.messages?.models as MessageModel[] | undefined)?.find(
              (x) => String(x.get('msgid')) === reply.id,
            )
          : undefined;
        return {
          id: msgid,
          msgid,
          body,
          sender: m.get('sender') === 'me' ? 'me' as const : 'them' as const,
          time: formatTime(timeISO),
          timeISO,
          dateKey: dateKey(timeISO),
          isError: !!m.get('is_error'),
          isEdited: !!m.get('edited'),
          isEncrypted: !!m.get('is_encrypted'),
          decryptedUrl: isAesgcmUrl(body) ? (this.decryptedCache.get(body) ?? undefined) : undefined,
          retracted,
          editable: !!m.get('editable'),
          received: !!m.get('received'),
          displayed: !!m.get('marker_displayed'),
          model: m,
          replyToBody: quoted ? getMessageBody(quoted) : '',
          replyToName: quoted
            ? (quoted.get('sender') === 'me'
                ? 'You'
                : String(quoted.get('nick') || this.contactName || 'Message'))
            : '',
          reactions: getReactions(msgid),
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

  private restoringScroll = false;

  private async fetchOlderMessages() {
    if (this.loadingOlder || this.allHistoryLoaded || !this.chatbox) return;

    const api = getApi();
    if (!api) return;

    this.loadingOlder = true;

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

    // Capture scroll height before re-render removes spinner
    const el = this.messagesEl;
    const prevScrollHeight = el?.scrollHeight || 0;

    this.loadingOlder = false;

    // Wait for Lit to re-render, then restore scroll position
    await this.updateComplete;
    if (el) {
      this.restoringScroll = true;
      el.scrollTop = el.scrollHeight - prevScrollHeight;
      // Allow handleScroll to work again after a tick
      requestAnimationFrame(() => { this.restoringScroll = false; });
    }
  }

  private scrollToBottom() {
    this.autoScroll = true;
    this.showJump = false;
    requestAnimationFrame(() => {
      if (this.messagesEl) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    });
  }

  private handleScroll() {
    if (!this.messagesEl || this.restoringScroll) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    this.autoScroll = scrollHeight - scrollTop - clientHeight < 50;
    this.showJump = !this.autoScroll && this.messages.length > 0;

    if (scrollTop < 80 && !this.loadingOlder && !this.allHistoryLoaded) {
      this.fetchOlderMessages();
    }
  }

  private async sendMessage() {
    const text = this.inputText.trim();
    if (!text || !this.chatbox || !this.connected) return;

    try {
      const attrs: Record<string, unknown> = { body: text };
      if (this.replyTo) {
        attrs.reply_to = this.replyTo.msgid;
        attrs.reply_to_jid = String(this.replyTo.model.get('from') || '');
      }
      await this.chatbox.sendMessage(attrs);
      // Only clear after a successful send so a failed send doesn't lose the draft.
      this.inputText = '';
      clearDraft(this.jid);
      this.replyTo = null;
      this.editingMessage = null;
      await this.updateComplete;
      autoResizeTextarea(this.inputEl);
      suppressOwnMessageNotifications();
      hapticLight();
      this.autoScroll = true;
      this.scrollToBottom();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  private startReply() {
    if (!this.actionMessage) return;
    this.replyTo = this.actionMessage;
    this.actionMessage = null;
    this.updateComplete.then(() => this.inputEl?.focus());
  }

  private startEdit() {
    const msg = this.actionMessage;
    if (!msg || !msg.editable || msg.retracted) return;
    try {
      msg.model.save?.({ correcting: true });
    } catch (err) {
      console.error('Failed to start edit:', err);
      return;
    }
    this.editingMessage = msg;
    this.inputText = msg.body;
    this.actionMessage = null;
    this.updateComplete.then(() => {
      this.inputEl?.focus();
      autoResizeTextarea(this.inputEl);
    });
  }

  private cancelEdit() {
    try {
      this.editingMessage?.model.save?.({ correcting: false });
    } catch {
      // ignore
    }
    this.editingMessage = null;
    this.inputText = '';
    clearDraft(this.jid);
  }

  private async copyMessage() {
    const msg = this.actionMessage;
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.body);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
    this.actionMessage = null;
  }

  private async retractMessage() {
    const msg = this.actionMessage;
    if (!msg || !this.chatbox) return;
    try {
      await this.chatbox.retractOwnMessage(msg.model);
      this.loadMessages();
    } catch (err) {
      console.error('Failed to retract message:', err);
      toast.error('Could not delete message');
    }
    this.actionMessage = null;
  }

  private react(msg: MessageInfo, emoji: string) {
    if (!this.chatbox) return;
    sendReaction(this.chatbox, msg.msgid, emoji);
    this.actionMessage = null;
    this.loadMessages();
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  private handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    this.inputText = target.value;
    setDraft(this.jid, this.inputText);
    autoResizeTextarea(target);
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

  private notifyPrefs() {
    window.dispatchEvent(new CustomEvent('chat-prefs-changed'));
  }

  private togglePin() {
    this.pinned = !this.pinned;
    setPinned(this.jid, this.pinned);
    this.notifyPrefs();
  }

  private toggleMute() {
    this.muted = !this.muted;
    setMuted(this.jid, this.muted);
    this.notifyPrefs();
  }

  private toggleArchive() {
    this.archived = !this.archived;
    setArchived(this.jid, this.archived);
    this.notifyPrefs();
  }

  private insertEmoji(e: CustomEvent) {
    const emoji = String(e.detail || '');
    if (!emoji) return;
    this.inputText += emoji;
    setDraft(this.jid, this.inputText);
    this.emojiOpen = false;
    this.updateComplete.then(() => {
      this.inputEl?.focus();
      autoResizeTextarea(this.inputEl);
    });
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
    } catch (err) {
      console.error('File upload failed:', err);
      this.uploadError = err instanceof Error ? err.message : 'Upload failed';
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
    switch (this.contactPresence) {
      case 'online': case 'chat': return 'Online';
      case 'away': return 'Away';
      case 'xa': return 'Extended away';
      case 'dnd': return 'Do not disturb';
      default: return 'Offline';
    }
  }

  private get presenceColor(): string {
    switch (this.contactPresence) {
      case 'online': case 'chat': return '#22c55e';
      case 'away': case 'xa': return '#f59e0b';
      case 'dnd': return '#ef4444';
      default: return '#94a3b8';
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
      overflow: hidden;
    }

    .header-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .header-main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
      min-width: 0;
      cursor: pointer;
    }

    .header-main:focus-visible {
      outline: 2px solid var(--color-border-focus);
      outline-offset: 2px;
      border-radius: 0.5rem;
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

    .msg.retracted { opacity: 0.65; font-style: italic; }

    .msg-menu {
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
      font-size: 0.875rem;
      line-height: 1;
      padding: 0 0.125rem;
      opacity: 0.6;
    }

    .msg-menu:hover { opacity: 1; }

    .receipt { letter-spacing: -0.1em; }

    .quoted {
      border-left: 2px solid var(--color-primary);
      padding: 0.25rem 0.5rem;
      margin-bottom: 0.25rem;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 0.25rem;
      font-size: 0.75rem;
    }

    .msg.me .quoted { background: rgba(255, 255, 255, 0.15); }

    .quoted-name { font-weight: 600; opacity: 0.85; }

    .quoted-body {
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .reactions {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;
    }

    .reaction {
      border: 1px solid var(--color-border);
      background: var(--color-bg-card);
      border-radius: 0.75rem;
      padding: 0 0.375rem;
      font-size: 0.75rem;
      cursor: pointer;
      color: inherit;
    }

    .msg.me .reaction { background: rgba(255, 255, 255, 0.15); border-color: transparent; }

    .unread-divider {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--color-primary);
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0.5rem 0;
    }

    .unread-divider::before,
    .unread-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-primary);
      opacity: 0.3;
    }

    .jump-btn {
      position: absolute;
      right: 1rem;
      bottom: 4.5rem;
      z-index: 5;
      border: none;
      border-radius: 999px;
      background: var(--color-primary);
      color: #fff;
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      box-shadow: var(--shadow-card);
    }

    .compose-context {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--color-bg-card);
      border-top: 1px solid var(--color-border);
      font-size: 0.75rem;
    }

    .compose-context > div { flex: 1; min-width: 0; }

    .compose-context-body {
      opacity: 0.7;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .compose-context button {
      border: none;
      background: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      font-size: 1rem;
    }

    .action-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      z-index: 200;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    .action-sheet {
      background: var(--color-bg-card);
      border-radius: 1rem 1rem 0 0;
      padding: 0.5rem;
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .action {
      border: none;
      background: none;
      text-align: left;
      padding: 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      color: var(--color-text);
      cursor: pointer;
    }

    .action:hover { background: var(--color-bg-hover); }
    .action.danger { color: var(--color-error); }

    .reaction-row {
      display: flex;
      justify-content: space-around;
      padding: 0.25rem 0.5rem 0.5rem;
      border-bottom: 1px solid var(--color-border);
    }

    .reaction-row button {
      border: none;
      background: none;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem;
    }

    .msg a {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      word-break: break-word;
    }

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
      /* Bottom inset is already applied by html's padding-bottom; don't re-add it. */
      padding: 0.75rem 1rem;
      background: var(--color-bg-card);
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .input-bar textarea {
      flex: 1;
      border: 1px solid var(--color-border);
      border-radius: 1.25rem;
      padding: 0.375rem 0.75rem;
      font-size: 0.875rem;
      font-family: inherit;
      resize: none;
      outline: none;
      max-height: 120px;
      line-height: 1.25;
      color: var(--color-text);
      background: var(--color-bg-input);
      box-sizing: border-box;
      overflow-y: hidden;
      transition: border-color var(--duration-fast), background var(--duration-fast);
    }

    .input-bar textarea:focus {
      border-color: var(--color-border-focus);
      background: var(--color-bg-card);
    }

    .send-btn {
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--color-primary);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 0;
      box-sizing: border-box;
      transition: background var(--duration-fast), transform var(--duration-fast);
    }

    .send-btn:hover { background: var(--color-primary-hover); }
    .send-btn:active { transform: scale(0.93); }
    .send-btn:disabled { background: var(--color-text-muted); cursor: default; }
    .send-btn:disabled:active { transform: none; }
    .send-btn svg { width: 1.125rem; height: 1.125rem; display: block; }

    .attach-btn {
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 0;
      transition: color var(--duration-fast), transform var(--duration-fast);
    }

    .attach-btn:hover { color: var(--color-primary); }
    .attach-btn:active { transform: scale(0.93); }
    .attach-btn:disabled { color: var(--color-text-muted); cursor: default; }
    .attach-btn svg { width: 1.25rem; height: 1.25rem; display: block; }

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
      // Read the live cache (not the snapshot captured when the message list was built),
      // so the async decrypt's requestUpdate() actually swaps "Decrypting..." for the file.
      const blobUrl = this.decryptedCache.has(msg.body)
        ? this.decryptedCache.get(msg.body)
        : undefined;
      if (blobUrl === undefined || blobUrl === null) {
        return html`<div class="msg-file-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          ${blobUrl === null ? 'Decrypting...' : 'Encrypted file'}
        </div>`;
      }
      if (isImageUrl(body)) {
        return html`<img class="msg-image" src="${blobUrl}" alt="encrypted image" loading="lazy"
          @click=${() => this.openLightbox(blobUrl, fileNameFromUrl(body))} />`;
      }
      const parsed = new URL(body.replace('aesgcm://', 'https://'));
      const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'file');
      return html`<a class="msg-file-link" href="${blobUrl}" download="${filename}" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        ${filename}
      </a>`;
    }

    const single = getSingleHttpUrl(body);
    if (single) {
      if (isImageUrl(single)) {
        return html`<img class="msg-image" src="${single}" alt="image" loading="lazy"
          @click=${() => this.openLightbox(single, fileNameFromUrl(single))} />`;
      }
      const url = new URL(single);
      const filename = decodeURIComponent(url.pathname.split('/').pop() || 'file');
      return html`<a class="msg-file-link" href="${single}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        ${filename}
      </a>`;
    }
    return html`<div>${this.renderLinkedText(splitLinks(body))}</div>`;
  }

  private renderLinkedText(segments: TextSegment[]) {
    return segments.map((part) =>
      part.type === 'url'
        ? html`<a href=${part.value} target="_blank" rel="noopener noreferrer">${part.value}</a>`
        : part.value,
    );
  }

  private renderMessage(msg: MessageInfo) {
    const cls = `msg ${msg.sender}${msg.isError ? ' error' : ''}${msg.retracted ? ' retracted' : ''}`;
    const receipt = msg.displayed ? 'Read' : msg.received ? 'Delivered' : 'Sent';
    return html`
      <div class=${cls}>
        ${msg.replyToBody ? html`
          <div class="quoted">
            <div class="quoted-name">${msg.replyToName}</div>
            <div class="quoted-body">${msg.replyToBody}</div>
          </div>
        ` : nothing}
        ${this.renderMessageBody(msg)}
        ${msg.reactions.length ? html`
          <div class="reactions">
            ${msg.reactions.map((r) => html`
              <button class="reaction" @click=${() => this.react(msg, r.emoji)}>${r.emoji} ${r.count}</button>
            `)}
          </div>
        ` : nothing}
        <div class="msg-meta">
          ${msg.isEncrypted ? html`<span title="Encrypted">&#x1F512;</span>` : nothing}
          ${msg.isEdited ? html`<span>edited</span>` : nothing}
          ${msg.sender === 'me' && !msg.retracted
            ? html`<span class="receipt" title=${receipt}>${msg.displayed ? '✓✓' : msg.received ? '✓' : '…'}</span>`
            : nothing}
          <span>${msg.time}</span>
          <button class="msg-menu" @click=${(e: Event) => { e.stopPropagation(); this.actionMessage = msg; }}
            aria-label="Message actions">⋯</button>
        </div>
      </div>
    `;
  }

  private renderMessages() {
    const items: TemplateResult[] = [];
    let lastDateKey = '';
    let unreadShown = false;

    for (const msg of this.messages) {
      if (msg.dateKey !== lastDateKey) {
        items.push(html`
          <div class="date-separator">
            <span class="date-label">${formatDateLabel(msg.dateKey)}</span>
          </div>
        `);
        lastDateKey = msg.dateKey;
      }
      if (!unreadShown && this.firstUnreadId && msg.id === this.firstUnreadId) {
        items.push(html`<div class="unread-divider"><span>New messages</span></div>`);
        unreadShown = true;
      }
      items.push(this.renderMessage(msg));
    }

    return items;
  }

  private get mediaItems(): InfoMediaItem[] {
    const items: InfoMediaItem[] = [];
    const seen = new Set<string>();
    for (const msg of this.messages) {
      const body = msg.body.trim();
      if (isAesgcmUrl(body)) {
        const url = this.decryptedCache.get(body);
        if (typeof url === 'string' && !seen.has(body)) {
          seen.add(body);
          items.push({ url, name: fileNameFromUrl(body), isImage: isImageUrl(body) });
        }
        continue;
      }
      if (/^https?:\/\//i.test(body) && !/\s/.test(body) && isFileUrl(body) && !seen.has(body)) {
        seen.add(body);
        items.push({ url: body, name: fileNameFromUrl(body), isImage: isImageUrl(body) });
      }
    }
    return items;
  }

  private renderActionSheet() {
    const msg = this.actionMessage;
    if (!msg) return nothing;
    return html`
      <div class="action-overlay" @click=${() => (this.actionMessage = null)}>
        <div class="action-sheet" role="dialog" aria-label="Message actions"
          @click=${(e: Event) => e.stopPropagation()}>
          <div class="reaction-row">
            ${['👍', '❤️', '😂', '😮', '😢'].map((emoji) => html`
              <button @click=${() => this.react(msg, emoji)} aria-label="React ${emoji}">${emoji}</button>
            `)}
          </div>
          <button class="action" @click=${this.copyMessage}>Copy</button>
          <button class="action" @click=${this.startReply}>Reply</button>
          ${msg.sender === 'me' && msg.editable && !msg.retracted
            ? html`<button class="action" @click=${this.startEdit}>Edit</button>` : nothing}
          ${msg.sender === 'me' && !msg.retracted
            ? html`<button class="action danger" @click=${this.retractMessage}>Delete</button>` : nothing}
          <button class="action" @click=${() => (this.actionMessage = null)}>Cancel</button>
        </div>
      </div>
    `;
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
        <div
          class="header-main"
          role="button"
          tabindex="0"
          aria-label="Conversation info"
          @click=${() => (this.showInfo = true)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this.showInfo = true;
            }
          }}
        >
          <div class="header-avatar">
            ${this.avatarUrl ? html`<img src=${this.avatarUrl} alt="" />` : initials}
          </div>
          <div class="header-info">
            <div class="header-name">${this.contactName}</div>
            <div class="header-status">
              <span class="header-status-dot" style="background: ${this.presenceColor}"></span>
              <span style="color: ${this.presenceColor}">${this.presenceText}</span>
            </div>
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

      ${this.showJump
        ? html`<button class="jump-btn" @click=${this.scrollToBottom}>New messages ↓</button>`
        : nothing}

      ${this.uploadError ? html`<div class="upload-error">${this.uploadError}</div>` : nothing}
      ${this.uploading ? html`
        <div class="upload-bar">
          <div class="upload-progress">
            <div class="upload-progress-fill" style="width: ${this.uploadProgress}%"></div>
          </div>
        </div>
      ` : nothing}

      ${this.replyTo ? html`
        <div class="compose-context">
          <div>
            <strong>Replying to ${this.replyTo.sender === 'me' ? 'yourself' : this.contactName}</strong>
            <div class="compose-context-body">${this.replyTo.body}</div>
          </div>
          <button @click=${() => (this.replyTo = null)} aria-label="Cancel reply">×</button>
        </div>
      ` : nothing}
      ${this.editingMessage ? html`
        <div class="compose-context">
          <div>
            <strong>Editing message</strong>
            <div class="compose-context-body">${this.editingMessage.body}</div>
          </div>
          <button @click=${this.cancelEdit} aria-label="Cancel edit">×</button>
        </div>
      ` : nothing}

      <input type="file" id="file-input" hidden @change=${this.handleFileSelect} />
      <div class="input-bar">
        <button class="attach-btn" @click=${() => (this.emojiOpen = !this.emojiOpen)}
          title="Emoji" aria-label="Emoji">🙂</button>
        <button class="attach-btn" @click=${this.openFilePicker} ?disabled=${this.uploading || !this.connected} title="Attach file" aria-label="Attach file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <textarea
          id="message-input"
          rows="1"
          placeholder=${this.connected ? 'Type a message...' : 'Reconnecting…'}
          .value=${this.inputText}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
          @paste=${this.handlePaste}
          aria-label="Message input"
        ></textarea>
        <button
          class="send-btn"
          @click=${this.sendMessage}
          ?disabled=${!this.connected || !this.inputText.trim()}
          title="Send"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>

      ${this.renderActionSheet()}

      <emoji-picker
        .open=${this.emojiOpen}
        @close=${() => (this.emojiOpen = false)}
        @emoji-selected=${this.insertEmoji}
      ></emoji-picker>

      <media-lightbox
        .open=${this.lightboxOpen}
        .url=${this.lightboxUrl}
        .name=${this.lightboxName}
        @close=${() => (this.lightboxOpen = false)}
      ></media-lightbox>

      ${this.showInfo
        ? html`
            <chat-info
              title=${this.contactName}
              subtitle=${this.presenceText}
              jid=${this.jid}
              .media=${this.mediaItems}
              .omemoActive=${this.omemoActive}
              .omemoSupported=${this.omemoSupported}
              .pinned=${this.pinned}
              .muted=${this.muted}
              .archived=${this.archived}
              @close=${() => (this.showInfo = false)}
              @toggle-omemo=${this.toggleOmemo}
              @toggle-pin=${this.togglePin}
              @toggle-mute=${this.toggleMute}
              @toggle-archive=${this.toggleArchive}
            ></chat-info>
          `
        : nothing}
    `;
  }
}
