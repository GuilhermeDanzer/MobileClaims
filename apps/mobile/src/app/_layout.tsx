import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { LogBox } from 'react-native'

import { SessionProvider, useSession } from '@/features/session/session-context'
import { SyncProvider } from '@/features/sync/use-sync'
import { queryClient } from '@/lib/query-client'

SplashScreen.preventAutoHideAsync()

// SDK 58 expo-router's `NativeTabs` eagerly preloads non-focused tabs by dispatching a
// `PRELOAD` (and, in some transitions, `ROUTE_NAMES_CHANGED`) action. When the tabs group is
// mounted through a `Stack.Protected` auth-guard transition (loading → signedIn), that action is
// dispatched during a render phase before the global navigation tree has reconciled the route
// change, so no navigator handles it. This is a known, benign, development-only warning
// (expo/expo#51726) that has no effect in production; filter it out so it doesn't pollute
// LogBox or overlay the tab bar during local development.
LogBox.ignoreLogs([/^The action '(PRELOAD|ROUTE_NAMES_CHANGED)'/])

// Hide Expo's floating dev-menu button (the round "tools" FAB that floats over the app in
// Expo Go and development builds). This only removes the on-screen button — the dev menu
// itself remains reachable via shake gesture or Cmd+D.
if (__DEV__) {
  // DevMenu.setToolsButtonVisible(false)
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SyncProvider>
          <RootNavigator />
        </SyncProvider>
      </SessionProvider>
    </QueryClientProvider>
  )
}

/**
 * A single root Stack with route guards: the authenticated screens (tabs, claim detail,
 * new-claim wizard) are only reachable when signed in; the sign-in screen otherwise.
 */
function RootNavigator() {
  const { status } = useSession()

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync()
  }, [status])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'loading'}>
        <Stack.Screen name="loading" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="claims/[claimId]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="new-claim" />
      </Stack.Protected>
    </Stack>
  )
}
