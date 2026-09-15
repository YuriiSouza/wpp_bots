import { useCallback, useState, useRef } from 'react'

interface Props {
  onFile: (csv: string, fileName: string) => void
  compact?: boolean
}

export default function FileUpload({ onFile, compact }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const readFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(csv|txt)$/i)) {
        alert('Por favor, selecione um arquivo CSV.')
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const csv = e.target?.result as string
        if (csv) onFile(csv, file.name)
      }
      reader.readAsText(file, 'UTF-8')
    },
    [onFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) readFile(file)
    },
    [readFile],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) readFile(file)
    },
    [readFile],
  )

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: compact ? 0 : '100vh',
        gap: 32,
        padding: compact ? '3rem 2rem' : '2rem',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#e2e8f0' }}>SPX Analytics</h1>
        <p style={{ margin: '8px 0 0', color: '#8892a4', fontSize: 14 }}>
          Dashboard de análise de DS — processamento 100% local
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          width: '100%',
          maxWidth: 520,
          border: `2px dashed ${dragging ? '#3b82f6' : '#2d3048'}`,
          borderRadius: 14,
          padding: '3rem 2rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? 'rgba(59,130,246,.06)' : '#1a1d27',
          transition: 'all .15s',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
        <p style={{ margin: 0, color: '#e2e8f0', fontWeight: 600 }}>
          Arraste o CSV aqui ou clique para selecionar
        </p>
        <p style={{ margin: '8px 0 0', color: '#8892a4', fontSize: 13 }}>
          Arquivo CSV com histórico de rotas SPX/Shopee Express
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt"
          style={{ display: 'none' }}
          onChange={onInputChange}
        />
      </div>

      {/* Required columns info */}
      <div style={{ maxWidth: 520, width: '100%', background: '#1a1d27', border: '1px solid #2d3048', borderRadius: 10, padding: '1rem 1.25rem' }}>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Colunas obrigatórias
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['date', 'driver_id'].map(c => (
            <span key={c} style={{ background: 'rgba(59,130,246,.15)', color: '#60a5fa', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontFamily: 'monospace' }}>
              {c}
            </span>
          ))}
        </div>
        <p style={{ margin: '12px 0 8px', fontSize: 12, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Colunas opcionais (métricas adicionais)
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['Performance', 'DataHoraPrimDelivered', 'DataHoraUltDelivered', 'dispatch_window', 'cluster_name', 'qty_delivering', 'vehicle_actual', '...'].map(c => (
            <span key={c} style={{ background: 'rgba(148,163,184,.1)', color: '#94a3b8', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
