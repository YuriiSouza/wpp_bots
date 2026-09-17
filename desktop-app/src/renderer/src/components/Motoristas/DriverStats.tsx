import type { StoredDriver } from '../../lib/localStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, PieChart, Pie, Legend } from 'recharts'

const STATUS_COLOR: Record<string, string> = {
  Active: '#22c55e',
  'Auto-Inactive': '#6b7280',
  Onboarding: '#3b82f6',
  'Pending Driver Acceptance': '#8b5cf6',
  Suspended: '#f59e0b',
  'Suspended(KYC)': '#ef4444',
  'Suspended(FV)': '#ef4444',
  'Pre-Suspended': '#f97316',
  Deactivated: '#dc2626',
  Terminated: '#374151',
  'Inactive Onboarding': '#4b5563',
}

const VEHICLE_COLOR: Record<string, string> = {
  Car: '#3b82f6', PASSEIO: '#3b82f6',
  Motorcycle: '#f59e0b', MOTO: '#f59e0b',
  Bicycle: '#22c55e', BICICLETA: '#22c55e',
  Walker: '#8b5cf6',
  Van: '#06b6d4', VAN: '#06b6d4', FIORINO: '#06b6d4',
}

function groupCount<T>(items: T[], key: (item: T) => string): { name: string; count: number }[] {
  const map = new Map<string, number>()
  for (const item of items) { const k = key(item) || 'N/A'; map.set(k, (map.get(k) ?? 0) + 1) }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

const TT = {
  contentStyle: { background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 6, fontSize: 11, color: '#e2e8f0' },
  labelStyle: { color: '#e2e8f0', fontWeight: 600 },
  itemStyle: { color: '#94a3b8' },
}

function HBar({ name, count, max, color, rank }: { name: string; count: number; max: number; color?: string; rank?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {rank !== undefined && <span style={{ fontSize: 10, color: '#374151', width: 16, textAlign: 'right', flexShrink: 0, fontWeight: 700 }}>#{rank}</span>}
      <span style={{ fontSize: 11, color: '#64748b', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
      <div style={{ flex: 1, height: 8, background: '#1e2130', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(count / max) * 100}%`, background: color ?? '#3b82f6', borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600, width: 36, textAlign: 'right', flexShrink: 0 }}>{count.toLocaleString('pt-BR')}</span>
    </div>
  )
}

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', ...style }}>
      <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0 }}>{title}</p>
      {children}
    </div>
  )
}

export default function DriverStats({ drivers }: { drivers: StoredDriver[] }) {
  const total = drivers.length
  const active = drivers.filter(d => d.status === 'Active').length
  const onboarding = drivers.filter(d => d.status === 'Onboarding').length
  const suspended = drivers.filter(d => d.status?.startsWith('Suspended')).length
  const inactive = total - active - onboarding - suspended

  const byStatus = groupCount(drivers, d => d.status)
  const byVehicle = groupCount(drivers, d => d.vehicleType).slice(0, 8)
  const byAgency = groupCount(drivers, d => d.agency === 'SPXOWNFLEET' ? 'Frota própria (SPX)' : d.agency || 'N/A')
  const byCity = groupCount(drivers, d => d.city).slice(0, 6)
  const byGender = groupCount(drivers, d => d.gender || 'N/A')

  const now = Date.now()
  const seniority = [
    { label: '<1m', min: 0, max: 30, color: '#ef4444' },
    { label: '1–3m', min: 30, max: 90, color: '#f59e0b' },
    { label: '3–6m', min: 90, max: 180, color: '#eab308' },
    { label: '6–12m', min: 180, max: 365, color: '#22c55e' },
    { label: '1–2a', min: 365, max: 730, color: '#3b82f6' },
    { label: '>2a', min: 730, max: Infinity, color: '#8b5cf6' },
  ].map(b => ({
    label: b.label, color: b.color,
    count: drivers.filter(d => {
      if (!d.joinedDate) return false
      const days = (now - new Date(d.joinedDate).getTime()) / 86400000
      return days >= b.min && days < b.max
    }).length,
  }))

  const genderPie = byGender.map((g, i) => ({
    ...g,
    fill: g.name === 'Male' ? '#3b82f6' : g.name === 'Female' ? '#ec4899' : ['#8b5cf6', '#22c55e', '#f59e0b'][i % 3],
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        {[
          { label: 'Total', value: total, color: '#e2e8f0' },
          { label: 'Ativos', value: active, color: '#22c55e', sub: `${Math.round(active / total * 100)}%` },
          { label: 'Onboarding', value: onboarding, color: '#3b82f6' },
          { label: 'Suspensos', value: suspended, color: '#f59e0b' },
          { label: 'Inativos', value: inactive, color: '#6b7280' },
        ].map(k => (
          <div key={k.label} style={{ flex: 1, background: '#13151f', border: '1px solid #2d3048', borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ margin: '0 0 2px', fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.label}</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value.toLocaleString('pt-BR')}</span>
              {k.sub && <span style={{ fontSize: 11, color: '#64748b' }}>{k.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Status stacked bar */}
      <Panel title="Status" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
          {byStatus.filter(s => s.count > 0).map(s => (
            <div key={s.name} title={`${s.name}: ${s.count}`}
              style={{ width: `${(s.count / total) * 100}%`, background: STATUS_COLOR[s.name] ?? '#4a5568' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {byStatus.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_COLOR[s.name] ?? '#4a5568', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: '#64748b' }}>{s.name}</span>
              <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600 }}>{s.count}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Main 3-column grid */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '220px 1fr 220px', gap: 10 }}>

        {/* Left col: Veículo + Agência */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <Panel title="Tipo de veículo" style={{ flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {byVehicle.map(v => (
                <HBar key={v.name} name={v.name} count={v.count} max={byVehicle[0].count}
                  color={VEHICLE_COLOR[v.name] ?? '#8b5cf6'} />
              ))}
            </div>
          </Panel>

          <Panel title="Agência" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {byAgency.slice(0, 5).map(a => (
                <HBar key={a.name} name={a.name} count={a.count} max={byAgency[0].count}
                  color={a.name.includes('SPX') || a.name.includes('Frota') ? '#22c55e' : '#8b5cf6'} />
              ))}
            </div>
          </Panel>
        </div>

        {/* Center: Tempo de casa */}
        <Panel title="Tempo de casa">
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={seniority} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip {...TT} formatter={(v: number) => [`${v.toLocaleString('pt-BR')} motoristas`, '']} />
                <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={60}>
                  {seniority.map((s, i) => <Cell key={i} fill={s.color} fillOpacity={0.9} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Right col: Gênero + Cidades */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <Panel title="Gênero" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PieChart width={80} height={80}>
                <Pie data={genderPie} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={22} outerRadius={38} paddingAngle={2}>
                  {genderPie.map((g, i) => <Cell key={i} fill={g.fill} />)}
                </Pie>
                <Tooltip {...TT} formatter={(v: number, name: string) => [`${v} (${Math.round(v / total * 100)}%)`, name]} />
              </PieChart>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                {genderPie.map(g => (
                  <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: g.fill, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#64748b', flex: 1 }}>{g.name}</span>
                    <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>{g.count.toLocaleString('pt-BR')}</span>
                    <span style={{ fontSize: 10, color: '#64748b', width: 28, textAlign: 'right' }}>{Math.round(g.count / total * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Top cidades" style={{ flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {byCity.map((c, i) => (
                <HBar key={c.name} name={c.name} count={c.count} max={byCity[0].count} rank={i + 1}
                  color={`hsl(${215 + i * 15}, 65%, 55%)`} />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
