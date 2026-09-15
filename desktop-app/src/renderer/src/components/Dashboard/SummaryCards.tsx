import type { SummaryStats } from '../../lib/types'

function pct(v: number | null, decimals = 2) {
  if (v === null) return '—'
  return (v * 100).toFixed(decimals) + '%'
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-sm" style={{ flex: 1, minWidth: 140 }}>
      <p style={{ margin: 0, fontSize: 11, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{value}</p>
      {sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>{sub}</p>}
    </div>
  )
}

export default function SummaryCards({ summary }: { summary: SummaryStats }) {
  const { statusCounts } = summary
  const total = statusCounts.Melhorando + statusCounts.Piorando + statusCounts.Estagnado

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <StatCard label="Total de rotas" value={summary.totalRoutes.toLocaleString('pt-BR')} sub={`${summary.periodStart} → ${summary.periodEnd}`} />
      <StatCard label="Motoristas" value={summary.totalDrivers.toString()} />
      <StatCard label="DS_Real médio" value={pct(summary.avgDsReal)} />
      <StatCard label="DS_Real mediano" value={pct(summary.medianDsReal)} />
      <div className="card-sm" style={{ flex: 1, minWidth: 200 }}>
        <p style={{ margin: 0, fontSize: 11, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Tendência da frota</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="badge-green">↑ {statusCounts.Melhorando} Melhorando ({total > 0 ? Math.round(statusCounts.Melhorando / total * 100) : 0}%)</span>
          <span className="badge-red">↓ {statusCounts.Piorando} Piorando ({total > 0 ? Math.round(statusCounts.Piorando / total * 100) : 0}%)</span>
          <span className="badge-gray">→ {statusCounts.Estagnado} Estagnado</span>
        </div>
      </div>
    </div>
  )
}
