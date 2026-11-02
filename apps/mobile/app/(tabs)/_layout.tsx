import { Tabs } from 'expo-router'

import { AppTabBar } from '../../src/components/AppTabBar'

/**
 * 三个主页面走真正的 Tab 导航。
 *
 * 之前是三个独立 Stack 页面、各自在底部画一条「假 Tab 栏」：切页时整页卸载重挂，
 * 在 Fabric 下会把还挂在旧父节点上的原生视图插进新容器，直接崩在
 * `IllegalStateException: The specified child already has a parent`。
 * 交给导航器管理后页面保持挂载，滚动位置也不会再丢。
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
