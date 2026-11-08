import type { FirebaseMessagingPlugin } from '@capacitor-firebase/messaging';
import { isNative, isAndroid, isIOS } from './platform';
import { getApi, getConverseInternal } from '@/xmpp/client';
import { events, CONNECTION_STATUS_CHANGED, PUSH_SERVER_NOT_FOUND } from '@/xmpp/events';
import type { ConnectionStatus } from '@/types';

/**
 * XEP-0357 Push Notifications with FCM (unified for Android & iOS).
 *
 * Uses @capacitor-firebase/messaging for unified FCM tokens on both platforms.
 * FCM proxies to APNs on iOS, so the push app server only talks to FCM.
 *
 * Android flow:
 *   1. FCM notification message arrives with generic "You have a new message"
 *   2. OS displays notification natively (no JS needed)
 *   3. When app opens, it reconnects to XMPP and fetches pending messages
 *
 * iOS flow:
 *   1. FCM notification message delivered via APNs
 *   2. OS displays notification natively
 *   3. When app opens, it reconnects and fetches full message history
 *
 * Server-side requirements:
 *   - XMPP server with XEP-0357 support (Snikket/Prosody: mod_cloud_notify)
 *   - Push app server at pushServerJid! that bridges XEP-0357 -> FCM
 *   - For Android: send data-only FCM messages with priority "high"
 *   - For iOS: send FCM messages with notification payload + content-available
 *   - Push app server should include platform hint from client registration
 *
 * Android setup: place google-services.json in android/app/
 * iOS setup: upload APNs .p8 key to Firebase Console, enable Push Notifications
 *            capability in Xcode, add GoogleService-Info.plist to ios/App/App/
 */

// -- Configuration --
export const PUSH_SERVER_KEY = 'xmpp-push-server-jid';
// The push node (FCM token) we last successfully registered with <enable>. Persisted
// so that after the FCM token rotates — including while the app was closed — we can send
// <disable> for the old node and stop the server pushing to a now-dead token.
const ENABLED_NODE_KEY = 'xmpp-push-enabled-node';
const PUSH_SECRET = ''; // Shared secret with push app server (leave empty if not required)

let pushServerJid: string | null = null;
let notificationClearTimers: number[] = [];

/**
 * Remove delivered push notifications, retrying briefly because native delivery
 * can race the event that triggered the clear (especially right after sending).
 *
 * This only helps while the app is foregrounded: the OS displays background
 * pushes before JS runs. Self-sent background pushes must be filtered by the
 * XMPP server/push gateway.
 */
function clearDeliveredNotificationsSoon(): void {
  if (!isNative()) return;

  const clear = async () => {
    try {
      // Dynamic import: the plugin is native-only and pulls `firebase/messaging`,
      // which vite externalizes for web builds (see vite.config.ts).
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
      await FirebaseMessaging.removeAllDeliveredNotifications();
    } catch { /* best effort */ }
  };

  for (const timer of notificationClearTimers) clearTimeout(timer);
  void clear();
  notificationClearTimers = [500, 1500, 3000].map((ms) => window.setTimeout(clear, ms));
}

/** Call after sending a message so the sender's own push is not left on screen. */
export function suppressOwnMessageNotifications(): void {
  clearDeliveredNotificationsSoon();
}

/** Get the active push server JID */
export function getPushServerJid(): string | null {
  return pushServerJid;
}

/**
 * Discover the push server JID by trying push.DOMAIN (derived from user's JID).
 * Falls back to a manually configured JID from localStorage.
 * Returns null if no push server is available.
 */
async function discoverPushServer(): Promise<string | null> {
  // Check for manually configured override first
  const manual = localStorage.getItem(PUSH_SERVER_KEY);
  if (manual) return manual;

  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return null;

  // Derive push.DOMAIN from user's JID
  const bareJid: string | undefined = _converse.bare_jid;
  if (!bareJid) return null;
  const domain = bareJid.split('@')[1];
  if (!domain) return null;

  const candidateJid = `push.${domain}`;

  // Probe via disco#info to see if the push server exists and supports XEP-0357
  try {
    const { $iq, Strophe } = _converse.env;
    const iq = $iq({ type: 'get', to: candidateJid })
      .c('query', { xmlns: Strophe.NS.DISCO_INFO });
    const result = await api.sendIQ(iq);

    // Check if the response contains a pubsub/push identity or urn:xmpp:push:0 feature
    const xml = typeof result === 'string' ? new DOMParser().parseFromString(result, 'text/xml') : result;
    const features = xml.querySelectorAll?.('feature') || [];
    for (const f of features) {
      if (f.getAttribute('var') === 'urn:xmpp:push:0') {
        console.log(`[Push] Discovered push server: ${candidateJid}`);
        return candidateJid;
      }
    }

    // Even without the exact feature, if disco succeeded the component exists
    console.log(`[Push] Push server responded at ${candidateJid}`);
    return candidateJid;
  } catch {
    console.log(`[Push] No push server found at ${candidateJid}`);
    return null;
  }
}

