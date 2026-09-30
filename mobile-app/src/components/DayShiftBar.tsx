import { Pressable, View } from 'react-native'
import { useAppData, localDateStr } from '@/lib/appData'
import { C, SHIFTS, SHIFT_COLOR, T, fmtDate } from './ui'

function shiftDay(iso: string, delta: number) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return localDateStr(d)
}

export default function DayShiftBar({ hideShift }: { hideShift?: boolean }) {
  const { day, shift, setDay, setShift } = useAppData()
  const today = localDateStr()
  const label = day === today ? 'Hoje' : day === shiftDay(today, 1) ? 'Amanhã' : day === shiftDay(today, -1) ? 'Ontem' : fmtDate(day)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#0a0c14', borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Pressable hitSlop={8} onPress={() => setDay(shiftDay(day, -1))}><T size={20} color={C.dim}>‹</T></Pressable>
      <Pressable onLongPress={() => setDay(today)} style={{ borderWidth: 1, borderColor: C.border, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5, minWidth: 92, alignItems: 'center' }}>
        <T size={12} bold>📅 {label}</T>
      </Pressable>
      <Pressable hitSlop={8} onPress={() => setDay(shiftDay(day, 1))}><T size={20} color={C.dim}>›</T></Pressable>
      <View style={{ flex: 1 }} />
      {!hideShift && SHIFTS.map(s => {
        const active = s === shift
        return (
          <Pressable key={s} onPress={() => setShift(s)} style={{ borderWidth: 1, borderColor: active ? SHIFT_COLOR[s] : C.border, backgroundColor: active ? `${SHIFT_COLOR[s]}2e` : 'transparent', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 }}>
            <T size={12} bold color={active ? SHIFT_COLOR[s] : C.dim}>{s}</T>
          </Pressable>
        )
      })}
    </View>
  )
}
