import type { ConnectionStatus, XMPPConfig } from '@/types';
import { events, CONNECTION_STATUS_CHANGED, LOGGED_OUT } from './events';

// Import headless-only build — no UI plugins, just XMPP protocol handling
import 'converse.js';

let initialized = false;
let currentStatus: ConnectionStatus = 'disconnected';

// Captured from inside the plugin — the only way to access the internal API
let _api: any = null;
let _converse_ref: any = null;

function getConverse(): any {
  return (window as any).converse;
}

function setStatus(status: ConnectionStatus) {
  currentStatus = status;
  events.emit(CONNECTION_STATUS_CHANGED, status);
}

export function getConnectionStatus(): ConnectionStatus {
  return currentStatus;
}

/**
 * Load libsignal for OMEMO support.
 * Loaded via script tag to avoid Vite/Rollup bundling issues.
 */
function loadLibsignal(): Promise<void> {
  if ((window as any).libsignal) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = '/libsignal-protocol.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn('libsignal not available — OMEMO will be disabled');
      resolve();
    };
    document.head.appendChild(script);
  });
}

/**
 * Initialize the Converse.js headless client.
 * Call once at app startup.
 */
export async function initClient(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const converse = getConverse();

  // Register our bridge plugin to capture connection events and the internal API
  converse.plugins.add('xmpp2-bridge', {
    initialize() {
      _converse_ref = (this as any)._converse;
      _api = _converse_ref.api;

      _api.listen.on('connected', () => setStatus('connected'));
      _api.listen.on('reconnected', () => setStatus('connected'));
      _api.listen.on('disconnected', () => setStatus('disconnected'));
      _api.listen.on('will-reconnect', () => setStatus('reconnecting'));
      _api.listen.on('logout', () => {
        setStatus('disconnected');
        events.emit(LOGGED_OUT);
      });
    },
  });
}

/**
 * Log in to the XMPP server.
 */
export async function login(config: XMPPConfig): Promise<void> {
  setStatus('connecting');

  // Load libsignal before initializing converse for OMEMO support
  await loadLibsignal();

  try {
    const converse = getConverse();
    const settings: Record<string, any> = {
      authentication: 'login',
      jid: config.jid,
      password: config.password,
      auto_login: true,
      auto_reconnect: true,
      discover_connection_methods: true,
      persistent_store: 'IndexedDB',
      clear_cache_on_logout: false,
      loglevel: 'info',
      whitelisted_plugins: ['xmpp2-bridge'],
      keepalive: true,
      allow_non_roster_messaging: true,
      trusted: true,
      omemo_default: false,
    };

    if (config.websocketUrl) {
      settings.websocket_url = config.websocketUrl;
    }

    await converse.initialize(settings);
  } catch (err) {
    setStatus('error');
    throw err;
  }
}

/**
 * Attempt auto-login using stored SCRAM keys (no credentials needed).
 * Returns true if login succeeded, false otherwise.
 */
export async function tryAutoLogin(): Promise<boolean> {
  setStatus('connecting');
  await loadLibsignal();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Timeout after 10s
    const timer = setTimeout(() => settle(false), 10000);

    // Listen for success/failure
    const onConnected = () => { clearTimeout(timer); settle(true); };
    const onDisconnected = () => { clearTimeout(timer); settle(false); };

    events.on(CONNECTION_STATUS_CHANGED, (status: ConnectionStatus) => {
      if (status === 'connected') onConnected();
      else if (status === 'disconnected' || status === 'error') onDisconnected();
    });

    const converse = getConverse();
    converse.initialize({
      authentication: 'login',
      auto_login: true,
      auto_reconnect: true,
      discover_connection_methods: true,
      persistent_store: 'IndexedDB',
      clear_cache_on_logout: false,
      loglevel: 'info',
      whitelisted_plugins: ['xmpp2-bridge'],
      keepalive: true,
      reuse_scram_keys: true,
      allow_non_roster_messaging: true,
      trusted: true,
      omemo_default: false,
    }).catch(() => { clearTimeout(timer); settle(false); });
  });
}

/**
 * Log out and disconnect.
 */
export async function logout(): Promise<void> {
  try {
    await _api?.user?.logout();
  } catch {
    // Ignore errors during logout
  }
  localStorage.removeItem('conversejs-session-jid');
  setStatus('disconnected');
}

/** Access the Converse.js internal API (captured from the bridge plugin) */
export function getApi(): any {
  return _api;
}

/** Access the internal _converse object (for state access) */
export function getConverseInternal(): any {
  return _converse_ref;
}
