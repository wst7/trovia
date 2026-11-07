import { View } from 'react-native'

/** 1dp hairline. Hierarchy comes from it and whitespace alone, with no shadows. */
export function Divider({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-line ${className}`} />
}
