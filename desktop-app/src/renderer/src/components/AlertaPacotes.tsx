import { useMemo, useState } from 'react'
import type { StoredDriver } from '../lib/localStore'
import type { LocalRoute } from '../lib/noshowRouteParser'
import { CRITICAL_ABOVE, type ForwardOrderAnalysis } from '../lib/forwardOrderParser'
import type { Shift } from '../lib/globalConfig'

// Motoristas com rota atribuída no turno que ainda têm pacotes em Delivering ou OnHold (relatório de pacotes em aberto)
export interface PendingPk { driverId: string; name: string; delivering: number; onHold: number; total: number; phone: string; routes: LocalRoute[] }

export function usePendingPackages(routes: LocalRoute[], forwardOrder: ForwardOrderAnalysis | null, registry: StoredDriver[]) {
  return useMemo(() => {
    const fo = new Map((forwardOrder?.allDrivers ?? []).map(d => [d.driverId, d]))
    const reg = new Map(registry.map(d => [d.id, d]))
    const m = new Map<string, PendingPk>()
    for (const r of routes) {
      if (r.status !== 'ATRIBUIDA' || !r.assignedDriverId) continue
      const f = fo.get(r.assignedDriverId)
      if (!f || (f.delivering + f.onHold) <= CRITICAL_ABOVE) continue // só quem tem mais de 5 pacotes
      const cur = m.get(f.driverId)
      if (cur) { cur.routes.push(r); continue }
      m.set(f.driverId, { driverId: f.driverId, name: r.assignedDriverName || f.driverName, delivering: f.delivering, onHold: f.onHold, total: f.delivering + f.onHold, phone: (reg.get(f.driverId)?.phoneNumber ?? '').replace(/\D/g, ''), routes: [r] })
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [routes, forwardOrder, registry])
}

export function AlertaPacotes({ list, forwardOrder, shift }: { list: PendingPk[]; forwardOrder: ForwardOrderAnalysis | null; shift: Shift }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState('')
  if (!forwardOrder || list.length === 0) return null
  const copy = async (k: string, text: string) => { if (!text) return; await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) }
  const phones = (l: PendingPk[]) => l.map(d => d.phone).filter(Boolean).join('\n')
  const del = list.filter(d => d.delivering > 0), hold = list.filter(d => d.onHold > 0)
  const btn: React.CSSProperties = { background: 'transparent', border: '1px solid rgba(253,186,116,.5)', color: '#fed7aa', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
  return (
    <div style={{ margin: '10px 20px 0', borderRadius: 10, border: '2px solid #ea580c', background: 'rgba(234,88,12,.12)', boxShadow: '0 0 14px rgba(234,88,12,.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#fdba74', flex: 1 }}>📦 {list.length} motorista{list.length > 1 ? 's' : ''} com rota no {shift} e mais de {CRITICAL_ABOVE} pacotes em aberto (Delivering/OnHold)</span>
        <button onClick={() => void copy('all', phones(list))} style={btn}>{copied === 'all' ? '✓ Copiado' : `📱 Telefones (${list.filter(d => d.phone).length})`}</button>
        <button onClick={() => void copy('del', phones(del))} disabled={!del.length} style={btn}>{copied === 'del' ? '✓ Copiado' : `📱 Delivering (${del.length})`}</button>
        <button onClick={() => void copy('hold', phones(hold))} disabled={!hold.length} style={btn}>{copied === 'hold' ? '✓ Copiado' : `📱 OnHold (${hold.length})`}</button>
        <button onClick={() => void copy('lista', list.map(d => `${d.driverId}\t${d.name}\t${d.phone}\t${d.delivering}\t${d.onHold}\t${d.routes.map(r => r.atId).join(' ')}`).join('\n'))} style={btn}>{copied === 'lista' ? '✓ Copiado' : '📋 Lista'}</button>
        <button onClick={() => setOpen(v => !v)} style={btn}>{open ? '▲ Esconder' : '▼ Ver'}</button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflow: 'auto' }}>
          {list.map(d => (
            <div key={d.driverId} style={{ fontSize: 12, color: '#ffedd5' }}>
              <b>{d.name}</b> ({d.driverId}){d.phone ? ` · ${d.phone}` : ' · sem telefone no cadastro'} — {d.delivering > 0 && <b>{d.delivering} Delivering</b>}{d.delivering > 0 && d.onHold > 0 ? ' · ' : ''}{d.onHold > 0 && <b>{d.onHold} OnHold</b>} · rota {d.routes.map(r => r.gaiola ?? r.atId).join(', ')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
