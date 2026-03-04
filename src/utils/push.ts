import { isNative } from './platform';

let PushNotifications: any = null;

export async function initPushNotifications(onToken?: (token: string) => void) {
  if (!isNative()) return;

  const mod = await import('@capacitor/push-notifications');
  PushNotifications = mod.PushNotifications;

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') return;

  await PushNotifications.register();

  PushNotifications.addListener('registration', (token: { value: string }) => {
    console.log('[Push] Token:', token.value);
    onToken?.(token.value);
  });

  PushNotifications.addListener('registrationError', (err: any) => {
    console.error('[Push] Registration error:', err);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
    console.log('[Push] Received:', notification);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
    console.log('[Push] Action:', action);
  });
}

/** Build XEP-0357 enable stanza for push registration */
export function buildPushEnableStanza(jid: string, node: string, secret?: string): string {
  let stanza = `<iq type="set"><enable xmlns="urn:xmpp:push:0" jid="${jid}" node="${node}">`;
  if (secret) {
    stanza += `<x xmlns="jabber:x:data" type="submit">`;
    stanza += `<field var="FORM_TYPE"><value>http://jabber.org/protocol/pubsub#publish-options</value></field>`;
    stanza += `<field var="secret"><value>${secret}</value></field>`;
    stanza += `</x>`;
  }
  stanza += `</enable></iq>`;
  return stanza;
}
