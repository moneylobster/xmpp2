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

export function isImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type);
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
    if (hash.length < 88) return null; // need at least 24 (IV) + 64 (key)

    const keyHex = hash.substring(hash.length - 64);
    const ivHex = hash.substring(0, hash.length - 64);

    const iv = hexToUint8Array(ivHex);
    const keyBuf = hexToUint8Array(keyHex);

    // Download the encrypted file via HTTPS (without the fragment)
    // Can't use url.origin because unknown protocols return "null"
    const httpsUrl = `https://${url.host}${url.pathname}${url.search}`;
    const response = await fetch(httpsUrl);
    if (!response.ok) return null;
    const cipher = await response.arrayBuffer();

    // Decrypt
    const cryptoKey = await crypto.subtle.importKey('raw', keyBuf.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, cryptoKey, cipher);

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

function hexToUint8Array(hex: string): Uint8Array {
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
export async function uploadAndSend(
  chatbox: any,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  if (!chatbox?.sendFiles) throw new Error('File upload not supported');

  return new Promise<void>((resolve, reject) => {
    // Listen for the message that sendFiles creates so we can track progress
    const onAdd = (message: any) => {
      if (!message.file) return;

      const onProgressChange = () => {
        const progress = message.get('progress') || 0;
        onProgress?.({ loaded: 0, total: 0, percent: Math.round(progress) });
      };

      const onError = () => {
        const errorText = message.get('error_text') || message.get('message');
        cleanup();
        reject(new Error(errorText || 'Upload failed'));
      };

      const onUploaded = () => {
        // Upload complete when 'get' URL is set and body is set
        if (message.get('get') || message.get('oob_url')) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        message.off('change:progress', onProgressChange);
        message.off('change:error_type', onError);
        message.off('change:body', onUploaded);
        message.off('change:oob_url', onUploaded);
        chatbox.messages.off('add', onAdd);
      };

      message.on('change:progress', onProgressChange);
      message.on('change:error_type', onError);
      message.on('change:body', onUploaded);
      message.on('change:oob_url', onUploaded);

      // If it errors immediately (e.g. upload service not found)
      if (message.get('error_type')) {
        onError();
        return;
      }

      // If somehow it completed already
      if (message.get('body') || message.get('oob_url')) {
        cleanup();
        resolve();
        return;
      }

      // Timeout after 5 minutes
      setTimeout(() => {
        cleanup();
        reject(new Error('Upload timed out'));
      }, 5 * 60 * 1000);
    };

    chatbox.messages.on('add', onAdd);

    try {
      chatbox.sendFiles([file]);
    } catch (err: any) {
      chatbox.messages.off('add', onAdd);
      reject(err);
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
