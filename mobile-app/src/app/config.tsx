import { useState, useEffect } from 'react'
import { View } from 'react-native'
import Constants from 'expo-constants'
import { Btn, C, Card, Input, Row, Screen, SHIFTS, Sheet, T } from '@/components/ui'
import { DEFAULT_CONFIG, getGlobalConfig, saveGlobalConfig, type GlobalConfig, type Shift } from '@/lib/globalConfig'
import { DEFAULT_SPREADSHEET_ID, getSheetsConfig, saveSheetsConfig, testConnection } from '@/lib/sheetsSync'
import { useGoogleSignIn, isSignedIn, getAuthEmail, signOut } from '@/lib/googleAuth'
import { useSync } from '@/lib/sync'
import { getSpxCreds } from '@/features/noshow/logic'
import { SpxCredsSheet } from '@/features/noshow/panels'

const SHIFT_LABEL: Record<Shift, string> = { AM: 'AM (manhã)', PM1: 'PM1 (tarde)', PM2: 'PM2 (noite)' }

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}><T bold size={14}>{title}</T>{right}</Row>
      {children}
    </Card>
  )
}

export default function Config() {
  const sync = useSync()
  const [sheets, setSheets] = useState(() => getSheetsConfig())
  const [sheetsMsg, setSheetsMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [tutOpen, setTutOpen] = useState(false)
  const [spxOpen, setSpxOpen] = useState(false)
  const [spxConfigured, setSpxConfigured] = useState(() => !!getSpxCreds())
  const [cfg, setCfg] = useState<GlobalConfig>(() => getGlobalConfig())
  const [saved, setSaved] = useState(false)

  // Login Google por usuário (o token fica no SecureStore, nunca no bundle).
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  useEffect(() => {
    isSignedIn().then(async s => setAuthEmail(s ? (await getAuthEmail()) || 'conta Google' : null))
  }, [])
  const testAndSync = async () => {
    saveSheetsConfig(sheets)
    try {
      const title = await testConnection(sheets)
      setSheetsMsg({ ok: true, text: `Conectado: "${title}"` })
      void sync.sync()
    } catch (e) {
      setSheetsMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }
  const { ready, promptAsync } = useGoogleSignIn(async (email, error) => {
    setAuthLoading(false)
    if (error) { setSheetsMsg({ ok: false, text: 'Login falhou: ' + error }); return }
    setAuthEmail(email || 'conta Google')
    await testAndSync()
  })
  const doSignIn = () => { setAuthLoading(true); setSheetsMsg(null); promptAsync() }
  const doSignOut = async () => { await signOut(); setAuthEmail(null); setSheetsMsg(null) }
  const saveSheets = async () => {
    setTesting(true)
    setSheetsMsg(null)
    await testAndSync()
    setTesting(false)
  }

  const saveCfg = () => { saveGlobalConfig(cfg); setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const num = (v: string, min: number) => Math.max(min, parseInt(v) || min)

  return (
    <Screen>
      <Section title="🔗 Google Sheets" right={<Btn small variant="ghost" onPress={() => setTutOpen(true)}>? como configurar</Btn>}>
        <T size={12} color={C.muted}>Todos que usam o app (PC e celular) enxergam os mesmos dados através desta planilha.</T>
        <T size={11} bold color={C.muted}>URL OU ID DA PLANILHA</T>
        <Input mono value={sheets.spreadsheetId} onChangeText={v => { setSheets(s => ({ ...s, spreadsheetId: v })); setSheetsMsg(null) }} placeholder="https://docs.google.com/spreadsheets/d/..." />
        {sheets.spreadsheetId !== DEFAULT_SPREADSHEET_ID && <Btn small variant="ghost" onPress={() => setSheets(s => ({ ...s, spreadsheetId: DEFAULT_SPREADSHEET_ID }))}>Usar planilha padrão</Btn>}
        <T size={11} bold color={C.muted}>CONTA GOOGLE</T>
        {authEmail ? (
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <T size={12} color={C.dim}>Conectado: <T size={12} color={C.blue}>{authEmail}</T></T>
            <Btn small variant="ghost" onPress={() => void doSignOut()}>Sair</Btn>
          </Row>
        ) : (
          <T size={11} color={C.muted}>Entre com uma conta Google que tenha acesso à planilha.</T>
        )}
        {authEmail
          ? <Btn loading={testing} onPress={() => void saveSheets()}>Testar conexão</Btn>
          : <Btn loading={authLoading} disabled={!ready} onPress={doSignIn}>🔑 Entrar com Google</Btn>}
        {sheetsMsg && <T size={12} bold color={sheetsMsg.ok ? C.green : C.red}>{sheetsMsg.ok ? '✓ ' : '✕ '}{sheetsMsg.text}</T>}
      </Section>

      <Section title="🔑 Credenciais SPX">
        <T size={12} color={C.muted}>Necessárias para atribuir rotas direto no SPX pelo celular. Ficam só neste aparelho e não vão para a planilha.</T>
        <Row>
          <T size={12} bold color={spxConfigured ? C.green : C.yellow}>{spxConfigured ? '✓ Configurado' : '⚠ Não configurado'}</T>
          <Btn small variant="outline" onPress={() => setSpxOpen(true)}>{spxConfigured ? 'Atualizar' : 'Configurar'}</Btn>
        </Row>
      </Section>

      <Section title="Horários por turno">
        <T size={12} color={C.muted}>Horários de início dos slots do Work Preference (ex: 05:30) que identificam cada turno. Um por linha ou separados por vírgula.</T>
        {SHIFTS.map(s => (
          <View key={s} style={{ gap: 4 }}>
            <T size={12} bold>{SHIFT_LABEL[s]}</T>
            <Input mono multiline value={cfg.shifts[s].patterns.join('\n')} style={{ minHeight: 70 }}
              onChangeText={v => setCfg(p => ({ ...p, shifts: { ...p.shifts, [s]: { patterns: v.split(/[,\n]/).map(x => x.trim()).filter(Boolean) } } }))} />
          </View>
        ))}
      </Section>

      <Section title="Limiares de rodízio">
        <T size={12} color={C.muted}>Dias sem rota para classificar como MÉDIA ou ALTA rotatividade.</T>
        <Row>
          <View style={{ flex: 1, gap: 4 }}><T size={11} color={C.sub}>BAIXA → MÉDIA</T><Input keyboardType="number-pad" value={String(cfg.rodizio.mediaMinDays)} onChangeText={v => setCfg(p => ({ ...p, rodizio: { ...p.rodizio, mediaMinDays: num(v, 1) } }))} /></View>
          <View style={{ flex: 1, gap: 4 }}><T size={11} color={C.sub}>MÉDIA → ALTA</T><Input keyboardType="number-pad" value={String(cfg.rodizio.altaMinDays)} onChangeText={v => setCfg(p => ({ ...p, rodizio: { ...p.rodizio, altaMinDays: num(v, 1) } }))} /></View>
        </Row>
        <T size={11} color={C.dim}>BAIXA 0–{cfg.rodizio.mediaMinDays - 1} dias · MÉDIA {cfg.rodizio.mediaMinDays}–{cfg.rodizio.altaMinDays - 1} · ALTA ≥ {cfg.rodizio.altaMinDays}</T>
      </Section>

      <Section title="Pesos do score de prioridade">
        <T size={11} color={C.muted}>(DS% × dsW + (100 − taxa de recusa%) × declW + (100 − noshow×10) × nsW) / soma dos pesos</T>
        <Row>
          {([['dsWeight', 'DS'], ['declineWeight', 'Recusas'], ['noShowWeight', 'NoShow']] as const).map(([k, l]) => (
            <View key={k} style={{ flex: 1, gap: 4 }}>
              <T size={11} color={C.sub}>Peso {l}</T>
              <Input keyboardType="number-pad" value={String(cfg.scoreWeights[k])} onChangeText={v => setCfg(p => ({ ...p, scoreWeights: { ...p.scoreWeights, [k]: num(v, 0) } }))} />
            </View>
          ))}
        </Row>
      </Section>

      <Row>
        <Btn onPress={saveCfg}>{saved ? '✓ Salvo!' : 'Salvar configurações'}</Btn>
        <Btn variant="outline" onPress={() => { setCfg(DEFAULT_CONFIG); saveGlobalConfig(DEFAULT_CONFIG) }}>Restaurar padrões</Btn>
      </Row>
      <T size={11} color={C.faint} style={{ textAlign: 'center' }}>SPX Analytics mobile · v{Constants.expoConfig?.version ?? '1.0.0'}</T>

      <SpxCredsSheet open={spxOpen} onClose={() => setSpxOpen(false)} configured={spxConfigured} onChange={setSpxConfigured} />
      <Sheet open={tutOpen} onClose={() => setTutOpen(false)} title="🔗 Como configurar o Google Sheets">
        {[
          { n: '1', title: 'Compartilhe a planilha', body: 'No Google Sheets, use Compartilhar e adicione as contas Google autorizadas como Editor. Só quem estiver na lista consegue acessar pelo app.' },
          { n: '2', title: 'Entre com o Google', body: 'Toque em "Entrar com Google" e faça login com uma conta que tenha acesso à planilha.' },
          { n: '3', title: 'Confira a planilha', body: 'A planilha padrão já vem preenchida. Para usar outra, cole o link dela no campo acima.' },
          { n: '4', title: 'Teste e sincronize', body: 'Toque em "Testar conexão". Se aparecer "Conectado", os dados já começam a sincronizar.' },
        ].map(s => (
          <Row key={s.n} style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }} gap={12}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><T bold color="#fff">{s.n}</T></View>
            <View style={{ flex: 1, gap: 3 }}>
              <T bold>{s.title}</T>
              <T size={12} color={C.sub}>{s.body}</T>
            </View>
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