/** Set a custom push server JID (persisted to localStorage). */
export function setPushServerJid(jid: string) {
  if (jid) {
    localStorage.setItem(PUSH_SERVER_KEY, jid);
    pushServerJid = jid;
  } else {
    localStorage.removeItem(PUSH_SERVER_KEY);
    pushServerJid = null;
  }
}

let fcmToken: string | null = null;
let pushEnabled = false;
let pushInitialized = false;
let reconnectCleanup: (() => void) | null = null;
// Token currently being registered, to dedupe concurrent <enable> sends (e.g. a
// token refresh racing with the reconnect handler) which would otherwise register twice.
let enablingToken: string | null = null;
// Kept so we can remove Firebase listeners when the session is torn down on logout.
let firebaseRef: FirebaseMessagingPlugin | null = null;

/**
 * Initialize push notifications on native platforms.
 * Call after XMPP connection is established.
 */
export async function initPushNotifications() {
  if (!isNative()) return;
  if (pushInitialized) return;
  pushInitialized = true;

  let FirebaseMessaging: FirebaseMessagingPlugin;
  try {
    const mod = await import('@capacitor-firebase/messaging');
    FirebaseMessaging = mod.FirebaseMessaging;
    firebaseRef = FirebaseMessaging;
  } catch {
    console.warn('[Push] @capacitor-firebase/messaging not available');
    pushInitialized = false; // allow a retry on the next connect
    return;
  }

  // Request permission
  let permResult;
  try {
    permResult = await FirebaseMessaging.requestPermissions();
  } catch (err) {
    console.warn('[Push] requestPermissions failed:', err);
    return;
  }
  if (permResult.receive !== 'granted') return;

  // Get unified FCM token (works for both Android and iOS)
  try {
    const result = await FirebaseMessaging.getToken();
    fcmToken = result.token;
    console.log('[Push] FCM token received');
  } catch (err) {
    console.warn('[Push] getToken failed:', err);
    return;
  }

  // Discover push server (push.DOMAIN) or use manually configured one
  pushServerJid = await discoverPushServer();
  if (!pushServerJid) {
    console.warn('[Push] No push server available — push notifications disabled');
    // Emit event so UI can prompt user to configure one
    events.emit(PUSH_SERVER_NOT_FOUND);
    return;
  }

  const prevNode = localStorage.getItem(ENABLED_NODE_KEY);
  await enablePushOnServer(fcmToken!);
  // If a previous run registered a different token (the FCM token rotated while the app
  // was closed), disable that stale node so the server stops pushing to the dead token.
  if (prevNode && prevNode !== fcmToken) {
    await disablePushOnServer(prevNode);
  }

  // Token refresh — re-register with the new token, then disable the old node.
  FirebaseMessaging.addListener('tokenReceived', async (event: { token: string }) => {
    const oldToken = fcmToken;
    if (event.token === oldToken) return;
    console.log('[Push] FCM token refreshed');
    fcmToken = event.token;
    if (pushEnabled) {
      // Enable the new token first (avoid a notification gap), then disable the old node.
      await enablePushOnServer(fcmToken);
      if (oldToken) await disablePushOnServer(oldToken);
    }
  });

  // Push received while app is in foreground — suppress it, user is already in-app
  FirebaseMessaging.addListener('notificationReceived', async () => {
    console.log('[Push] Push received (foreground, suppressed)');
    clearDeliveredNotificationsSoon();
  });

  // User tapped a notification — clear it and let the app handle navigation
  FirebaseMessaging.addListener('notificationActionPerformed', async () => {
    console.log('[Push] Notification tapped');
    try {
      await FirebaseMessaging.removeAllDeliveredNotifications();
    } catch { /* best effort */ }
  });

  // Re-enable push on reconnect (server may clear registrations)
  // Only re-enable if push was previously enabled and got cleared by a disconnect
  reconnectCleanup?.();
  reconnectCleanup = events.on(CONNECTION_STATUS_CHANGED, (status: ConnectionStatus) => {
    if (status === 'disconnected') {
      pushEnabled = false;
    }
    if (status === 'connected' && !pushEnabled && fcmToken && pushServerJid) {
      enablePushOnServer(fcmToken);
    }
  });
}


