import { useMemo, useState } from 'react'
import type { WorkPreferenceData } from '../lib/workPreferenceParser'
import type { LocalRoute } from '../lib/noshowRouteParser'
import { getGlobalConfig, driverMatchesShift, type Shift } from '../lib/globalConfig'

// Rotas atribuídas a motoristas que NÃO estão com status Disponível no turno, pelo relatório de disponibilidade.
export interface AvailIssue { label: string; detail: string }

export function availabilityIssue(workPref: WorkPreferenceData | null, driverId: string | null, day: string, shift: Shift): AvailIssue | null {
  if (!workPref || !driverId) return null
  const d = workPref.drivers.find(x => x.driverId === driverId)
  if (!d) return { label: 'Fora do relatório', detail: 'não aparece no relatório de disponibilidade' }
  if (!workPref.dates.includes(day)) return null // relatório não cobre este dia: não dá para afirmar
  const s = d.schedule[day]
  if (!s || s.status === 'no_schedule') return { label: 'Sem disponibilidade', detail: 'não marcou disponibilidade no dia' }
  if (s.status === 'not_available') return { label: 'Indisponível', detail: 'marcou Not Available no dia' }
  if (s.status === 'pending') return { label: 'Pendente', detail: 'disponibilidade pendente' }
  if (!driverMatchesShift(s.slots, shift, getGlobalConfig())) return { label: `Não é do ${shift}`, detail: `disponível só em ${s.slots.join(', ') || '—'}` }
  return null
}

export function useAvailabilityIssues(routes: LocalRoute[], workPref: WorkPreferenceData | null, day: string, shift: Shift) {
  return useMemo(() => {
    const m = new Map<string, AvailIssue>() // atId → problema
    for (const r of routes) {
      if (r.status !== 'ATRIBUIDA' || !r.assignedDriverId) continue
      const i = availabilityIssue(workPref, r.assignedDriverId, day, shift)
      if (i) m.set(r.atId, i)
    }
    return m
  }, [routes, workPref, day, shift])
}

export function AvailChip({ issue }: { issue: AvailIssue }) {
  return <span title={issue.detail} style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, color: '#fff', background: '#dc2626', borderRadius: 4, padding: '1px 6px', marginLeft: 6, whiteSpace: 'nowrap' }}>⛔ {issue.label}</span>
}

export function AlertaDisponibilidade({ routes, workPref, day, shift, issues }: { routes: LocalRoute[]; workPref: WorkPreferenceData | null; day: string; shift: Shift; issues: Map<string, AvailIssue> }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState('')
  if (!workPref) return (
    <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)', fontSize: 12, color: '#fbbf24' }}>
      ⚠ Importe o relatório de disponibilidade em Uploads para conferir se os motoristas das rotas estão disponíveis no turno.
    </div>
  )
  if (!workPref.dates.includes(day)) return null
  const list = routes.filter(r => issues.has(r.atId))
  if (list.length === 0) return (
    <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(74,222,128,.35)', background: 'rgba(74,222,128,.06)', fontSize: 12, color: '#4ade80' }}>
      ✓ Todos os motoristas com rota no {shift} estão com status Disponível no turno.
    </div>
  )
  const copy = async (k: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) }
  return (
    <div style={{ margin: '10px 20px 0', borderRadius: 10, border: '2px solid #dc2626', background: 'rgba(220,38,38,.12)', boxShadow: '0 0 14px rgba(220,38,38,.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#fca5a5', flex: 1 }}>⛔ {list.length} rota{list.length > 1 ? 's' : ''} com motorista que NÃO está disponível no {shift}</span>
        <button onClick={() => void copy('at', list.map(r => r.atId).join('\n'))} style={btn}>{copied === 'at' ? '✓ Copiado' : '📋 ATs'}</button>
        <button onClick={() => void copy('all', list.map(r => `${r.atId}\t${r.gaiola ?? ''}\t${r.assignedDriverId}\t${r.assignedDriverName ?? ''}\t${issues.get(r.atId)!.label}`).join('\n'))} style={btn}>{copied === 'all' ? '✓ Copiado' : '📋 Lista'}</button>
        <button onClick={() => setOpen(v => !v)} style={btn}>{open ? '▲ Esconder' : '▼ Ver'}</button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflow: 'auto' }}>
          {list.map(r => { const i = issues.get(r.atId)!; return (
            <div key={r.atId} style={{ fontSize: 12, color: '#fecaca' }}>
              <b>{r.gaiola ?? '—'}</b> · {r.atId} · {r.assignedDriverName ?? r.assignedDriverId} ({r.assignedDriverId}) — <b>{i.label}</b>: {i.detail}
            </div>
          ) })}
        </div>
      )}
    </div>
  )
}
const btn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(252,165,165,.5)', color: '#fecaca', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
