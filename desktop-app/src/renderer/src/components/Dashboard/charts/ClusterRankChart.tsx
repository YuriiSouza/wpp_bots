import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { ClusterStats } from '../../../lib/types'

interface Props {
  clusters: ClusterStats[]
  maxItems?: number
}

export default function ClusterRankChart({ clusters, maxItems = 20 }: Props) {
  const data = clusters.slice(0, maxItems).map(c => ({
    name: c.cluster.length > 12 ? c.cluster.slice(0, 12) + '…' : c.cluster,
    fullName: c.cluster,
    performance: Math.round(c.avgPerformance * 10000) / 100,
    routeCount: c.routeCount,
    sensitive: c.isSensitiveToVolume,
  }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 28)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" horizontal={false} />
        <XAxis type="number" domain={[80, 100]} tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
          formatter={(v: number, _: string, props) => [
            `${v.toFixed(2)}% (${props.payload.routeCount} rotas)${props.payload.sensitive ? ' ⚠️ sensível a volume' : ''}`,
            'Performance',
          ]}
        />
        <ReferenceLine x={96} stroke="#f59e0b" strokeDasharray="4 2" strokeWidth={1.5} />
        <Bar dataKey="performance" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.performance >= 96 ? '#22c55e' : d.performance >= 93 ? '#3b82f6' : d.performance >= 85 ? '#f59e0b' : '#ef4444'} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
