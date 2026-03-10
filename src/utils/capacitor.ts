import { isNative, isAndroid } from './platform';
import { getApi } from '@/xmpp/client';
import { initPushNotifications } from './push';

/** Call early on app startup to show the login screen */
export async function hideSplashScreen() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* ignore */ }
}

/** Call after XMPP connection is established */
export async function initCapacitor() {
  if (!isNative()) return;

  // Configure status bar
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    const isDark = document.documentElement.classList.contains('dark');
    await StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' as any });
    if (isAndroid()) {
      await StatusBar.setBackgroundColor({ color: '#0f172a' });
    }
  } catch { /* ignore */ }

  // App lifecycle: reconnect on resume
  try {
    const { App } = await import('@capacitor/app');

    App.addListener('appStateChange', async ({ isActive }) => {
      const api = getApi();
      if (!api) return;

      if (isActive) {
        // Reconnect if disconnected
        try {
          await api.connection.reconnect();
        } catch { /* already connected */ }
      }
    });

    // Android back button — dispatch custom event so app-shell can handle navigation
    // Never close/minimize the app on back button press
    if (isAndroid()) {
      App.addListener('backButton', () => {
        window.dispatchEvent(new CustomEvent('app-back-button', { cancelable: true }));
      });
    }
  } catch { /* ignore */ }

  // Initialize push notifications
  try {
    await initPushNotifications();
  } catch { /* ignore - push not available */ }

  // Keyboard handling
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    Keyboard.addListener('keyboardWillShow', () => {
      document.body.classList.add('keyboard-open');
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-open');
    });
  } catch { /* ignore */ }
}
