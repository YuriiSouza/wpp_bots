import { useState, useEffect, useRef } from 'react'
import { getGlobalConfig, saveGlobalConfig, DEFAULT_CONFIG, type GlobalConfig, type Shift } from '../../lib/globalConfig'
import { pickFolder } from '../../lib/fileFinder'
import { getAppVersion } from '../../lib/updateChecker'
import { getSheetsConfig, saveSheetsConfig, pushToSheets, pullFromSheets, testSheetsConnection, getServiceAccountEmail, type SheetsConfig } from '../../lib/sheetsSync'

const SHIFTS: Shift[] = ['AM', 'PM1', 'PM2']
const SHIFT_LABEL: Record<Shift, string> = { AM: 'AM (manhã)', PM1: 'PM1 (tarde)', PM2: 'PM2 (noite)' }
const SHIFT_COLOR: Record<Shift, string> = { AM: '#fbbf24', PM1: '#60a5fa', PM2: '#a78bfa' }

const INPUT: React.CSSProperties = { background: '#0f1117', border: '1px solid #2d3048', borderRadius: 7, color: '#e2e8f0', fontSize: 12, padding: '7px 10px', width: '100%', boxSizing: 'border-box', outline: 'none' }
const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em' }
const HINT: React.CSSProperties = { margin: 0, fontSize: 12, color: '#8892a4', lineHeight: 1.5 }
const CODE: React.CSSProperties = { background: '#1a1d27', padding: '1px 5px', borderRadius: 3, fontSize: 11 }

function Btn({ onClick, disabled, children, variant = 'default' }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'default' | 'outline' }) {
  const v: Record<string, React.CSSProperties> = {
    default: { background: '#7c3aed', color: '#fff', border: '1px solid #7c3aed' },
    outline: { background: 'transparent', color: '#e2e8f0', border: '1px solid #2d3048' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...v[variant], borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .45 : 1, whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}

function Section({ title, hint, action, children }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{title}</h3>
        {action}
      </div>
      {hint && <p style={HINT}>{hint}</p>}
      {children}
    </div>
  )
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</p>
      {children}
    </div>
  )
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const c = ok ? '74,222,128' : '248,113,113'
  return (
    <div style={{ background: `rgba(${c},.08)`, border: `1px solid rgba(${c},.3)`, borderRadius: 6, padding: '7px 12px', fontSize: 12, color: ok ? '#4ade80' : '#f87171', fontWeight: 600 }}>
      {children}
    </div>
  )
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 110 }}>
      <label style={LABEL}>{label}</label>
      <input type="number" min={min} max={max} value={value} onChange={e => onChange(Math.max(min, parseInt(e.target.value) || min))} style={INPUT} />
    </div>
  )
}

