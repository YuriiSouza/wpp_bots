import { useMemo, useState } from 'react'
import type { StoredDriver } from '../lib/localStore'
import type { LocalRoute } from '../lib/noshowRouteParser'
import type { Shift } from '../lib/globalConfig'

// Rotas atribuídas a motoristas que NÃO estão ativos no cadastro do SPX:
// status com algum tipo de Suspended (Suspended, Suspended(KYC), Suspended(FV), Pre-Suspended…) ou Deactivated.
export interface AvailIssue { label: string; detail: string }

export const isInactiveStatus = (status?: string | null) => /suspend|deactiv/i.test(status ?? '')

export function driverStatusMap(registry: StoredDriver[]) {
  return new Map(registry.map(d => [d.id, d]))
}

export function availabilityIssue(byId: Map<string, StoredDriver>, driverId: string | null): AvailIssue | null {
  if (!driverId) return null
  const d = byId.get(driverId)
  if (!d || !isInactiveStatus(d.status)) return null
  return { label: d.status, detail: `status no cadastro do SPX: ${d.status}` }
}

export function useAvailabilityIssues(routes: LocalRoute[], registry: StoredDriver[]) {
  return useMemo(() => {
    const byId = driverStatusMap(registry)
    const m = new Map<string, AvailIssue>() // atId → problema
    for (const r of routes) {
      if (r.status !== 'ATRIBUIDA' || !r.assignedDriverId) continue
      const i = availabilityIssue(byId, r.assignedDriverId)
      if (i) m.set(r.atId, i)
    }
    return m
  }, [routes, registry])
}

export function AvailChip({ issue }: { issue: AvailIssue }) {
  return <span title={issue.detail} style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, color: '#fff', background: '#dc2626', borderRadius: 4, padding: '1px 6px', marginLeft: 6, whiteSpace: 'nowrap' }}>⛔ {issue.label}</span>
}

export function AlertaDisponibilidade({ routes, registry, shift, issues }: { routes: LocalRoute[]; registry: StoredDriver[]; shift: Shift; issues: Map<string, AvailIssue> }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState('')
  if (registry.length === 0) return (
    <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)', fontSize: 12, color: '#fbbf24' }}>
      ⚠ Importe a lista de motoristas em Uploads para conferir se os motoristas das rotas estão ativos (sem Suspended/Deactivated).
    </div>
  )
  const list = routes.filter(r => issues.has(r.atId))
  if (list.length === 0) return (
    <div style={{ margin: '10px 20px 0', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(74,222,128,.35)', background: 'rgba(74,222,128,.06)', fontSize: 12, color: '#4ade80' }}>
      ✓ Nenhum motorista com rota no {shift} está Suspended ou Deactivated no cadastro.
    </div>
  )
  const copy = async (k: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) }
  return (
    <div style={{ margin: '10px 20px 0', borderRadius: 10, border: '2px solid #dc2626', background: 'rgba(220,38,38,.12)', boxShadow: '0 0 14px rgba(220,38,38,.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#fca5a5', flex: 1 }}>⛔ {list.length} rota{list.length > 1 ? 's' : ''} com motorista Suspended/Deactivated no {shift}</span>
        <button onClick={() => void copy('at', list.map(r => r.atId).join('\n'))} style={btn}>{copied === 'at' ? '✓ Copiado' : '📋 ATs'}</button>
        <button onClick={() => void copy('all', list.map(r => `${r.atId}\t${r.gaiola ?? ''}\t${r.assignedDriverId}\t${r.assignedDriverName ?? ''}\t${issues.get(r.atId)!.label}`).join('\n'))} style={btn}>{copied === 'all' ? '✓ Copiado' : '📋 Lista'}</button>
        <button onClick={() => setOpen(v => !v)} style={btn}>{open ? '▲ Esconder' : '▼ Ver'}</button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflow: 'auto' }}>
          {list.map(r => (
            <div key={r.atId} style={{ fontSize: 12, color: '#fecaca' }}>
              <b>{r.gaiola ?? '—'}</b> · {r.atId} · {r.assignedDriverName ?? r.assignedDriverId} ({r.assignedDriverId}) — <b>{issues.get(r.atId)!.label}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
const btn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(252,165,165,.5)', color: '#fecaca', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
