import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { TurnStats } from '../../../lib/types'

export default function TurnComparisonChart({ turnStats }: { turnStats: TurnStats[] }) {
  const data = turnStats.map(t => ({
    turn: t.turn,
    'Perf. Média (%)': Math.round(t.avgPerformance * 10000) / 100,
    'Rotas': t.routeCount,
  }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8892a4', fontWeight: 600 }}>Performance média por turno</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" vertical={false} />
            <XAxis dataKey="turn" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis domain={[90, 100]} tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(2)}%`, 'Perf. Média']} />
            <Bar dataKey="Perf. Média (%)" fill="#3b82f6" radius={[4, 4, 0, 0]} fillOpacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8892a4', fontWeight: 600 }}>Volume de rotas por turno</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" vertical={false} />
            <XAxis dataKey="turn" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }} formatter={(v: number) => [`${v.toLocaleString('pt-BR')}`, 'Rotas']} />
            <Bar dataKey="Rotas" fill="#8b5cf6" radius={[4, 4, 0, 0]} fillOpacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export { Legend }