export default function Configuracoes() {
  const [cfg, setCfg] = useState<GlobalConfig>(() => getGlobalConfig())
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => { getAppVersion().then(setAppVersion).catch(() => {}) }, [])

  const [sheets, setSheets] = useState<SheetsConfig>(() => getSheetsConfig())
  // A chave em uso nunca é exibida; ela só entra por importação do arquivo .json.
  const keyFileRef = useRef<HTMLInputElement>(null)
  const [keyFile, setKeyFile] = useState<{ ok: boolean; msg: string } | null>(null)
  const [sheetsSaved, setSheetsSaved] = useState(false)
  const [sheetsTest, setSheetsTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [sheetsOp, setSheetsOp] = useState<{ loading: boolean; msg: string | null }>({ loading: false, msg: null })
  const [sheetsTutOpen, setSheetsTutOpen] = useState(false)
  const accountEmail = getServiceAccountEmail(sheets.serviceAccountKeyJson)

  const update = (next: GlobalConfig) => { setCfg(next); setDirty(true); setSaved(false) }

  const handleSave = () => {
    saveGlobalConfig(cfg)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    // Mantém a pasta de downloads e o hub: "padrões" aqui são as regras de turno, rodízio e score.
    const next = { ...DEFAULT_CONFIG, downloadsFolder: cfg.downloadsFolder, hubName: cfg.hubName }
    setCfg(next)
    saveGlobalConfig(next)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // A pasta é salva na hora, sem depender do botão "Salvar".
  const setFolder = (folder: string) => {
    const next = { ...cfg, downloadsFolder: folder }
    setCfg(next)
    saveGlobalConfig({ ...getGlobalConfig(), downloadsFolder: folder })
  }

  const changeSheets = (patch: Partial<SheetsConfig>) => { setSheets(s => ({ ...s, ...patch })); setSheetsSaved(false); setSheetsTest(null) }

  // Importa o arquivo .json da conta de serviço, valida e já salva a conexão.
  const handleKeyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const key = JSON.parse(text) as { type?: string; client_email?: string; private_key?: string }
      if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error('não é uma chave de conta de serviço')
      const next = { ...sheets, serviceAccountKeyJson: text }
      setSheets(next)
      saveSheetsConfig(next)
      setSheetsTest(null)
      setKeyFile({ ok: true, msg: `Chave importada de ${file.name}.` })
    } catch (err) {
      setKeyFile({ ok: false, msg: `Arquivo inválido: ${err instanceof SyntaxError ? 'não é um JSON' : err instanceof Error ? err.message : String(err)}.` })
    }
  }

  const runSheets = async (op: 'push' | 'pull') => {
    setSheetsOp({ loading: true, msg: null })
    try {
      saveSheetsConfig(sheets)
      if (op === 'push') {
        const { written } = await pushToSheets()
        setSheetsOp({ loading: false, msg: `✓ ${written} itens enviados para a planilha.` })
      } else {
        const { restored } = await pullFromSheets()
        setSheetsOp({ loading: false, msg: `✓ ${restored} itens restaurados. Recarregando…` })
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch (err) {
      setSheetsOp({ loading: false, msg: `✕ ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const w = cfg.scoreWeights
  const weightTotal = w.dsWeight + w.declineWeight + w.noShowWeight

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Cabeçalho fixo */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #2d3048', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>⚙ Configurações</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#8892a4' }}>SPX Analytics{appVersion ? ` · v${appVersion}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && <span style={{ fontSize: 11, color: '#fbbf24' }}>● Alterações não salvas</span>}
          <Btn variant="outline" onClick={handleReset}>Restaurar padrões</Btn>
          <Btn onClick={handleSave} disabled={!dirty && !saved}>{saved ? '✓ Salvo!' : 'Salvar regras'}</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: 1280 }}>

          <Column title="Regras da operação">
            <Section title="Horários por turno" hint={<>Horários de início dos slots do Work Preference (ex: <code style={CODE}>05:30-09:00</code>) que identificam cada turno. Um por linha.</>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {SHIFTS.map(shift => (
                  <div key={shift} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ ...LABEL, color: SHIFT_COLOR[shift] }}>{SHIFT_LABEL[shift]}</label>
                    <textarea
                      value={cfg.shifts[shift].patterns.join('\n')}
                      onChange={e => update({ ...cfg, shifts: { ...cfg.shifts, [shift]: { patterns: e.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean) } } })}
                      rows={4}
                      style={{ ...INPUT, fontFamily: 'monospace', resize: 'vertical' }}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Rodízio" hint="Dias sem rota (desde a última chamada aceita) para classificar o motorista como MÉDIA ou ALTA rotatividade.">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <NumberField label="Baixa → Média (dias)" min={1} max={30} value={cfg.rodizio.mediaMinDays} onChange={v => update({ ...cfg, rodizio: { ...cfg.rodizio, mediaMinDays: v } })} />
                <NumberField label="Média → Alta (dias)" min={1} max={60} value={cfg.rodizio.altaMinDays} onChange={v => update({ ...cfg, rodizio: { ...cfg.rodizio, altaMinDays: v } })} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { label: 'BAIXA', color: '#4ade80', desc: `0 – ${cfg.rodizio.mediaMinDays - 1} dias` },
                  { label: 'MÉDIA', color: '#fbbf24', desc: `${cfg.rodizio.mediaMinDays} – ${cfg.rodizio.altaMinDays - 1} dias` },
                  { label: 'ALTA', color: '#f87171', desc: `≥ ${cfg.rodizio.altaMinDays} dias` },
                ].map(r => (
                  <div key={r.label} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.label}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{r.desc}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Score de prioridade" hint="Média ponderada de três notas de 0 a 100. Quanto maior o peso, mais aquele critério influencia a ordem da fila.">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <NumberField label="Peso DS" min={0} max={100} value={w.dsWeight} onChange={v => update({ ...cfg, scoreWeights: { ...w, dsWeight: v } })} />
                <NumberField label="Peso recusas" min={0} max={100} value={w.declineWeight} onChange={v => update({ ...cfg, scoreWeights: { ...w, declineWeight: v } })} />
                <NumberField label="Peso no-show" min={0} max={100} value={w.noShowWeight} onChange={v => update({ ...cfg, scoreWeights: { ...w, noShowWeight: v } })} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { name: 'DS', desc: 'DS_Real do motorista em % (sem DS = 50)', weight: w.dsWeight },
                  { name: 'Recusas', desc: '100 − taxa de recusa no Call Up (%)', weight: w.declineWeight },
                  { name: 'No-show', desc: '100 − 10 por no-show do relatório de disponibilidade', weight: w.noShowWeight },
                ].map(c => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                    <span style={{ width: 62, color: '#e2e8f0', fontWeight: 600 }}>{c.name}</span>
                    <span style={{ flex: 1, color: '#64748b' }}>{c.desc}</span>
                    <span style={{ color: '#94a3b8', fontWeight: 600 }}>{weightTotal > 0 ? Math.round((c.weight / weightTotal) * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </Section>
          </Column>

          <Column title="Integrações">
            <Section
              title="🔗 Google Sheets"
              hint="Planilha compartilhada: todos com acesso ao app (PC e celular) veem os mesmos dados."
              action={<button onClick={() => setSheetsTutOpen(true)} style={{ background: 'none', border: '1px solid #2d3048', borderRadius: 5, color: '#64748b', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>? como configurar</button>}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={LABEL}>URL ou ID da planilha</label>
                <input value={sheets.spreadsheetId} onChange={e => changeSheets({ spreadsheetId: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/..." style={{ ...INPUT, fontFamily: 'monospace' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={LABEL}>Chave da conta de serviço</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Btn variant="outline" onClick={() => keyFileRef.current?.click()}>📄 {accountEmail ? 'Trocar arquivo .json' : 'Importar arquivo .json'}</Btn>
                  <input ref={keyFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleKeyFile} />
                  <span style={{ fontSize: 11, color: accountEmail ? '#64748b' : '#fbbf24' }}>
                    {accountEmail ? <>Conta em uso: <span style={{ color: '#60a5fa' }}>{accountEmail}</span></> : 'Nenhuma chave configurada.'}
                  </span>
                </div>
                {keyFile && <Status ok={keyFile.ok}>{keyFile.ok ? '✓ ' : '✕ '}{keyFile.msg}</Status>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn onClick={() => { saveSheetsConfig(sheets); setSheetsSaved(true); setTimeout(() => setSheetsSaved(false), 2000) }}>{sheetsSaved ? '✓ Salvo!' : 'Salvar conexão'}</Btn>
                <Btn variant="outline" onClick={async () => {
                  setSheetsTest(null)
                  const r = await testSheetsConnection(sheets)
                  setSheetsTest(r.ok ? { ok: true, msg: `Conectado: "${r.title}"` } : { ok: false, msg: r.error ?? 'Erro' })
                }}>Testar conexão</Btn>
              </div>
              {sheetsTest && <Status ok={sheetsTest.ok}>{sheetsTest.ok ? '✓ ' : '✕ '}{sheetsTest.msg}</Status>}

              <div style={{ height: 1, background: '#2d3048' }} />

              <p style={HINT}><strong style={{ color: '#e2e8f0' }}>Enviar</strong> grava os dados deste computador na planilha. <strong style={{ color: '#e2e8f0' }}>Buscar</strong> substitui os dados daqui pelos da planilha.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn disabled={sheetsOp.loading} onClick={() => void runSheets('push')}>{sheetsOp.loading ? '…' : '⬆ Enviar para Sheets'}</Btn>
                <Btn variant="outline" disabled={sheetsOp.loading} onClick={() => void runSheets('pull')}>{sheetsOp.loading ? '…' : '⬇ Buscar do Sheets'}</Btn>
              </div>
              {sheetsOp.msg && <Status ok={sheetsOp.msg.startsWith('✓')}>{sheetsOp.msg}</Status>}
            </Section>

            <Section title="🗂 Pasta de downloads" hint={<>Onde os relatórios do SPX são baixados. A tela de Uploads busca aqui o arquivo mais recente de cada relatório (ex: <code style={CODE}>QueueList_*.csv</code>).</>}>
              <div style={{ ...INPUT, fontFamily: 'monospace', color: cfg.downloadsFolder ? '#e2e8f0' : '#64748b', wordBreak: 'break-all' }}>
                {cfg.downloadsFolder || 'Nenhuma pasta selecionada'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={async () => { const folder = await pickFolder(cfg.downloadsFolder || undefined); if (folder) setFolder(folder) }}>📁 Selecionar pasta</Btn>
                {cfg.downloadsFolder && <Btn variant="outline" onClick={() => setFolder('')}>Limpar</Btn>}
              </div>
            </Section>
          </Column>
        </div>
      </div>

      {/* Tutorial do Google Sheets */}
      {sheetsTutOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSheetsTutOpen(false)}>
          <div style={{ background: '#13151f', border: '1px solid #2d3048', borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>🔗 Como configurar o Google Sheets</span>
              <button onClick={() => setSheetsTutOpen(false)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            {[
              { n: '1', title: 'Crie ou abra uma planilha', body: 'Acesse sheets.google.com e crie uma planilha nova. O app cria sozinho a aba "app-data" na primeira sincronização.' },
              { n: '2', title: 'Compartilhe com a conta de serviço', body: <>Clique em <strong style={{ color: '#e2e8f0' }}>Compartilhar</strong> na planilha e adicione o e-mail abaixo como <strong style={{ color: '#e2e8f0' }}>Editor</strong>:<br /><code style={{ background: '#0f1117', padding: '4px 8px', borderRadius: 4, fontSize: 11, display: 'block', marginTop: 6, wordBreak: 'break-all', color: '#60a5fa' }}>{accountEmail || '(configure a chave da conta de serviço primeiro)'}</code></> },
              { n: '3', title: 'Cole o link da planilha', body: 'Copie o link da planilha no navegador e cole no campo "URL ou ID da planilha".' },
              { n: '4', title: 'Teste a conexão', body: 'Clique em "Testar conexão" para confirmar que o app consegue acessar a planilha.' },
              { n: '5', title: 'Sincronize os dados', body: 'Use "Enviar para Sheets" para gravar os dados deste computador, ou "Buscar do Sheets" para carregar os de outro.' },
            ].map(step => (
              <div key={step.n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#7c3aed', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{step.n}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{step.title}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{step.body}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
