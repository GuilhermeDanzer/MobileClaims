import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Runtime configuration for the mobile app. The API base URL is resolved once and cached;
 * the diagnostics screen can override it (persisted via SecureStore) for physical devices.
 */

const BASE_URL_OVERRIDE_KEY = 'settings.apiBaseUrl';

let cachedBaseUrl: string | null = null;

/** The app version reported by the app config gate. */
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Override for use on physical devices; empty string clears the override. */
export async function setApiBaseUrlOverride(url: string): Promise<void> {
  if (url.trim() === '') {
    await SecureStore.deleteItemAsync(BASE_URL_OVERRIDE_KEY);
  } else {
    await SecureStore.setItemAsync(BASE_URL_OVERRIDE_KEY, url.trim());
  }
  cachedBaseUrl = null; // re-resolve on next request
}

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;

  const override = await SecureStore.getItemAsync(BASE_URL_OVERRIDE_KEY);
  if (override) {
    cachedBaseUrl = override;
    return override;
  }

  // When running through the Expo dev server on a physical device, hostUri is the Mac's
  // LAN address (e.g. "192.168.1.10:8081"); the API listens on :3000 on the same host.
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    cachedBaseUrl = `http://${host}:3000`;
    return cachedBaseUrl;
  }

  // Android emulator reaches the host machine via 10.0.2.2; everything else uses localhost.
  cachedBaseUrl = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
  return cachedBaseUrl;
}
