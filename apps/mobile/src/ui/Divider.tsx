import { View } from 'react-native'

/** 1dp 发丝线。层次只靠它和留白，不用阴影。 */
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-line ${className}`} />
}
