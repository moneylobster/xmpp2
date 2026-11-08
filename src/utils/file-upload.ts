/** File upload utilities using Converse.js HTTP File Upload (XEP-0363) */

import { getApi } from '@/xmpp/client';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface FileValidation {
  valid: boolean;
  error?: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

export function validateFile(file: File): FileValidation {
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `File too large (${sizeMB} MB). Maximum is 50 MB.` };
  }
  if (file.size === 0) {
    return { valid: false, error: 'File is empty.' };
  }
  return { valid: true };
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

export function isImageFile(file: File): boolean {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return true;
  // Fallback: check extension (file.type can be empty or spoofed)
  const ext = file.name.toLowerCase().split('.').pop();
  return ext ? IMAGE_EXTENSIONS.includes(`.${ext}`) : false;
}

export function isImageUrl(url: string): boolean {
  try {
    // For aesgcm:// URLs, replace protocol so URL parser handles it
    const normalized = url.startsWith('aesgcm://') ? url.replace('aesgcm://', 'https://') : url;
    const path = new URL(normalized).pathname.toLowerCase();
    return /\.(jpe?g|png|gif|webp|svg)$/.test(path);
  } catch {
    return false;
  }
}

export function isAesgcmUrl(url: string): boolean {
  return url.trim().startsWith('aesgcm://');
}

/** Convert aesgcm:// URL to https:// (stripping the fragment). */
function aesgcmToHttps(url: string): string {
  return url.replace(/^aesgcm:\/\//, 'https://');
}

/** MIME type lookup by extension for decrypted files. */
const EXT_MIMETYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
  mp3: 'audio/mpeg', pdf: 'application/pdf',
};

/**
 * Fetch and decrypt an aesgcm:// URL.
 * Returns a blob: URL suitable for <img src> or <a href>.
 *
 * URL format: aesgcm://host/path/file.ext#<IV_hex><Key_hex>
 *   IV  = 12 bytes = 24 hex chars
 *   Key = 32 bytes = 64 hex chars  (last 64 chars of fragment)
 */
export async function decryptAesgcmUrl(aesgcmUrl: string): Promise<string | null> {
  try {
    const url = new URL(aesgcmUrl);
    const hash = url.hash.slice(1); // strip #
    // XEP-0454 fragment: 12-byte IV (24 hex) followed by 32-byte key (64 hex).
    if (hash.length < 88 || !/^[0-9a-f]+$/i.test(hash)) return null;

    const iv = hexToUint8Array(hash.slice(0, 24));
    const keyBuf = hexToUint8Array(hash.slice(-64));

    // Download the encrypted file via HTTPS (without the fragment)
    // Can't use url.origin because unknown protocols return "null"
    const httpsUrl = `https://${url.host}${url.pathname}${url.search}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    try {
      response = await fetch(httpsUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE) return null;
    const cipher = await response.arrayBuffer();

    // Decrypt
    const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);

    // Determine MIME type from extension
    const filename = url.pathname.split('/').pop() || 'file';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimetype = EXT_MIMETYPES[ext] || 'application/octet-stream';

    const blob = new Blob([plaintext], { type: mimetype });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('Failed to decrypt aesgcm file:', err);
    return null;
  }
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload a file via HTTP File Upload (XEP-0363) using Converse.js's
 * built-in chatbox.sendFiles() which handles slot discovery, upload, and messaging.
 *
 * We listen to the message model's progress/error attributes for feedback.
 */
interface UploadMessage {
  file?: unknown;
  get(attr: string): unknown;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

interface UploadChatbox {
  sendFiles?(files: File[]): unknown;
  messages: {
    on(event: 'add', handler: (message: UploadMessage) => void): void;
    off(event: 'add', handler: (message: UploadMessage) => void): void;
  };
}

export async function uploadAndSend(
  chatbox: UploadChatbox,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const sendFiles = chatbox?.sendFiles;
  if (!sendFiles) throw new Error('File upload not supported');

  return new Promise<void>((resolve, reject) => {
    let message: UploadMessage | null = null;
    let settled = false;
    let timeout: number | undefined;

    function cleanup() {
      clearTimeout(timeout);
      if (message) {
        message.off('change:progress', onProgressChange);
        message.off('change:error_type', onError);
        message.off('change:body', onUploaded);
        message.off('change:oob_url', onUploaded);
      }
      chatbox.messages.off('add', onAdd);
    }

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    }

    function onProgressChange() {
      if (!message) return;
      const progress = Number(message.get('progress')) || 0;
      onProgress?.({ loaded: 0, total: 0, percent: Math.round(progress) });
    }

    function onError() {
      const errorText = message?.get('error_text') || message?.get('message');
      finish(new Error(typeof errorText === 'string' && errorText ? errorText : 'Upload failed'));
    }

    function onUploaded() {
      // Upload complete when a 'get' URL is set and the body is populated.
      if (message && (message.get('get') || message.get('oob_url'))) finish();
    }

    // Listen for the message that sendFiles creates so we can track progress.
    function onAdd(added: UploadMessage) {
      // Ignore unrelated messages and duplicate adds.
      if (settled || !added.file || message) return;
      message = added;
      message.on('change:progress', onProgressChange);
      message.on('change:error_type', onError);
      message.on('change:body', onUploaded);
      message.on('change:oob_url', onUploaded);

      if (message.get('error_type')) {
        onError();
      } else if (message.get('body') || message.get('oob_url')) {
        finish();
      }
    }

    timeout = window.setTimeout(() => finish(new Error('Upload timed out')), 5 * 60 * 1000);
    chatbox.messages.on('add', onAdd);

    try {
      Promise.resolve(sendFiles([file])).catch((err: unknown) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Get files from a paste event (clipboard).
 */
export function getFilesFromPaste(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * Get files from a drop event.
 */
export function getFilesFromDrop(e: DragEvent): File[] {
  const dt = e.dataTransfer;
  if (!dt) return [];
  return Array.from(dt.files);
}
