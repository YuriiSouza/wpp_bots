import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { C, T } from './ui'

// Vertical bar chart of a 0–100 value per day; tap a bar to see its detail.
export function DayBars({ data, color = C.blue, detail }: { data: { date: string; value: number }[]; color?: string; detail?: (i: number) => string }) {
  const [sel, setSel] = useState<number | null>(null)
  if (data.length === 0) return <T size={12} color={C.dim}>Sem dados no período.</T>
  const H = 120
  return (
    <View style={{ gap: 6 }}>
      <T size={11} color={sel !== null ? C.text : C.dim}>{sel !== null ? `${data[sel].date.split('-').reverse().join('/')}: ${detail ? detail(sel) : `${data[sel].value}%`}` : 'Toque numa barra para ver o detalhe'}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: H + 18 }}>
          {data.map((d, i) => (
            <Pressable key={d.date} onPress={() => setSel(i === sel ? null : i)} style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 14, height: Math.max(2, (Math.min(100, d.value) / 100) * H), backgroundColor: color, opacity: sel === null || sel === i ? 1 : 0.4, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
              <T size={8} color={C.dim}>{d.date.slice(8)}</T>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
