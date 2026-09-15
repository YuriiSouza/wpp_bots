import type { StoredDriver } from '../../lib/localStore'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from 'recharts'

function groupCount<T>(items: T[], key: (item: T) => string): { name: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item) || 'N/A'
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

const STATUS_COLOR: Record<string, string> = {
  Active: '#22c55e',
  'Auto-Inactive': '#6b7280',
  Onboarding: '#3b82f6',
  Suspended: '#f59e0b',
  'Suspended(KYC)': '#ef4444',
  'Suspended(FV)': '#ef4444',
  Deactivated: '#dc2626',
  Terminated: '#7f1d1d',
}

function MiniBar({ data, label, colorFn }: {
  data: { name: string; count: number }[]
  label: string
  colorFn?: (name: string) => string
}) {
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div className="card-sm">
      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.slice(0, 8).map(d => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8', width: 130, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 8, background: '#22263a', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(d.count / data[0].count) * 100}%`, background: colorFn ? colorFn(d.name) : '#3b82f6', borderRadius: 4, transition: 'width .3s' }} />
            </div>
            <span style={{ fontSize: 11, color: '#e2e8f0', width: 36, textAlign: 'right', flexShrink: 0 }}>{d.count}</span>
            <span style={{ fontSize: 10, color: '#8892a4', width: 34, textAlign: 'right', flexShrink: 0 }}>{Math.round(d.count / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DriverStats({ drivers }: { drivers: StoredDriver[] }) {
  const byStatus = groupCount(drivers, d => d.status)
  const byVehicle = groupCount(drivers, d => d.vehicleType)
  const byAgency = groupCount(drivers, d =>
    d.agency === 'SPXOWNFLEET' ? 'Frota própria (SPX)' : d.agency || 'N/A'
  )
  const byCity = groupCount(drivers, d => d.city).slice(0, 10)
  const byGender = groupCount(drivers, d => d.gender || 'N/A')

  // Seniority buckets
  const now = Date.now()
  const seniorityBuckets = [
    { label: '< 1 mês', min: 0, max: 30 },
    { label: '1–3 meses', min: 30, max: 90 },
    { label: '3–6 meses', min: 90, max: 180 },
    { label: '6–12 meses', min: 180, max: 365 },
    { label: '1–2 anos', min: 365, max: 730 },
    { label: '> 2 anos', min: 730, max: Infinity },
  ]
  const seniority = seniorityBuckets.map(b => ({
    label: b.label,
    count: drivers.filter(d => {
      if (!d.joinedDate) return false
      const days = (now - new Date(d.joinedDate).getTime()) / 86400000
      return days >= b.min && days < b.max
    }).length,
  }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      <MiniBar data={byStatus} label="Status" colorFn={n => STATUS_COLOR[n] ?? '#8892a4'} />
      <MiniBar data={byVehicle} label="Tipo de veículo" />
      <MiniBar data={byAgency} label="Agência" colorFn={n => n.includes('SPX') ? '#22c55e' : '#8b5cf6'} />
      <MiniBar data={byCity} label="Top 10 cidades" />
      <MiniBar data={byGender} label="Gênero" colorFn={n => n === 'Male' ? '#3b82f6' : n === 'Female' ? '#ec4899' : '#8892a4'} />

      <div className="card-sm">
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Tempo de casa</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={seniority} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3048" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8892a4', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 12 }}
              formatter={(v: number) => [`${v} motoristas`, '']} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {seniority.map((_, i) => <Cell key={i} fill="#8b5cf6" fillOpacity={0.75 + i * 0.03} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
