import { useEffect, useState } from 'react'
import { localStore, type StoredDriver } from '../../lib/localStore'
import DriverImport from './DriverImport'
import DriverStats from './DriverStats'
import DriverList from './DriverList'

type Tab = 'stats' | 'list' | 'phones'

function PhoneLookup({ drivers }: { drivers: StoredDriver[] }) {
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const ids = input.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean)
  const results = ids.map(id => {
    const d = drivers.find(d => d.id === id)
    return { id, name: d?.name ?? null, phone: d?.phoneNumber?.replace(/\D/g, '') ?? null }
  })
  const found = results.filter(r => r.phone)

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 600 }}>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={'Cole os IDs aqui (um por linha ou separados por vírgula)\n\nEx:\n12345678\n87654321'}
        rows={5}
        style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 8, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '10px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
      />

      {ids.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            <span style={{ fontSize: 12, color: '#8892a4' }}>{found.length} de {ids.length} encontrados</span>
            {found.length > 0 && (
              <button
                onClick={() => copy(found.map(r => r.phone).join('\n'), 'all')}
                style={{ background: copied === 'all' ? '#22c55e22' : '#22263a', color: copied === 'all' ? '#4ade80' : '#e2e8f0', border: `1px solid ${copied === 'all' ? '#22c55e44' : '#2d3048'}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                {copied === 'all' ? '✓ Copiado' : '📋 Copiar todos os números'}
              </button>
            )}
          </div>

          {results.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#1a1d27', border: `1px solid ${r.phone ? '#2d3048' : '#3f1515'}`, borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#64748b' }}>{r.id}</span>
                {r.name && <span style={{ fontSize: 12, color: '#e2e8f0', marginLeft: 8 }}>{r.name}</span>}
                {!r.phone && <span style={{ fontSize: 11, color: '#f87171', marginLeft: 8 }}>não encontrado</span>}
              </div>
              {r.phone && (
                <button
                  onClick={() => copy(r.phone!, r.id)}
                  style={{ flexShrink: 0, background: copied === r.id ? '#22c55e22' : 'transparent', color: copied === r.id ? '#4ade80' : '#3b82f6', border: `1px solid ${copied === r.id ? '#22c55e44' : '#1e40af44'}`, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'monospace' }}
                >
                  {copied === r.id ? '✓' : r.phone}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
            { key: 'list', label: `Lista (${drivers.length})` },
            { key: 'phones', label: '📞 Buscar telefones' },
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
      <div style={{ flex: 1, overflow: tab === 'stats' ? 'hidden' : 'auto', padding: tab === 'phones' ? '20px' : '16px 20px', display: 'flex', flexDirection: 'column' }}>
        {tab === 'stats' && <DriverStats drivers={drivers} />}
        {tab === 'list' && <DriverList drivers={drivers} />}
        {tab === 'phones' && <PhoneLookup drivers={drivers} />}
      </div>
    </div>
  )
}
