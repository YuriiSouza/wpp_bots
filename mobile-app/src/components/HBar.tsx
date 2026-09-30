import { View } from 'react-native'
import { C, T } from './ui'

export function HBar({ name, count, max, color = '#3b82f6', rank, suffix }: { name: string; count: number; max: number; color?: string; rank?: number; suffix?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {rank !== undefined && <T size={10} bold color={C.faint} style={{ width: 22, textAlign: 'right' }}>#{rank}</T>}
      <T size={11} color={C.dim} numberOfLines={1} style={{ width: 110 }}>{name}</T>
      <View style={{ flex: 1, height: 8, backgroundColor: C.line, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${max > 0 ? (count / max) * 100 : 0}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <T size={11} bold style={{ minWidth: 40, textAlign: 'right' }}>{count.toLocaleString('pt-BR')}{suffix ?? ''}</T>
    </View>
  )
}

export function StackBar({ parts }: { parts: { key: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.line }}>
      {parts.filter(p => p.value > 0).map(p => <View key={p.key} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} />)}
    </View>
  )
}

export function Legend({ items }: { items: { label: string; value: number | string; color: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(i => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: i.color }} />
          <T size={10} color={C.dim}>{i.label}</T>
          <T size={10} bold>{i.value}</T>
        </View>
      ))}
    </View>
  )
}
