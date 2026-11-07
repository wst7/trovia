import Constants, { ExecutionEnvironment } from 'expo-constants'
import { lazy, Suspense } from 'react'

const NativeShareIntentBridge = lazy(() => import('./NativeShareIntentBridge'))

/**
 * Expo Go does not include the native share module, and importing it directly crashes.
 * Skip the share bridge inside Expo Go; the other screens remain usable for debugging.
 */
export function ShareIntentBridge() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <NativeShareIntentBridge />
    </Suspense>
  )
}
