import { useEffect, useState } from 'react'

type Phase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function UpdateModal(): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [transferred, setTransferred] = useState(0)
  const [total, setTotal] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const offAvailable = window.updater.onAvailable(info => {
      setVersion(info.version)
      setPhase('available')
      setDismissed(false)
    })
    const offProgress = window.updater.onProgress(p => {
      setPercent(p.percent)
      setTransferred(p.transferred)
      setTotal(p.total)
      setPhase('downloading')
    })
    const offDownloaded = window.updater.onDownloaded(info => {
      setVersion(info.version)
      setPercent(100)
      setPhase('downloaded')
    })
    const offError = window.updater.onError(e => {
      setErrorMsg(e.message)
      setPhase(prev => (prev === 'downloading' || prev === 'available' ? 'error' : prev))
    })
    const offNot = window.updater.onNotAvailable(() => {
      /* já está na versão mais recente — nada a fazer */
    })

    // Dispara a verificação só depois de registrar os listeners acima.
    window.updater.check().catch(() => {})

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
      offNot()
    }
  }, [])

  if (phase === 'idle' || dismissed) return null

  const startDownload = (): void => {
    setPhase('downloading')
    setPercent(0)
    window.updater.download().then(r => {
      if (!r.ok && r.error) {
        setErrorMsg(r.error)
        setPhase('error')
      }
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(5, 8, 14, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '90vw',
          background: '#141821',
          border: '1px solid #22c55e44',
          borderRadius: 12,
          padding: '22px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          color: '#e5e7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🆕</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#4ade80' }}>
            {phase === 'downloaded' ? 'Atualização pronta' : 'Atualização disponível'}
          </h2>
        </div>

        {phase === 'available' && (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#9ca3af' }}>
              A versão <strong style={{ color: '#e5e7eb' }}>{version}</strong> está disponível. Quer baixar e
              atualizar agora?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDismissed(true)} style={btnGhost}>
                Depois
              </button>
              <button onClick={startDownload} style={btnPrimary}>
                Atualizar agora
              </button>
            </div>
          </>
        )}

        {phase === 'downloading' && (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#9ca3af' }}>
              Baixando a versão <strong style={{ color: '#e5e7eb' }}>{version}</strong>…
            </p>
            <div style={{ background: '#0b0f17', borderRadius: 6, height: 12, overflow: 'hidden', border: '1px solid #ffffff14' }}>
              <div
                style={{
                  width: `${Math.max(2, percent)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg,#16a34a,#4ade80)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
              <span>{percent.toFixed(0)}%</span>
              {total > 0 && (
                <span>
                  {formatMB(transferred)} / {formatMB(total)} MB
                </span>
              )}
            </div>
          </>
        )}

        {phase === 'downloaded' && (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#9ca3af' }}>
              A versão <strong style={{ color: '#e5e7eb' }}>{version}</strong> foi baixada. Reinicie o app para aplicar.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDismissed(true)} style={btnGhost}>
                Depois
              </button>
              <button onClick={() => window.updater.install()} style={btnPrimary}>
                Reiniciar e instalar
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#fca5a5' }}>
              Não foi possível concluir a atualização: {errorMsg}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setDismissed(true)} style={btnGhost}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  background: '#22c55e',
  color: '#06240f',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
}

const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: '#9ca3af',
  border: '1px solid #ffffff22',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
