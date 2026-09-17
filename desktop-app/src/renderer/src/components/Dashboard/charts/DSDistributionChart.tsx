import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'
import type { DsBucket } from '../../../lib/types'

function bucketColor(label: string): string {
  if (label.startsWith('<')) return '#ef4444'
  if (label.startsWith('80') || label.startsWith('85')) return '#f59e0b'
  if (label.startsWith('90') || label.startsWith('93')) return '#3b82f6'
  return '#22c55e'
}

export default function DSDistributionChart({ buckets, height }: { buckets: DsBucket[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? 220}>
      <BarChart data={buckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
          itemStyle={{ color: '#94a3b8' }}
          formatter={(v: number) => [`${v} motoristas`, 'Quantidade']}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {buckets.map((b) => (
            <Cell key={b.label} fill={bucketColor(b.label)} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
