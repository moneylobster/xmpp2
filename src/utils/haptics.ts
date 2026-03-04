import { isNative } from './platform';

let Haptics: any = null;

if (isNative()) {
  import('@capacitor/haptics').then((m) => {
    Haptics = m.Haptics;
  });
}

export async function hapticLight() {
  if (!Haptics) return;
  try {
    await Haptics.impact({ style: 'LIGHT' });
  } catch { /* no-op on web */ }
}

export async function hapticMedium() {
  if (!Haptics) return;
  try {
    await Haptics.impact({ style: 'MEDIUM' });
  } catch { /* no-op on web */ }
}
