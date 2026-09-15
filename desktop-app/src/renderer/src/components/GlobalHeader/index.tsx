import type { Shift } from '../../lib/globalConfig'

interface Props {
  day: string          // YYYY-MM-DD
  shift: Shift
  onDayChange: (d: string) => void
  onShiftChange: (s: Shift) => void
  spxConfigured: boolean
  onSpxClick: () => void
}

const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']

const SHIFT_COLOR: Record<Shift, { active: string; bg: string }> = {
  AM:  { active: '#fbbf24', bg: 'rgba(251,191,36,.18)' },
  PM1: { active: '#60a5fa', bg: 'rgba(96,165,250,.18)' },
  PM2: { active: '#a78bfa', bg: 'rgba(167,139,250,.18)' },
}

export default function GlobalHeader({ day, shift, onDayChange, onShiftChange, spxConfigured, onSpxClick }: Props) {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const dayLabel = day === today ? 'Hoje' : day === tomorrow ? 'Amanhã' : fmt(day)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '7px 20px',
      background: '#0a0c14', borderBottom: '1px solid #1e2130',
      flexShrink: 0, flexWrap: 'wrap',
    }}>
      {/* Day picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8892a4', fontWeight: 600 }}>DIA</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => {
              const d = new Date(day + 'T12:00:00')
              d.setDate(d.getDate() - 1)
              onDayChange(d.toISOString().slice(0, 10))
            }}
            style={ARROW_BTN}>‹</button>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="date"
              value={day}
              onChange={e => e.target.value && onDayChange(e.target.value)}
              style={{
                background: 'rgba(255,255,255,.06)', border: '1px solid #2d3048',
                color: '#e2e8f0', borderRadius: 6, padding: '4px 8px',
                fontSize: 12, cursor: 'pointer', width: 36, opacity: 0,
                position: 'absolute', inset: 0,
              }}
            />
            <span style={{
              background: 'rgba(255,255,255,.06)', border: '1px solid #2d3048',
              color: '#e2e8f0', borderRadius: 6, padding: '4px 10px',
              fontSize: 12, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>📅 {dayLabel}</span>
          </div>
          <button
            onClick={() => {
              const d = new Date(day + 'T12:00:00')
              d.setDate(d.getDate() + 1)
              onDayChange(d.toISOString().slice(0, 10))
            }}
            style={ARROW_BTN}>›</button>
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 24, background: '#2d3048' }} />

      {/* Shift selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#8892a4', fontWeight: 600 }}>TURNO</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {SHIFTS.map(s => {
            const active = s === shift
            const meta = SHIFT_COLOR[s]
            return (
              <button key={s} onClick={() => onShiftChange(s)} style={{
                background: active ? meta.bg : 'transparent',
                border: `1px solid ${active ? meta.active : '#2d3048'}`,
                color: active ? meta.active : '#64748b',
                borderRadius: 6, padding: '4px 12px', fontSize: 12,
                fontWeight: active ? 700 : 500, cursor: 'pointer',
                transition: 'all .12s',
              }}>{s}</button>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 24, background: '#2d3048' }} />

      {/* SPX */}
      <button onClick={onSpxClick} style={{
        background: 'transparent',
        border: `1px solid ${spxConfigured ? 'rgba(74,222,128,.3)' : 'rgba(251,191,36,.3)'}`,
        color: spxConfigured ? '#4ade80' : '#fbbf24',
        borderRadius: 6, padding: '4px 12px', fontSize: 11,
        fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
      }}>
        🔑 {spxConfigured ? 'SPX configurado' : 'Configurar SPX'}
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <span style={{ fontSize: 10, color: '#4a5568' }}>
        {fmt(day)} · {shift}
      </span>
    </div>
  )
}

const ARROW_BTN: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#64748b',
  fontSize: 16, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
}
