import { useEffect, useState } from 'react'
import { localStore, type StoredDriver } from '../../lib/localStore'
import DriverImport from './DriverImport'
import DriverStats from './DriverStats'
import DriverAlerts from './DriverAlerts'
import DriverList from './DriverList'

type Tab = 'stats' | 'alerts' | 'list'

interface DriversAppProps {
  onImported?: () => void
}

export default function DriversApp({ onImported }: DriversAppProps = {}) {
  const [drivers, setDrivers] = useState<StoredDriver[]>([])
  const [meta, setMeta] = useState<{ total: number; fileName: string; importedAt: string } | null>(null)
  const [tab, setTab] = useState<Tab>('stats')
  const [importing, setImporting] = useState(false)

  const load = () => {
    const stored = localStore.getDrivers()
    const storedMeta = localStore.getMeta()
    setDrivers(stored)
    setMeta(storedMeta)
  }

  useEffect(() => { load() }, [])

  const onImportedInternal = () => {
    setImporting(false)
    load()
    onImported?.()
  }

  const alertCount = drivers.filter(d => {
    if (d.spxBlocklisted && d.status === 'Active') return true
    if (d.licenseExpiryDate) {
      const daysLeft = Math.floor((new Date(d.licenseExpiryDate).getTime() - Date.now()) / 86400000)
      if (daysLeft < 90 && d.status === 'Active') return true
    }
    if (d.lastKycDate) {
      const daysSince = Math.floor((Date.now() - new Date(d.lastKycDate).getTime()) / 86400000)
      if (daysSince > 180 && d.status === 'Active') return true
    }
    return false
  }).length

  if (importing || drivers.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '2rem', overflow: 'auto', gap: 20 }}>
        {drivers.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setImporting(false)}
              style={{ background: 'transparent', color: '#8892a4', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}
            >
              ← Voltar
            </button>
          </div>
        )}
        <DriverImport onImported={onImportedInternal} />
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 0', borderBottom: '1px solid #2d3048', background: '#0f1117', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>
              Motoristas SPX
            </h2>
            {meta && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>
                {meta.total} motoristas · {meta.fileName} · importado em {new Date(meta.importedAt).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
          <button
            onClick={() => setImporting(true)}
            style={{ background: '#22263a', color: '#e2e8f0', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12 }}
          >
            Atualizar cadastro
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0 }}>
          {([
            { key: 'stats', label: 'Estatísticas' },
            { key: 'alerts', label: `Alertas${alertCount > 0 ? ` (${alertCount})` : ''}` },
            { key: 'list', label: `Lista (${drivers.length})` },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'transparent',
                color: tab === t.key ? '#e2e8f0' : '#8892a4',
                border: 'none',
                borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: tab === t.key ? 600 : 400,
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {tab === 'stats' && <DriverStats drivers={drivers} />}
        {tab === 'alerts' && <DriverAlerts drivers={drivers} />}
        {tab === 'list' && <DriverList drivers={drivers} />}
      </div>
    </div>
  )
}
