import { Tabs } from 'expo-router'

import { AppTabBar } from '../../src/components/AppTabBar'

/**
 * The three main screens use real tab navigation.
 *
 * Previously they were three separate stack screens each drawing its own fake tab bar at the bottom: switching screens unmounted and remounted the whole page,
 * which under Fabric inserted a native view still attached to its old parent into a new container, crashing with
 * `IllegalStateException: The specified child already has a parent`。
 * With the navigator in charge the pages stay mounted, and scroll position is no longer lost.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: 'none' }}
      tabBar={() => <AppTabBar />}
    >
      <Tabs.Screen name="index" options={{ title: '首页' }} />
      <Tabs.Screen name="documents" options={{ title: '收藏' }} />
      <Tabs.Screen name="settings" options={{ title: '我的' }} />
    </Tabs>
  )
}
