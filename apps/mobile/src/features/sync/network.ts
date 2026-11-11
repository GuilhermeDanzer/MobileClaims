import { useSyncExternalStore } from 'react';
import { isForcedOffline, subscribeOffline } from './dev-flags';
import * as Network from 'expo-network';

/**
 * Coarse connectivity signal for UI. The sync engine uses the listener variant
 * (`Network.addNetworkStateListener`) to trigger a sync on recovery; this hook only drives
 * the offline banner. Unknown fields are treated as online so we never falsely alarm.
 */
export function useIsOnline(): boolean {
  const forcedOffline = useSyncExternalStore(subscribeOffline, isForcedOffline, () => false);
  const state = Network.useNetworkState();
  return !forcedOffline && state.isConnected !== false && state.isInternetReachable !== false;
}
