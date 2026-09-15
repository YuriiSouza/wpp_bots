import { useRef, useState } from 'react'
import { parseDriverCsv } from '../../lib/driverParser'
import { localStore } from '../../lib/localStore'

interface Props {
  onImported: () => void
}

export default function DriverImport({ onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<{ total: number; skipped: number; fileName: string } | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const processFile = async (file: File) => {
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setError('Selecione um arquivo CSV.')
      setState('error')
      return
    }
    setState('processing')
    setError('')
    try {
      const text = await file.text()
      const parsed = parseDriverCsv(text)
      if (parsed.error) throw new Error(parsed.error)
      localStore.saveDrivers(parsed.drivers, { total: parsed.drivers.length, fileName: file.name })
      setResult({ total: parsed.total, skipped: parsed.skipped, fileName: file.name })
      setState('done')
      setTimeout(onImported, 600)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('error')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void processFile(file)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>Importar cadastro SPX</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#8892a4' }}>
          Arquivo <code style={{ fontSize: 11, background: '#22263a', padding: '1px 6px', borderRadius: 4 }}>br_driver_*.csv</code> exportado do painel SPX/Shopee Express
        </p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => state !== 'processing' && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? '#3b82f6' : state === 'done' ? '#22c55e' : state === 'error' ? '#ef4444' : '#2d3048'}`,
          borderRadius: 12,
          padding: '2.5rem',
          textAlign: 'center',
          cursor: state === 'processing' ? 'default' : 'pointer',
          background: dragging ? 'rgba(59,130,246,.06)' : '#1a1d27',
          transition: 'all .15s',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 10 }}>
          {state === 'processing' ? '⏳' : state === 'done' ? '✅' : state === 'error' ? '❌' : '📂'}
        </div>
        {state === 'idle' && (
          <>
            <p style={{ margin: 0, color: '#e2e8f0', fontWeight: 600 }}>Arraste o CSV ou clique para selecionar</p>
            <p style={{ margin: '6px 0 0', color: '#8892a4', fontSize: 12 }}>Relatório de motoristas SPX</p>
          </>
        )}
        {state === 'processing' && <p style={{ margin: 0, color: '#94a3b8' }}>Processando...</p>}
        {state === 'done' && result && (
          <div>
            <p style={{ margin: 0, color: '#4ade80', fontWeight: 600 }}>Importação concluída</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8892a4' }}>
              {result.total - result.skipped} motoristas importados
              {result.skipped > 0 ? ` · ${result.skipped} ignorados` : ''} de {result.fileName}
            </p>
          </div>
        )}
        {state === 'error' && (
          <div>
            <p style={{ margin: 0, color: '#f87171', fontWeight: 600 }}>Erro na importação</p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>{error}</p>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#8892a4' }}>Clique para tentar novamente</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void processFile(f); e.target.value = '' }} />
      </div>

      <div className="card-sm" style={{ fontSize: 12, color: '#8892a4' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#94a3b8' }}>Dados importados:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {['Status', 'Tipo de veículo', 'Gênero', 'Telefone', 'Placa', 'Validade CNH', 'Tipo de contrato', 'Data de entrada', 'Cidade', 'Agência', 'Fabricante/ano do veículo', 'Datas KYC', 'Motivo suspensão'].map(f => (
            <span key={f} style={{ background: 'rgba(148,163,184,.1)', color: '#94a3b8', borderRadius: 4, padding: '2px 8px' }}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
