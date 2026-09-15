import type { StoredDriver } from '../../lib/localStore'

interface LicenseAlert {
  driver: StoredDriver
  daysLeft: number
  expired: boolean
}

interface KycAlert {
  driver: StoredDriver
  daysSince: number
}

export default function DriverAlerts({ drivers }: { drivers: StoredDriver[] }) {
  const now = Date.now()
  const WARN_DAYS = 90
  const KYC_STALE_DAYS = 180

  const licenseAlerts: LicenseAlert[] = drivers
    .filter(d => d.licenseExpiryDate && d.status === 'Active')
    .map(d => {
      const expiry = new Date(d.licenseExpiryDate).getTime()
      const daysLeft = Math.floor((expiry - now) / 86400000)
      return { driver: d, daysLeft, expired: daysLeft < 0 }
    })
    .filter(a => a.daysLeft < WARN_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  const kycAlerts: KycAlert[] = drivers
    .filter(d => d.lastKycDate && d.status === 'Active')
    .map(d => ({
      driver: d,
      daysSince: Math.floor((now - new Date(d.lastKycDate).getTime()) / 86400000),
    }))
    .filter(a => a.daysSince > KYC_STALE_DAYS)
    .sort((a, b) => b.daysSince - a.daysSince)

  const spxBlocked = drivers.filter(d => d.spxBlocklisted && d.status === 'Active')

  if (!licenseAlerts.length && !kycAlerts.length && !spxBlocked.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
        <p style={{ fontSize: 28, margin: '0 0 8px' }}>✅</p>
        <p style={{ color: '#4ade80', fontWeight: 600, margin: 0 }}>Nenhum alerta ativo</p>
        <p style={{ color: '#8892a4', fontSize: 13, margin: '4px 0 0' }}>CNHs, KYC e blocklist OK para motoristas ativos</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {spxBlocked.length > 0 && (
        <AlertSection
          title={`🚫 Na blocklist SPX (${spxBlocked.length} motoristas ativos)`}
          color="#ef4444"
          bgColor="rgba(239,68,68,.08)"
        >
          <AlertTable
            rows={spxBlocked.map(d => ({
              id: d.id,
              name: d.name,
              detail: `${d.vehicleType || '—'} · ${d.city || '—'} · ${d.agency || '—'}`,
              badge: 'BLOCKLIST',
              badgeColor: '#ef4444',
            }))}
          />
        </AlertSection>
      )}

      {licenseAlerts.length > 0 && (
        <AlertSection
          title={`📄 CNH vencida ou a vencer (${licenseAlerts.length} motoristas ativos)`}
          color="#f59e0b"
          bgColor="rgba(245,158,11,.08)"
        >
          <AlertTable
            rows={licenseAlerts.map(a => ({
              id: a.driver.id,
              name: a.driver.name,
              detail: `${a.driver.vehicleType || '—'} · ${a.driver.city || '—'} · Val. ${a.driver.licenseExpiryDate}`,
              badge: a.expired ? 'VENCIDA' : `${a.daysLeft}d restantes`,
              badgeColor: a.expired ? '#ef4444' : a.daysLeft < 30 ? '#f59e0b' : '#3b82f6',
            }))}
          />
        </AlertSection>
      )}

      {kycAlerts.length > 0 && (
        <AlertSection
          title={`🔍 KYC desatualizado há mais de ${KYC_STALE_DAYS} dias (${kycAlerts.length} motoristas ativos)`}
          color="#8b5cf6"
          bgColor="rgba(139,92,246,.08)"
        >
          <AlertTable
            rows={kycAlerts.slice(0, 50).map(a => ({
              id: a.driver.id,
              name: a.driver.name,
              detail: `Último KYC: ${a.driver.lastKycDate} · ${a.driver.city || '—'}`,
              badge: `${a.daysSince}d atrás`,
              badgeColor: '#8b5cf6',
            }))}
          />
          {kycAlerts.length > 50 && (
            <p style={{ color: '#8892a4', fontSize: 12, margin: '8px 12px 0' }}>... e mais {kycAlerts.length - 50} motoristas.</p>
          )}
        </AlertSection>
      )}
    </div>
  )
}

function AlertSection({ title, color, bgColor, children }: {
  title: string; color: string; bgColor: string; children: React.ReactNode
}) {
  return (
    <div style={{ background: bgColor, border: `1px solid ${color}33`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${color}22` }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function AlertTable({ rows }: {
  rows: { id: string; name: string; detail: string; badge: string; badgeColor: string }[]
}) {
  return (
    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
      {rows.map((r, i) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.id}</p>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: '#8892a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: 'monospace' }}>{r.id}</span> · {r.detail}
            </p>
          </div>
          <span style={{ background: `${r.badgeColor}22`, color: r.badgeColor, border: `1px solid ${r.badgeColor}44`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
            {r.badge}
          </span>
        </div>
      ))}
    </div>
  )
}
