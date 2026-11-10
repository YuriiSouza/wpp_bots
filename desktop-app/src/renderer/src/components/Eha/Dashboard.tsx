import { useMemo } from 'react'
import type { EhaCache } from '../../lib/planilhas'

// Dashboard de retirada de pacotes (EHA): cada pacote conta uma vez, no dia da última retirada.

const C = { card: '#13151f', border: '#2d3048', line: '#1e2130', text: '#e2e8f0', sub: '#94a3b8', muted: '#64748b', am: '#ea6a35', pm: '#2b7bd8', peer: '#8a8f80', red: '#f87171' }
const PM_FROM_MIN = 10 * 60 + 30

/** "2026-11-04 5:47:56" → { day: '2026-11-04', min: 347 } */
function parseWhen(s: string): { day: string; min: number } | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/)
  if (m) return { day: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5] }
  const b = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]?(\d{1,2})?:?(\d{2})?/)
  if (b) return { day: `${b[3]}-${b[2]}-${b[1]}`, min: b[4] ? +b[4] * 60 + +(b[5] ?? 0) : 0 }
  return null
}
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const shortStation = (s: string) => s.replace(/^LM\s*Hub[_\s]*/i, '').replace(/_/g, ' ').trim()
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Kpi({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px' }}>
      <p style={{ margin: 0, fontSize: 12, color: C.sub }}>{label}</p>
      <p style={{ margin: '10px 0 6px', fontSize: 34, fontWeight: 400, color: C.text, lineHeight: 1 }}>{value}</p>
      <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{sub}</p>
    </div>
  )
}

