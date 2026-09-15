import { useState } from 'react'
import type { AnalysisResult } from '../../lib/types'
import SummaryCards from './SummaryCards'
import DSTable from './DSTable'
import DSDistributionChart from './charts/DSDistributionChart'
import ClusterRankChart from './charts/ClusterRankChart'
import TimelineChart from './charts/TimelineChart'
import TurnComparisonChart from './charts/TurnComparisonChart'

const TABS = [
  { id: 'visao-geral', label: 'Visão Geral' },
  { id: 'motoristas', label: 'Motoristas DS' },
  { id: 'cluster', label: 'Por Cluster' },
  { id: 'turno', label: 'Por Turno' },
  { id: 'rotatividade', label: 'Rotatividade' },
  { id: 'spr', label: 'Sugestão SPR' },
  { id: 'alertas', label: 'Alertas' },
]

interface Props {
  result: AnalysisResult
  fileName: string
  onReset: () => void
}

function Section({ title, children, unavailable }: { title: string; children: React.ReactNode; unavailable?: boolean }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>{title}</h3>
        {unavailable && <span className="badge-amber">dados parcialmente indisponíveis</span>}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard({ result, fileName, onReset }: Props) {
  const [tab, setTab] = useState('visao-geral')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: '1px solid #2d3048', background: '#0f1117', flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>📦</span>
        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>SPX Analytics</span>
        <span style={{ color: '#8892a4', fontSize: 13, fontFamily: 'monospace' }}>{fileName}</span>
        {result.missingColumns.length > 0 && (
          <span className="badge-amber" title={`Colunas ausentes: ${result.missingColumns.join(', ')}`}>
            ⚠ {result.missingColumns.length} col. indisponíveis
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onReset}
          style={{ background: '#22263a', color: '#94a3b8', border: '1px solid #2d3048', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 13 }}
        >
          ← Novo arquivo
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 20px 0', borderBottom: '1px solid #2d3048', background: '#0f1117', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? '#1a1d27' : 'transparent',
              color: tab === t.id ? '#e2e8f0' : '#8892a4',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #3b82f6' : '2px solid transparent',
              borderRadius: '6px 6px 0 0',
              padding: '7px 14px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              transition: 'all .1s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'visao-geral' && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <SummaryCards summary={result.summary} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Section title="Distribuição de motoristas por faixa de DS_Real" unavailable={result.missingColumns.includes('Performance')}>
                <DSDistributionChart buckets={result.dsBuckets} />
              </Section>

              <Section title="Volume de rotas por dia" unavailable={!result.timeline.length}>
                <TimelineChart timeline={result.timeline} />
              </Section>
            </div>
          </div>
        )}

        {tab === 'motoristas' && (
          <Section title="Resultado por motorista — DS_Real">
            <DSTable drivers={result.drivers} />
          </Section>
        )}

        {tab === 'cluster' && (
          <div>
            <Section title="Ranking de clusters por performance (pior → melhor)" unavailable={result.missingColumns.includes('cluster_name') || result.missingColumns.includes('Performance')}>
              {result.clusterStats.length === 0 ? (
                <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum cluster com volume mínimo suficiente (15+ rotas) encontrado.</p>
              ) : (
                <>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: '#8892a4' }}>
                    Linha amarela = 96% (referência). ⚠️ = cluster sensível a volume (correlação &lt; −0.3)
                  </p>
                  <ClusterRankChart clusters={result.clusterStats} />
                </>
              )}
            </Section>

            <Section title="Detalhes por cluster">
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Cluster', 'Rotas', 'Perf. Geral', 'AM', 'PM1', 'Corr. Volume', 'Corr. Paradas', 'Obs.'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.clusterStats.map((c, i) => (
                      <tr key={c.cluster} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{c.cluster}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.routeCount}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={c.avgPerformance >= 0.96 ? 'badge-green' : c.avgPerformance >= 0.93 ? 'badge-blue' : 'badge-red'}>
                            {(c.avgPerformance * 100).toFixed(2)}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.amAvg !== null ? (c.amAvg * 100).toFixed(2) + '%' : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.pm1Avg !== null ? (c.pm1Avg * 100).toFixed(2) + '%' : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.correlationVolume !== null ? c.correlationVolume.toFixed(3) : '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{c.correlationStops !== null ? c.correlationStops.toFixed(3) : '—'}</td>
                        <td style={{ padding: '8px 12px' }}>{c.isSensitiveToVolume ? <span className="badge-amber">⚠ Sensível a volume</span> : <span className="badge-gray">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {tab === 'turno' && (
          <Section title="Performance por turno" unavailable={result.missingColumns.includes('dispatch_window')}>
            {result.turnStats.every(t => t.routeCount === 0) ? (
              <p style={{ color: '#8892a4', fontSize: 13 }}>Dados de turno indisponíveis (coluna dispatch_window ausente ou vazia).</p>
            ) : (
              <TurnComparisonChart turnStats={result.turnStats} />
            )}
          </Section>
        )}

        {tab === 'rotatividade' && (
          <div>
            <Section title="Concentração de rotas por tipo de veículo">
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Veículo', 'Motoristas', 'Top 20% concentram', 'Bottom 20% concentram'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.vehicleConcentration.map((v, i) => (
                      <tr key={v.vehicle} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{v.vehicle || 'N/A'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.totalDrivers}</td>
                        <td style={{ padding: '8px 12px' }}><span className={v.top20Pct > 60 ? 'badge-amber' : 'badge-green'}>{v.top20Pct}% das rotas</span></td>
                        <td style={{ padding: '8px 12px' }}><span className="badge-gray">{v.bottom20Pct}% das rotas</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Turnover por tipo de veículo">
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                      {['Veículo', 'Retidos', 'Saíram', 'Novos', 'Taxa de Turnover'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.turnoverByVehicle.map((v, i) => (
                      <tr key={v.vehicle} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontWeight: 500 }}>{v.vehicle}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.retained}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.churned}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{v.newDrivers}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={v.turnoverRate > 30 ? 'badge-red' : v.turnoverRate > 15 ? 'badge-amber' : 'badge-green'}>
                            {v.turnoverRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {tab === 'spr' && (
          <Section title="Sugestão de SPR — rotas PM1 por cluster" unavailable={result.missingColumns.includes('qty_delivering') || result.missingColumns.includes('Performance')}>
            {result.sprSuggestions.length === 0 ? (
              <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum cluster PM1 com volume suficiente para sugestão de SPR.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.sprSuggestions.map(s => (
                  <div key={s.cluster} style={{ background: '#22263a', border: '1px solid #2d3048', borderRadius: 8, padding: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{s.cluster}</span>
                      {s.suggestedSPR !== null
                        ? <span className="badge-green">SPR sugerido: {s.suggestedSPR} pacotes</span>
                        : <span className="badge-amber">{s.note}</span>
                      }
                    </div>
                    {s.bins.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.bins.map(b => (
                          <span key={b.label} style={{ fontSize: 11, background: b.avgPerformance >= 0.96 ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: b.avgPerformance >= 0.96 ? '#4ade80' : '#f87171', borderRadius: 4, padding: '2px 8px' }}>
                            {b.label}: {(b.avgPerformance * 100).toFixed(1)}% ({b.count})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {tab === 'alertas' && (
          <div>
            <Section title="⏰ Atraso na primeira entrega — turno AM" unavailable={result.missingColumns.includes('DataHoraPrimDelivered')}>
              {result.lateStartAlerts.length === 0 ? (
                <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhum atraso identificado (ou coluna indisponível).</p>
              ) : (
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                        {['Motorista', 'Rotas AM', 'Atrasos (≥12h)', '% Atraso'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.lateStartAlerts.slice(0, 50).map((a, i) => (
                        <tr key={a.driver_id} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: 12 }}>{a.driver_id}</td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.totalAmRoutes}</td>
                          <td style={{ padding: '8px 12px', color: '#f87171' }}>{a.lateCount}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className={a.latePct > 50 ? 'badge-red' : 'badge-amber'}>{a.latePct.toFixed(1)}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="🌙 Entregas de madrugada (00h–05h) — informativo, não conclusivo">
              <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
                ⚠ Estes registros podem indicar problema de sincronização do app ou padrão de entrega atípico. <strong>Não afirmam irregularidade</strong> — servem apenas como ponto de atenção para investigação.
              </div>
              {result.nightDeliveryAlerts.length === 0 ? (
                <p style={{ color: '#8892a4', fontSize: 13 }}>Nenhuma entrega de madrugada detectada.</p>
              ) : (
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #2d3048' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2d3048', background: '#1a1d27' }}>
                        {['Motorista', 'Data', 'Cluster', 'Hora última entrega'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#8892a4', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.nightDeliveryAlerts.slice(0, 100).map((a, i) => (
                        <tr key={`${a.driver_id}-${a.date}-${i}`} style={{ borderBottom: '1px solid #1e2130', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.012)' }}>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: 12 }}>{a.driver_id}</td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.date}</td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{a.cluster || '—'}</td>
                          <td style={{ padding: '8px 12px', color: '#fbbf24' }}>{new Date(a.ultDelivered).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.nightDeliveryAlerts.length > 100 && (
                    <p style={{ padding: '8px 12px', color: '#8892a4', fontSize: 12 }}>... e mais {result.nightDeliveryAlerts.length - 100} registros.</p>
                  )}
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
