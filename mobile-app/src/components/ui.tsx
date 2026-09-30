import { type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { router } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Linking from 'expo-linking'
import type { Shift } from '@/lib/globalConfig'

export const C = {
  bg: '#0f1117',
  panel: '#13151f',
  panel2: '#1a1d27',
  border: '#2d3048',
  line: '#1e2130',
  text: '#e2e8f0',
  sub: '#94a3b8',
  muted: '#8892a4',
  dim: '#64748b',
  faint: '#475569',
  accent: '#7c3aed',
  blue: '#60a5fa',
  green: '#4ade80',
  yellow: '#fbbf24',
  red: '#f87171',
  pink: '#f472b6',
}

export const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
export const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#a78bfa' }

export const rateColor = (r: number) => r >= 70 ? C.green : r >= 40 ? C.yellow : C.red
export const dsColor = (ds: number | null | undefined) => ds == null ? C.dim : ds >= 0.99 ? C.green : ds >= 0.97 ? C.yellow : C.red
export const fmtDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return d ? `${d}/${m}/${y}` : iso }

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  if (!scroll) return <View style={[s.screen, style]}>{children}</View>
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.screenContent, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  )
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }, style]}>{children}</Pressable>
  return <View style={[s.card, style]}>{children}</View>
}

export function T({ children, size = 13, color = C.text, bold, mono, style, numberOfLines }: {
  children: ReactNode; size?: number; color?: string; bold?: boolean; mono?: boolean; style?: StyleProp<import('react-native').TextStyle>; numberOfLines?: number
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontSize: size, color, fontWeight: bold ? '700' : '400', fontFamily: mono ? 'Menlo' : undefined }, style]}>
      {children}
    </Text>
  )
}

export function H({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ gap: 2, marginBottom: 2 }}>
      <T size={17} bold>{children}</T>
      {sub ? <T size={12} color={C.muted}>{sub}</T> : null}
    </View>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
      <T size={11} color={C.muted} bold style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{children}</T>
      {right}
    </View>
  )
}

type BtnVariant = 'default' | 'outline' | 'danger' | 'ghost' | 'success'
export function Btn({ children, onPress, variant = 'default', disabled, loading, small, style }: {
  children: ReactNode; onPress?: () => void; variant?: BtnVariant; disabled?: boolean; loading?: boolean; small?: boolean; style?: StyleProp<ViewStyle>
}) {
  const v: Record<BtnVariant, { bg: string; border: string; color: string }> = {
    default: { bg: C.accent, border: C.accent, color: '#fff' },
    outline: { bg: 'transparent', border: C.border, color: C.text },
    danger: { bg: 'rgba(239,68,68,.15)', border: 'rgba(239,68,68,.35)', color: C.red },
    ghost: { bg: 'transparent', border: 'transparent', color: C.muted },
    success: { bg: 'rgba(34,197,94,.15)', border: 'rgba(34,197,94,.35)', color: C.green },
  }
  const st = v[variant]
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [{
        backgroundColor: st.bg, borderColor: st.border, borderWidth: 1, borderRadius: 8,
        paddingVertical: small ? 6 : 10, paddingHorizontal: small ? 10 : 14,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={st.color} /> : null}
      {typeof children === 'string' ? <T size={small ? 12 : 13} bold color={st.color}>{children}</T> : children}
    </Pressable>
  )
}

export function Chip({ label, color = C.sub, bg = 'rgba(100,116,139,.12)', onPress, active }: { label: ReactNode; color?: string; bg?: string; onPress?: () => void; active?: boolean }) {
  const body = (
    <View style={{ backgroundColor: active ? `${color}22` : bg, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, borderWidth: active !== undefined ? 1 : 0, borderColor: active ? color : C.border }}>
      <T size={11} bold color={active === false ? C.dim : color}>{label}</T>
    </View>
  )
  return onPress ? <Pressable onPress={onPress} hitSlop={6}>{body}</Pressable> : body
}

export function Segmented<V extends string>({ options, value, onChange, colors }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; colors?: Partial<Record<V, string>>
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map(o => {
        const active = o.value === value
        const col = colors?.[o.value] ?? C.blue
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)}
            style={{ borderWidth: 1, borderColor: active ? col : C.border, backgroundColor: active ? `${col}22` : 'transparent', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 6 }}>
            <T size={12} bold color={active ? col : C.muted}>{o.label}</T>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export function Input(props: TextInputProps & { mono?: boolean }) {
  const { mono, style, ...rest } = props
  return (
    <TextInput
      placeholderTextColor={C.faint}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      style={[{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, fontSize: 13, paddingHorizontal: 12, paddingVertical: 9, fontFamily: mono ? 'Menlo' : undefined }, rest.multiline && { minHeight: 90, textAlignVertical: 'top' }, style]}
    />
  )
}

export function Stat({ label, value, color = C.text, sub }: { label: string; value: ReactNode; color?: string; sub?: ReactNode }) {
  return (
    <View style={[s.card, { flex: 1, minWidth: '46%', gap: 2, paddingVertical: 10 }]}>
      <T size={10} color={C.muted} bold style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</T>
      <T size={20} bold color={color}>{value}</T>
      {sub ? <T size={11} color={C.dim}>{sub}</T> : null}
    </View>
  )
}

export function StatRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: { label: string; href: string } }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24, gap: 10 }}>
      <T size={14} bold color={C.sub} style={{ textAlign: 'center' }}>{title}</T>
      {sub ? <T size={12} color={C.dim} style={{ textAlign: 'center' }}>{sub}</T> : null}
      {action ? <Btn variant="outline" onPress={() => router.push(action.href as never)}>{action.label}</Btn> : null}
    </View>
  )
}

export function NeedsData({ what }: { what: string }) {
  return <Empty title={`Sem dados de ${what}.`} sub="Importe o relatório no app do PC e sincronize, ou toque em Sincronizar." action={{ label: '☁ Ir para Dados', href: '/dados' }} />
}

export function Row({ children, gap = 8, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }} />
}

export function Bar({ value, color = C.blue }: { value: number; color?: string }) {
  return (
    <View style={{ height: 6, backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', backgroundColor: color }} />
    </View>
  )
}

export async function copy(text: string) {
  await Clipboard.setStringAsync(text)
}

export function PhoneActions({ phone }: { phone?: string | null }) {
  if (!phone) return <T size={11} color={C.dim}>sem telefone</T>
  const digits = phone.replace(/\D/g, '')
  return (
    <Row gap={6}>
      <T size={11} mono color={C.muted}>{phone}</T>
      <Chip label="📋" onPress={() => copy(phone)} />
      <Chip label="📞" color={C.blue} onPress={() => Linking.openURL(`tel:${digits}`)} />
      <Chip label="WhatsApp" color={C.green} bg="rgba(34,197,94,.1)" onPress={() => Linking.openURL(`https://wa.me/55${digits}`)} />
    </Row>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.6)' }} onPress={onClose} />
      <View style={{ maxHeight: '88%', backgroundColor: C.panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, borderColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View style={{ flex: 1 }}>{typeof title === 'string' ? <T size={15} bold>{title}</T> : title}</View>
          <Pressable onPress={onClose} hitSlop={10}><T size={20} color={C.dim}>×</T></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { padding: 14, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, gap: 6 },
})
