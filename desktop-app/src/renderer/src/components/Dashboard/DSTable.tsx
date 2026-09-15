import { useState, useMemo } from 'react'
import type { DriverResult } from '../../lib/types'

function pct(v: number | null, dec = 2) {
  return v === null ? '—' : (v * 100).toFixed(dec) + '%'
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'Melhorando' ? 'badge-green' : status === 'Piorando' ? 'badge-red' : 'badge-gray'
  const icon = status === 'Melhorando' ? '↑' : status === 'Piorando' ? '↓' : '→'
  return <span className={cls}>{icon} {status}</span>
}

function DsBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="badge-gray">—</span>
  const pctVal = value * 100
  const cls = pctVal >= 97 ? 'badge-green' : pctVal >= 93 ? 'badge-blue' : pctVal >= 85 ? 'badge-amber' : 'badge-red'
  return <span className={cls}>{(pctVal).toFixed(2)}%</span>
}

interface Props {
  drivers: DriverResult[]
}

type SortKey = keyof DriverResult
type SortDir = 'asc' | 'desc'

export default function DSTable({ drivers }: Props) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('DS_Real')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return drivers.filter(d => d.driver_id.toLowerCase().includes(q))
  }, [drivers, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }

  const exportCSV = () => {
    const headers = ['driver_id', 'Media_Performance', 'Status', 'Nivel_Entrega_Dia', 'DS_Real', 'route_count']
    const rows = sorted.map(d => [
      d.driver_id,
      d.Media_Performance !== null ? (d.Media_Performance * 100).toFixed(4) : '',
      d.Status,
      d.Nivel_Entrega_Dia !== null ? (d.Nivel_Entrega_Dia * 100).toFixed(4) : '',
      d.DS_Real !== null ? (d.DS_Real * 100).toFixed(4) : '',
      d.route_count,
    ].join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ds_real_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const Col = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer', userSelect: 'none', fontSize: 12, color: sortKey === k ? '#60a5fa' : '#8892a4', whiteSpace: 'nowrap', fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase' }}
    >
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <input
          type="text"
          placeholder="Buscar motorista..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          style={{ width: 240 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#8892a4' }}>{sorted.length} motoristas</span>
          <button
            onClick={exportCSV}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
              <Col k="driver_id" label="ID Motorista" />
              <Col k="route_count" label="Rotas" />
              <Col k="Media_Performance" label="Média Perf." />
              <Col k="Nivel_Entrega_Dia" label="Nível Entrega Dia" />
              <Col k="DS_Real" label="DS_Real" />
              <Col k="Status" label="Tendência" />
            </tr>
          </thead>
          <tbody>
            {paged.map((d, i) => (
              <tr key={d.driver_id} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: 12 }}>{d.driver_id}</td>
                <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{d.route_count}</td>
                <td style={{ padding: '8px 12px' }}>{pct(d.Media_Performance)}</td>
                <td style={{ padding: '8px 12px' }}>{pct(d.Nivel_Entrega_Dia)}</td>
                <td style={{ padding: '8px 12px' }}><DsBadge value={d.DS_Real} /></td>
                <td style={{ padding: '8px 12px' }}><StatusBadge status={d.Status} /></td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#8892a4', fontSize: 13 }}>
                  Nenhum motorista encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1, fontSize: 13 }}>
            ←
          </button>
          <span style={{ fontSize: 13, color: '#8892a4', alignSelf: 'center' }}>
            Pág. {page + 1} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '4px 12px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? 0.4 : 1, fontSize: 13 }}>
            →
          </button>
        </div>
      )}
    </div>
  )
}
