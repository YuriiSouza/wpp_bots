import { useState, useRef } from 'react'
import { getGlobalConfig, saveGlobalConfig, DEFAULT_CONFIG, type GlobalConfig, type Shift } from '../../lib/globalConfig'
import { pickFolder } from '../../lib/fileFinder'

const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
const SHIFT_LABEL: Record<Shift, string> = { AM: 'AM (manhã)', PM1: 'PM1 (tarde)', PM2: 'PM2 (noite)' }

function Btn({ onClick, disabled, children, variant = 'default' }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'default' | 'outline' | 'danger' }) {
  const v: Record<string, React.CSSProperties> = {
    default: { background: '#7c3aed', color: '#fff', border: 'none' },
    outline: { background: 'transparent', color: '#e2e8f0', border: '1px solid #2d3048' },
    danger:  { background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...v[variant], borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1 }}>
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{title}</h3>
      {children}
    </div>
  )
}

// ─── Export / Import helpers ──────────────────────────────────────────────────
const EXPORT_PREFIX = 'spx:'
const EXTRA_KEYS = ['spx_ds_result']

function exportData(): void {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!
    if (key.startsWith(EXPORT_PREFIX) || EXTRA_KEYS.includes(key)) {
      data[key] = localStorage.getItem(key)!
    }
  }
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `spx-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importData(file: File): Promise<{ count: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Formato inválido.')
        const entries = Object.entries(parsed.data as Record<string, string>)
        for (const [key, val] of entries) {
          if ((key.startsWith(EXPORT_PREFIX) || EXTRA_KEYS.includes(key)) && typeof val === 'string') {
            localStorage.setItem(key, val)
          }
        }
        resolve({ count: entries.length })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'))
    reader.readAsText(file)
  })
}

export default function Configuracoes() {
  const [cfg, setCfg] = useState<GlobalConfig>(() => getGlobalConfig())
  const [saved, setSaved] = useState(false)
  const [importStatus, setImportStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const { count } = await importData(file)
      setImportStatus({ type: 'ok', msg: `${count} itens importados. A página será recarregada.` })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setImportStatus({ type: 'err', msg: String(err instanceof Error ? err.message : err) })
    }
  }

  const updateShiftPatterns = (shift: Shift, raw: string) => {
    const patterns = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
    setCfg(prev => ({ ...prev, shifts: { ...prev.shifts, [shift]: { patterns } } }))
    setSaved(false)
  }

  const handleSave = () => {
    saveGlobalConfig(cfg)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setCfg(DEFAULT_CONFIG)
    saveGlobalConfig(DEFAULT_CONFIG)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* Left col — main config */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>⚙ Configurações</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8892a4' }}>
            Defina como os turnos e o rodízio são calculados a partir dos dados importados.
          </p>
        </div>

        {/* Shift patterns */}
        <Section title="Horários por turno">
          <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
            O Work Preference mostra slots como <code style={{ background: '#1a1d27', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>05:30-09:00</code>.
            Informe quais horários de início identificam cada turno (um por linha ou separados por vírgula).
          </p>
          {SHIFTS.map(shift => (
            <div key={shift} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{SHIFT_LABEL[shift]}</label>
              <textarea
                value={cfg.shifts[shift].patterns.join('\n')}
                onChange={e => updateShiftPatterns(shift, e.target.value)}
                rows={3}
                style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '8px 10px', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
              />
              <p style={{ margin: 0, fontSize: 10, color: '#64748b' }}>
                Padrões atuais: {cfg.shifts[shift].patterns.map(p => `"${p}"`).join(', ')}
              </p>
            </div>
          ))}
        </Section>

        {/* Rodízio thresholds */}
        <Section title="Limiares de Rodízio">
          <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
            Define quantos dias sem rota classifica o motorista como MÉDIA ou ALTA rotatividade.
            Calculado a partir da data da última viagem (relatório DS ou Call Up).
          </p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#e2e8f0' }}>BAIXA → MÉDIA (dias sem rota)</label>
              <input type="number" min={1} max={30} value={cfg.rodizio.mediaMinDays}
                onChange={e => { setCfg(prev => ({ ...prev, rodizio: { ...prev.rodizio, mediaMinDays: Math.max(1, parseInt(e.target.value) || 1) } })); setSaved(false) }}
                style={{ width: 80 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#e2e8f0' }}>MÉDIA → ALTA (dias sem rota)</label>
              <input type="number" min={1} max={60} value={cfg.rodizio.altaMinDays}
                onChange={e => { setCfg(prev => ({ ...prev, rodizio: { ...prev.rodizio, altaMinDays: Math.max(1, parseInt(e.target.value) || 1) } })); setSaved(false) }}
                style={{ width: 80 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            {[
              { label: 'BAIXA', color: '#4ade80', desc: `0 – ${cfg.rodizio.mediaMinDays - 1} dias` },
              { label: 'MÉDIA', color: '#fbbf24', desc: `${cfg.rodizio.mediaMinDays} – ${cfg.rodizio.altaMinDays - 1} dias` },
              { label: 'ALTA',  color: '#f87171', desc: `≥ ${cfg.rodizio.altaMinDays} dias` },
            ].map(r => (
              <div key={r.label} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2d3048', borderRadius: 6, padding: '6px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.label}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{r.desc}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Score weights */}
        <Section title="Pesos do Score de Prioridade">
          <p style={{ margin: 0, fontSize: 12, color: '#8892a4' }}>
            O score é calculado como: <code style={{ background: '#1a1d27', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>(DS% × dsW + (100−recusas%) × declW + max(0, 100−noshow×10) × nsW) / (dsW+declW+nsW)</code>.
            O resultado fica entre 0 e 100.
          </p>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {([
              { key: 'dsWeight', label: 'Peso DS' },
              { key: 'declineWeight', label: 'Peso Recusas' },
              { key: 'noShowWeight', label: 'Peso NoShow' },
            ] as const).map(f => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: '#e2e8f0' }}>{f.label}</label>
                <input type="number" min={0} max={100} value={cfg.scoreWeights[f.key]}
                  onChange={e => { setCfg(prev => ({ ...prev, scoreWeights: { ...prev.scoreWeights, [f.key]: Math.max(0, parseInt(e.target.value) || 0) } })); setSaved(false) }}
                  style={{ width: 80 }} />
              </div>
            ))}
          </div>
          {(() => {
            const w = cfg.scoreWeights
            const total = w.dsWeight + w.declineWeight + w.noShowWeight
            return (
              <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
                Total dos pesos: <strong style={{ color: total === 75 ? '#4ade80' : '#fbbf24' }}>{total}</strong>
                {total !== 75 && ' (padrão é 75 — pode ser qualquer valor, é normalizado automaticamente)'}
              </p>
            )
          })()}
        </Section>

        {/* Save / reset */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn onClick={handleSave}>{saved ? '✓ Salvo!' : 'Salvar configurações'}</Btn>
          <Btn variant="outline" onClick={handleReset}>Restaurar padrões</Btn>
        </div>
      </div>

      {/* Right col — folder + export/import */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>🗂 Downloads</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8892a4' }}>
            Pasta onde os relatórios SPX são baixados — usada para busca automática na tela de uploads.
          </p>
        </div>

        <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Pasta configurada</label>
            <div style={{ background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, padding: '7px 10px', fontSize: 12, fontFamily: 'monospace', color: cfg.downloadsFolder ? '#e2e8f0' : '#64748b', minHeight: 32, wordBreak: 'break-all' }}>
              {cfg.downloadsFolder || 'Nenhuma pasta selecionada'}
            </div>
          </div>
          <Btn onClick={async () => {
            const folder = await pickFolder(cfg.downloadsFolder || undefined)
            if (folder) { setCfg(prev => ({ ...prev, downloadsFolder: folder })); setSaved(false) }
          }}>
            📁 Selecionar pasta
          </Btn>
          {cfg.downloadsFolder && (
            <Btn variant="outline" onClick={() => { setCfg(prev => ({ ...prev, downloadsFolder: '' })); setSaved(false) }}>
              Limpar
            </Btn>
          )}
          <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>
            O app busca o arquivo mais recente que bate com o padrão de cada relatório (ex: <code style={{ background: '#1a1d27', padding: '1px 4px', borderRadius: 3 }}>QueueList_*.csv</code>).
          </p>
        </div>

        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>📦 Dados</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8892a4' }}>
            Migre todos os dados do app entre computadores sem precisar baixar tudo novamente.
          </p>
        </div>

        <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Export */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>⬇ Exportar</p>
            <p style={{ margin: 0, fontSize: 12, color: '#8892a4', lineHeight: 1.5 }}>
              Gera um arquivo <code style={{ background: '#1a1d27', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>.json</code> com motoristas, filas de atribuição, relatórios e configurações.
            </p>
            <Btn onClick={exportData}>Exportar dados</Btn>
          </div>

          <div style={{ height: 1, background: '#2d3048' }} />

          {/* Import */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>⬆ Importar</p>
            <p style={{ margin: 0, fontSize: 12, color: '#8892a4', lineHeight: 1.5 }}>
              Selecione um arquivo de backup. Os dados atuais serão substituídos e o app recarregado.
            </p>
            <Btn variant="outline" onClick={() => fileRef.current?.click()}>Selecionar arquivo</Btn>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
            {importStatus && (
              <div style={{ background: importStatus.type === 'ok' ? 'rgba(74,222,128,.1)' : 'rgba(248,113,113,.1)', border: `1px solid ${importStatus.type === 'ok' ? 'rgba(74,222,128,.3)' : 'rgba(248,113,113,.3)'}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: importStatus.type === 'ok' ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                {importStatus.type === 'ok' ? '✓ ' : '✕ '}{importStatus.msg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
