import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { C, Card, Chip, Empty, PhoneActions, Row, Screen, T } from '@/components/ui'
import { useAppData, localDateStr } from '@/lib/appData'
import { licenseStatus } from '@/components/driver'

const LEVEL = { red: { color: '#ef4444', label: '🔴 Crítico' }, yellow: { color: '#f59e0b', label: '🟡 Atenção' }, green: { color: '#22c55e', label: '🟢 OK' } }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Card><T size={10} bold color={C.muted} style={{ letterSpacing: 0.5 }}>{title.toUpperCase()}</T>{children}</Card>
}

function Field({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <T size={12} color={C.dim}>{label}</T>
      <T size={12} bold={highlight} color={highlight ? C.yellow : C.text} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</T>
    </Row>
  )
}

export default function Motorista() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { registry, profiles } = useAppData()
  const d = registry.find(x => x.id === id)
  const p = profiles?.find(x => x.id === id)
  const today = localDateStr()
  const [now] = useState(() => Date.now())
  if (!d && !p) return <Screen><Empty title="Motorista não encontrado." /></Screen>
  const name = d?.name || p?.name || id
  const lic = d ? licenseStatus(d.licenseExpiryDate) : null
  const schedule = p ? Object.entries(p.scheduleByDate).sort(([a], [b]) => a.localeCompare(b)).slice(0, 7) : []

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <Card>
        <T size={16} bold>{name}</T>
        <T size={11} mono color={C.dim}>{id}</T>
        <Row gap={4}>
          {d?.status ? <Chip label={d.status} color={d.status === 'Active' ? C.green : C.sub} /> : null}
          {(d?.vehicleType || p?.vehicleType) ? <Chip label={d?.vehicleType || p!.vehicleType} /> : null}
          {p?.isNewDriver && <Chip label="NOVO" color={C.blue} />}
          {d?.spxBlocklisted && <Chip label="🚫 Blocklist SPX" color={C.red} />}
          {lic && <Chip label={lic.label} color={lic.color} />}
          {p && <Chip label={LEVEL[p.alertLevel].label} color={LEVEL[p.alertLevel].color} />}
        </Row>
        <PhoneActions phone={d?.phoneNumber} />
        {p && p.alertReasons.length > 0 && <View style={{ gap: 2 }}>{p.alertReasons.map((r, i) => <T key={i} size={11} color={LEVEL[p.alertLevel].color}>• {r}</T>)}</View>}
      </Card>

      {d && (
        <Section title="Cadastro">
          <Field label="Gênero" value={d.gender} />
          <Field label="Nascimento" value={d.dateOfBirth} />
          <Field label="Placa" value={d.licensePlate} />
          <Field label="Contrato" value={d.contractType} />
          <Field label="Agência" value={d.agency === 'SPXOWNFLEET' ? 'Frota própria (SPX)' : d.agency} />
          <Field label="Cidade" value={d.city} />
          <Field label="Entrada" value={d.joinedDate} />
          <Field label="Validade CNH" value={d.licenseExpiryDate} highlight={!!d.licenseExpiryDate && new Date(d.licenseExpiryDate).getTime() < now} />
          <Field label="Fabricante" value={d.vehicleManufacturer} />
          <Field label="Ano do veículo" value={d.vehicleManufacturingYear} />
          <Field label="Último KYC" value={d.lastKycDate} />
          <Field label="KYC veículo" value={d.vehicleKycDate} />
          <Field label="Motivo suspensão" value={d.suspensionReason} highlight />
        </Section>
      )}

      {p && p.dsReal !== null && (
        <Section title="Análise DS">
          <Field label="DS_Real" value={`${(p.dsReal * 100).toFixed(2)}%`} />
          <Field label="Tendência" value={p.dsStatus ?? '—'} />
          <Field label="Performance" value={p.performance !== null ? `${(p.performance * 100).toFixed(1)}%` : '—'} />
          <Field label="Cluster" value={p.clusterFromDs} />
        </Section>
      )}

      {p && p.callUpTotal > 0 && (
        <Section title="Call Up">
          <Field label="Taxa de aceitação" value={`${p.acceptanceRate}%`} />
          <Field label="Aceitas / Total" value={`${p.callUpAccepted}/${p.callUpTotal}`} />
          <Field label="Recusadas" value={String(p.callUpDeclined)} />
          <Field label="Timeouts" value={String(p.timeoutCount)} highlight={p.timeoutCount > 3} />
          <Field label="Top motivo" value={p.topDeclineReason} />
        </Section>
      )}

      {p && p.pendingPackages > 0 && (
        <Section title="Pacotes em aberto">
          <Field label="Total" value={String(p.pendingPackages)} highlight={p.isCritical} />
          <Field label="Delivering" value={String(p.deliveringPending)} />
          <Field label="On Hold" value={String(p.onHoldPending)} />
          <Field label="Mais antigo" value={p.oldestDays > 0 ? `${p.oldestDays} dias` : '—'} highlight={p.oldestDays >= 3} />
        </Section>
      )}

      {schedule.length > 0 && (
        <Section title="Disponibilidade">
          {schedule.map(([date, s]) => (
            <Row key={date} style={{ justifyContent: 'space-between' }}>
              <T size={12} bold={date === today} color={date === today ? C.text : C.dim}>{date.slice(5)}{date === today ? ' (hoje)' : ''}</T>
              <T size={11} bold color={s.status === 'available' ? C.green : s.status === 'not_available' ? C.red : s.status === 'pending' ? C.yellow : C.faint}>
                {s.status === 'available' ? (s.slots.join(' / ') || '✓') : s.status === 'not_available' ? '✗' : s.status === 'pending' ? '?' : '—'}
              </T>
            </Row>
          ))}
          {p && p.clustersFromWorkPref.length > 0 && <Row gap={4}>{p.clustersFromWorkPref.map(c => <Chip key={c} label={c} color="#a78bfa" />)}</Row>}
        </Section>
      )}
    </Screen>
  )
}