/**
 * Send XEP-0357 <enable> IQ to register for push on the XMPP server.
 * Includes the platform so the push app server knows how to format the FCM message.
 */
async function enablePushOnServer(token: string): Promise<void> {
  // Dedupe concurrent registrations for the same token (reconnect + tokenReceived race).
  if (enablingToken === token) return;

  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return;

  enablingToken = token;
  try {
    const { $iq } = _converse.env;

    // pushModule must match a module name in fpush's settings.json
    const pushModule = isAndroid() ? 'android' : isIOS() ? 'ios' : 'android';

    let iq = $iq({ type: 'set' })
      .c('enable', { xmlns: 'urn:xmpp:push:0', jid: pushServerJid!, node: token });

    // Include publish-options with pushModule for fpush routing and optional secret
    iq = iq
      .c('x', { xmlns: 'jabber:x:data', type: 'submit' })
        .c('field', { var: 'FORM_TYPE' })
          .c('value').t('http://jabber.org/protocol/pubsub#publish-options').up()
        .up()
        .c('field', { var: 'pushModule' })
          .c('value').t(pushModule).up()
        .up();

    if (PUSH_SECRET) {
      iq = iq
        .c('field', { var: 'secret' })
          .c('value').t(PUSH_SECRET).up()
        .up();
    }

    await api.sendIQ(iq);
    pushEnabled = true;
    localStorage.setItem(ENABLED_NODE_KEY, token);
    console.log(`[Push] XEP-0357 enabled on server (module: ${pushModule})`);
  } catch (err) {
    console.warn('[Push] Failed to enable XEP-0357:', err);
  } finally {
    enablingToken = null;
  }
}

/**
 * Send XEP-0357 <disable> IQ to unregister push on the XMPP server.
 * Call before logout (no arg → disables the active token), or pass an old token
 * to clean up a stale registration after the FCM token rotated.
 */
export async function disablePushOnServer(token?: string): Promise<void> {
  const node = token ?? fcmToken;
  // Note: we intentionally don't gate on `pushEnabled` — on logout the app is often
  // already disconnected (which flips pushEnabled to false), but we still want to send
  // <disable> so the server stops pushing to this device.
  if (!node || !pushServerJid) return;

  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return;

  // Whether we're disabling the currently-active registration (logout) vs. cleaning
  // up an old, rotated-away token. Only the former should flip push state off.
  const isActiveNode = !token || token === fcmToken;

  try {
    const { $iq } = _converse.env;

    const iq = $iq({ type: 'set' })
      .c('disable', { xmlns: 'urn:xmpp:push:0', jid: pushServerJid!, node });

    await api.sendIQ(iq);
    if (isActiveNode) {
      pushEnabled = false;
      localStorage.removeItem(ENABLED_NODE_KEY);
    }
    console.log(`[Push] XEP-0357 disabled on server (${isActiveNode ? 'active' : 'stale'} node)`);
  } catch {
    // Best effort
  }
}

/** Get the current FCM token (for debugging/settings display) */
export function getFcmToken(): string | null {
  return fcmToken;
}

/**
 * Tear down all push state on logout so the next login (possibly a different account)
 * re-initializes cleanly. Without this, `pushInitialized` stays true and push is never
 * re-registered for the new user, and stale Firebase listeners accumulate.
 */
export async function resetPushState(): Promise<void> {
  reconnectCleanup?.();
  reconnectCleanup = null;

  for (const timer of notificationClearTimers) clearTimeout(timer);
  notificationClearTimers = [];

  if (firebaseRef) {
    try {
      await firebaseRef.removeAllListeners();
    } catch { /* best effort */ }
  }
  firebaseRef = null;

  fcmToken = null;
  pushServerJid = null;
  pushEnabled = false;
  enablingToken = null;
  pushInitialized = false;
}
