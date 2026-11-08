/**
 * In-app log capture.
 * Intercepts console.log/warn/error and stores entries in a ring buffer
 * for display in the debug log viewer.
 */

export interface LogEntry {
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;

function formatArgs(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a, null, 2); } catch { return String(a); }
  }).join(' ');
}

function addEntry(level: LogEntry['level'], args: unknown[]) {
  entries.push({ timestamp: Date.now(), level, message: formatArgs(args) });
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach(fn => fn());
}

let installed = false;

/** Install console interceptors. Call once at app startup. */
export function installLogCapture() {
  if (installed) return;
  installed = true;

  console.log = (...args: unknown[]) => { originalLog(...args); addEntry('log', args); };
  console.warn = (...args: unknown[]) => { originalWarn(...args); addEntry('warn', args); };
  console.error = (...args: unknown[]) => { originalError(...args); addEntry('error', args); };
  console.info = (...args: unknown[]) => { originalInfo(...args); addEntry('info', args); };

  // Capture uncaught errors
  window.addEventListener('error', (e) => {
    addEntry('error', [`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    addEntry('error', [`Unhandled rejection: ${e.reason}`]);
  });
}

/** Get all captured log entries */
export function getLogEntries(): readonly LogEntry[] {
  return entries;
}

/** Clear all log entries */
export function clearLogEntries() {
  entries.length = 0;
  listeners.forEach(fn => fn());
}

/** Subscribe to log updates. Returns unsubscribe function. */
export function onLogUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