export default function EhaDashboard({ cache }: { cache: EhaCache }) {
  const today = localDay(new Date(cache.fetchedAt))
  const yesterday = addDays(today, -1)
  const d7 = addDays(today, -6), d14 = addDays(today, -13)

  const data = useMemo(() => {
    const rows = cache.rows.map(r => ({ r, w: parseWhen(r.lastEha) })).filter(x => x.w)
    const in7 = rows.filter(x => x.w!.day >= d7 && x.w!.day <= today)
    const prev7 = rows.filter(x => x.w!.day >= addDays(today, -13) && x.w!.day < d7)
    const days = Array.from({ length: 14 }, (_, i) => addDays(d14, i))
    const perDay = days.map(day => {
      const list = rows.filter(x => x.w!.day === day)
      return { day, am: list.filter(x => x.w!.min < PM_FROM_MIN).length, pm: list.filter(x => x.w!.min >= PM_FROM_MIN).length }
    })
    // Comparação com a sub-regional (últimos 7 dias)
    const peerMap = new Map<string, number>()
    for (const p of cache.peers ?? []) {
      const w = parseWhen(p.lastEha)
      if (w && w.day >= d7 && w.day <= today) peerMap.set(p.station, (peerMap.get(p.station) ?? 0) + 1)
    }
    if (!peerMap.has(cache.station) && in7.length) peerMap.set(cache.station, in7.length)
    const peers = [...peerMap.entries()].sort((a, b) => b[1] - a[1])
    const three = rows.filter(x => x.r.count >= 3).sort((a, b) => b.r.count - a.r.count || (b.r.lastEha > a.r.lastEha ? 1 : -1))
    const since = rows.map(x => x.w!.day).sort()[0]
    return {
      yesterday: rows.filter(x => x.w!.day === yesterday).length,
      last7: in7.length,
      last7pm: in7.filter(x => x.w!.min >= PM_FROM_MIN).length,
      prev7: prev7.length,
      reinc7: in7.filter(x => x.r.count >= 2).length,
      parados: cache.rows.filter(r => /sweeper/i.test(r.lastStatusDesc)).length,
      perDay, peers, three, since,
    }
  }, [cache, today, yesterday, d7, d14])

  // Gráfico por dia e turno
  const W = 900, H = 300, padL = 34, padB = 26, padT = 18
  const max = Math.max(5, ...data.perDay.map(d => Math.max(d.am, d.pm)))
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : 20
  const top = Math.ceil(max / step) * step
  const slot = (W - padL) / data.perDay.length
  const bw = Math.min(28, slot / 2 - 4)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top)
  const peerMax = Math.max(1, ...data.peers.map(p => p[1]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>Retirada de pacotes (EHA) — {shortStation(cache.station) || 'hub'}</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: C.sub }}>Base de {ddmm(today)}/{today.slice(0, 4)} · pacotes retirados do veículo por não caberem</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Kpi label={`Ontem (${ddmm(yesterday)})`} value={data.yesterday} sub="retirados" />
        <Kpi label="Últimos 7 dias" value={data.last7} sub={`${data.last7pm} no PM · ${data.prev7} na semana anterior`} />
        <Kpi label="Reincidentes (7 dias)" value={data.reinc7} sub="retirados 2+ vezes" />
        <Kpi label="Parados no hub" value={data.parados} sub="último status Sweeper Scan" />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>Retiradas por dia e turno — últimos 14 dias</p>
        <div style={{ display: 'flex', gap: 18, margin: '8px 0 4px', fontSize: 11, color: C.sub }}>
          <span><span style={{ display: 'inline-block', width: 22, height: 6, background: C.am, marginRight: 6, verticalAlign: 'middle' }} />AM (antes de 10:30)</span>
          <span><span style={{ display: 'inline-block', width: 22, height: 6, background: C.pm, marginRight: 6, verticalAlign: 'middle' }} />PM (a partir de 10:30)</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
          {Array.from({ length: top / step + 1 }, (_, i) => i * step).map(v => (
            <g key={v}>
              <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke={C.line} />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{v}</text>
            </g>
          ))}
          {data.perDay.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const bars: [number, string, number][] = d.am && d.pm ? [[d.am, C.am, cx - bw - 1], [d.pm, C.pm, cx + 1]] : d.am ? [[d.am, C.am, cx - bw / 2]] : d.pm ? [[d.pm, C.pm, cx - bw / 2]] : []
            return (
              <g key={d.day}>
                {bars.map(([v, c, x], j) => (
                  <g key={j}>
                    <rect x={x} y={y(v)} width={bw} height={y(0) - y(v)} fill={c} />
                    <text x={x + bw / 2} y={y(v) - 5} textAnchor="middle" fontSize={12} fill={C.text}>{v}</text>
                  </g>
                ))}
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill={d.day === today ? C.text : C.muted}>{ddmm(d.day)}</text>
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>Comparação com o {cache.subRegional || 'sub-regional'} — pacotes nos últimos 7 dias</p>
        {data.peers.length === 0 ? <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Clique em 🔄 Atualizar base para carregar as outras stations da sub-regional.</p> : data.peers.map(([st, n]) => {
          const mine = st === cache.station
          return (
            <div key={st} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, alignItems: 'center' }}>
              <span style={{ textAlign: 'right', fontSize: 13, color: mine ? C.text : C.sub, fontWeight: mine ? 800 : 400 }}>{shortStation(st)}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: `${Math.max(0.5, (n / peerMax) * 85)}%`, height: 24, background: mine ? C.pm : C.peer }} />
                <span style={{ fontSize: 13, color: C.text }}>{n}</span>
              </div>
            </div>
          )
        })}
      </div>

      {data.three.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: C.text }}>Atenção</p>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: C.sub }}>Pacotes que não couberam 3 vezes ou mais:</p>
          {data.three.map(x => (
            <p key={x.r.tn} style={{ margin: '2px 0', fontSize: 13, color: C.sub }}>
              • <span style={{ fontFamily: 'monospace', color: C.text }}>{x.r.tn}</span> — retirado {x.r.count}x (última: {ddmm(x.w!.day)} {String(Math.floor(x.w!.min / 60)).padStart(2, '0')}:{String(x.w!.min % 60).padStart(2, '0')})
            </p>
          ))}
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.sub }}>Provável volumoso: avaliar envio em Fiorino.</p>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 11, color: C.muted }}>
        Cada pacote conta uma vez, no dia da última retirada. O último dia é parcial (até a hora da base).{data.since ? ` Histórico desde ${ddmm(data.since)}/${data.since.slice(0, 4)}.` : ''}
      </p>
    </div>
  )
}
