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
 *   1. FCM data message wakes app (content-free)
 *   2. App reconnects to XMPP, fetches new messages
 *   3. App displays local notification with decrypted message content
 *
 * iOS flow:
 *   1. FCM notification message delivered via APNs (may contain encrypted summary)
 *   2. Notification Service Extension can decrypt and display (requires native code)
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
const PUSH_SERVER_KEY = 'xmpp-push-server-jid';
const PUSH_SECRET = ''; // Shared secret with push app server (leave empty if not required)

let pushServerJid: string | null = null;

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

/** Set a custom push server JID (persisted to localStorage) */
export function setPushServerJid(jid: string) {
  if (jid) {
    localStorage.setItem(PUSH_SERVER_KEY, jid);
  } else {
    localStorage.removeItem(PUSH_SERVER_KEY);
  }
}

let fcmToken: string | null = null;
let pushEnabled = false;

/**
 * Initialize push notifications on native platforms.
 * Call after XMPP connection is established.
 */
export async function initPushNotifications() {
  if (!isNative()) return;

  let FirebaseMessaging: any;
  try {
    const mod = await import('@capacitor-firebase/messaging');
    FirebaseMessaging = mod.FirebaseMessaging;
  } catch {
    console.warn('[Push] @capacitor-firebase/messaging not available');
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

  await enablePushOnServer(fcmToken!);

  // Token refresh — re-register with new token
  FirebaseMessaging.addListener('tokenReceived', async (event: { token: string }) => {
    console.log('[Push] FCM token refreshed');
    fcmToken = event.token;
    if (pushEnabled) {
      await enablePushOnServer(fcmToken);
    }
  });

  // Push received while app is in foreground or woken from background
  FirebaseMessaging.addListener('notificationReceived', async (notification: any) => {
    console.log('[Push] Push received');
    await handlePushWakeUp(notification);
  });

  // User tapped a notification
  FirebaseMessaging.addListener('notificationActionPerformed', (event: any) => {
    console.log('[Push] Notification tapped');
    // App is opening — reconnect will happen via appStateChange handler
  });

  // Re-enable push on reconnect (server may clear registrations)
  events.on(CONNECTION_STATUS_CHANGED, (status: ConnectionStatus) => {
    if (status === 'connected' && fcmToken && pushServerJid) {
      enablePushOnServer(fcmToken);
    }
  });
}

/**
 * Handle an incoming push notification.
 * On Android: reconnect XMPP, fetch messages, show local notification.
 * On iOS: the notification is already displayed by the OS/Notification Service Extension.
 */
async function handlePushWakeUp(_notification: any) {
  const api = getApi();
  if (!api) return;

  // Reconnect to XMPP to fetch pending messages
  try {
    await api.connection.reconnect();
  } catch { /* already connected */ }

  // On Android, show a local notification with message content
  // (iOS handles display via the notification payload / Notification Service Extension)
  if (isAndroid()) {
    await showLocalNotificationForNewMessages();
  }
}

/**
 * Fetch recent unread messages and display a local notification.
 * Called on Android after a push wake-up triggers a reconnect.
 */
async function showLocalNotificationForNewMessages() {
  const api = getApi();
  if (!api) return;

  // Wait briefly for messages to arrive after reconnect
  await new Promise((r) => setTimeout(r, 2000));

  try {
    const chats = await api.chats.get();
    if (!chats?.length) return;

    let totalUnread = 0;
    let lastSender = '';
    let lastBody = '';

    for (const chat of chats) {
      const unread = chat.get?.('num_unread') || 0;
      if (unread > 0) {
        totalUnread += unread;
        // Get the most recent message for the notification body
        const messages = chat.messages;
        if (messages?.length) {
          const last = messages.at(-1);
          if (last) {
            lastSender = last.get?.('nickname') || last.get?.('from')?.split('/')[0] || '';
            lastBody = last.get?.('body') || '';
          }
        }
      }
    }

    if (totalUnread === 0) return;

    let LocalNotifications: any;
    try {
      const mod = await import('@capacitor/local-notifications');
      LocalNotifications = mod.LocalNotifications;
    } catch {
      return;
    }

    const title = totalUnread === 1
      ? lastSender
      : `${totalUnread} new messages`;
    const body = totalUnread === 1
      ? lastBody
      : `${lastSender}: ${lastBody}`;

    await LocalNotifications.schedule({
      notifications: [{
        title,
        body,
        id: Date.now(),
        smallIcon: 'ic_notification',
        largeIcon: 'ic_launcher',
      }],
    });
  } catch (err) {
    console.warn('[Push] Failed to show local notification:', err);
  }
}

/**
 * Send XEP-0357 <enable> IQ to register for push on the XMPP server.
 * Includes the platform so the push app server knows how to format the FCM message.
 */
async function enablePushOnServer(token: string): Promise<void> {
  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return;

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
    console.log(`[Push] XEP-0357 enabled on server (module: ${pushModule})`);
  } catch (err) {
    console.warn('[Push] Failed to enable XEP-0357:', err);
  }
}

/**
 * Send XEP-0357 <disable> IQ to unregister push on the XMPP server.
 * Call before logout.
 */
export async function disablePushOnServer(): Promise<void> {
  if (!pushEnabled || !fcmToken || !pushServerJid) return;

  const api = getApi();
  const _converse = getConverseInternal();
  if (!api || !_converse) return;

  try {
    const { $iq } = _converse.env;

    const iq = $iq({ type: 'set' })
      .c('disable', { xmlns: 'urn:xmpp:push:0', jid: pushServerJid!, node: fcmToken });

    await api.sendIQ(iq);
    pushEnabled = false;
    console.log('[Push] XEP-0357 disabled on server');
  } catch {
    // Best effort — we're logging out anyway
  }
}

/** Get the current FCM token (for debugging/settings display) */
export function getFcmToken(): string | null {
  return fcmToken;
}
