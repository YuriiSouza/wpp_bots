import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import type { TimelinePoint } from '../../../lib/types'

export default function TimelineChart({ timeline }: { timeline: TimelinePoint[] }) {
  if (timeline.length === 0) return <p style={{ color: '#8892a4', fontSize: 13 }}>Sem dados de data disponíveis.</p>

  const maxCount = Math.max(...timeline.map(t => t.routeCount))
  const minCount = Math.min(...timeline.map(t => t.routeCount))
  const maxDate = timeline.find(t => t.routeCount === maxCount)?.date
  const minDate = timeline.find(t => t.routeCount === minCount)?.date

  // Show every Nth label to avoid crowding
  const step = Math.max(1, Math.floor(timeline.length / 12))
  const tickFormatter = (_: string, index: number) => {
    if (index % step !== 0) return ''
    return timeline[index]?.date?.slice(5) || '' // MM-DD
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={timeline} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#8892a4', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={tickFormatter} />
          <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0' }}
            formatter={(v: number) => [`${v} rotas`, '']}
          />
          {maxDate && <ReferenceLine x={maxDate} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'máx', position: 'top', fill: '#4ade80', fontSize: 10 }} />}
          {minDate && <ReferenceLine x={minDate} stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'mín', position: 'top', fill: '#f87171', fontSize: 10 }} />}
          <Line type="monotone" dataKey="routeCount" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#60a5fa' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
