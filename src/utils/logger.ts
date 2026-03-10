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

function formatArgs(args: any[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a, null, 2); } catch { return String(a); }
  }).join(' ');
}

function addEntry(level: LogEntry['level'], args: any[]) {
  entries.push({ timestamp: Date.now(), level, message: formatArgs(args) });
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach(fn => fn());
}

/** Install console interceptors. Call once at app startup. */
export function installLogCapture() {
  console.log = (...args: any[]) => { originalLog(...args); addEntry('log', args); };
  console.warn = (...args: any[]) => { originalWarn(...args); addEntry('warn', args); };
  console.error = (...args: any[]) => { originalError(...args); addEntry('error', args); };
  console.info = (...args: any[]) => { originalInfo(...args); addEntry('info', args); };

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
