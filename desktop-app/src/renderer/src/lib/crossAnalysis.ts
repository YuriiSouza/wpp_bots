import type { StoredDriver } from './localStore'
import type { DriverResult } from './types'
import type { DriverCallUpStats } from './callUpParser'
import type { DriverForwardStats } from './forwardOrderParser'
import type { DriverAvailability } from './workPreferenceParser'

export type AlertLevel = 'green' | 'yellow' | 'red'

export interface DriverFullProfile {
  id: string
  name: string
  // Registry
  status: string
  vehicleType: string
  agency: string
  city: string
  licenseExpiryDate: string
  lastKycDate: string
  spxBlocklisted: boolean
  isNewDriver: boolean
  // DS
  dsReal: number | null
  dsStatus: string | null
  performance: number | null
  clusterFromDs: string | null
  // Call Up
  callUpTotal: number
  callUpAccepted: number
  callUpDeclined: number
  acceptanceRate: number | null
  timeoutCount: number
  topDeclineReason: string | null
  // Forward Order
  pendingPackages: number
  deliveringPending: number
  onHoldPending: number
  isCritical: boolean
  oldestDays: number
  // Work Preference (today and next days)
  clustersFromWorkPref: string[]
  scheduleByDate: Record<string, { status: string; slots: string[]; hasAM: boolean; hasPM: boolean }>
  // Alert
  alertLevel: AlertLevel
  alertReasons: string[]
}

function computeAlertLevel(p: DriverFullProfile): { level: AlertLevel; reasons: string[] } {
  const reasons: string[] = []

  // Red conditions
  if (p.spxBlocklisted) reasons.push('Na blocklist SPX')
  if (p.licenseExpiryDate) {
    const daysLeft = Math.floor((new Date(p.licenseExpiryDate).getTime() - Date.now()) / 86400000)
    if (daysLeft < 0) reasons.push('CNH vencida')
    else if (daysLeft < 30) reasons.push(`CNH vence em ${daysLeft}d`)
  }
  if (p.isCritical) reasons.push(`${p.pendingPackages} pacotes pendentes (crítico)`)
  if (p.dsReal !== null && p.dsReal < 0.7 && (p.dsStatus as string) === 'Piorando') reasons.push('DS crítico e piorando')

  if (reasons.length > 0) return { level: 'red', reasons }

  // Yellow conditions
  if (p.acceptanceRate !== null && p.acceptanceRate < 50 && p.callUpTotal >= 5)
    reasons.push(`Taxa de aceitação baixa (${p.acceptanceRate}%)`)
  if (p.lastKycDate) {
    const daysSince = Math.floor((Date.now() - new Date(p.lastKycDate).getTime()) / 86400000)
    if (daysSince > 180) reasons.push(`KYC há ${daysSince} dias`)
  }
  if (p.dsReal !== null && p.dsReal < 0.8) reasons.push(`DS baixo (${p.dsReal})`)
  if (p.pendingPackages > 0 && !p.isCritical) reasons.push(`${p.pendingPackages} pacote(s) pendente(s)`)
  if (p.timeoutCount > 3) reasons.push(`${p.timeoutCount} timeouts no call up`)

  if (reasons.length > 0) return { level: 'yellow', reasons }

  return { level: 'green', reasons: [] }
}

export function buildDriverProfiles(params: {
  registry: StoredDriver[]
  dsDrivers: DriverResult[]
  callUpDrivers: DriverCallUpStats[]
  forwardDrivers: DriverForwardStats[]
  workPrefDrivers: DriverAvailability[]
  today: string  // YYYY-MM-DD
}): DriverFullProfile[] {
  const { registry, dsDrivers, callUpDrivers, forwardDrivers, workPrefDrivers } = params

  // Build lookup maps
  const dsMap = new Map<string, DriverResult>(dsDrivers.map(d => [d.driver_id, d]))
  const callUpMap = new Map<string, DriverCallUpStats>(callUpDrivers.map(d => [d.driverId, d]))
  const fwdMap = new Map<string, DriverForwardStats>(forwardDrivers.map(d => [d.driverId, d]))
  const wpMap = new Map<string, DriverAvailability>(workPrefDrivers.map(d => [d.driverId, d]))

  // All unique IDs across all sources
  const allIds = new Set<string>([
    ...registry.map(d => d.id),
    ...dsDrivers.map(d => d.driver_id),
    ...callUpDrivers.map(d => d.driverId),
    ...forwardDrivers.map(d => d.driverId),
    ...workPrefDrivers.map(d => d.driverId),
  ])

  const registryMap = new Map<string, StoredDriver>(registry.map(d => [d.id, d]))

  const profiles: DriverFullProfile[] = []

  for (const id of allIds) {
    const reg = registryMap.get(id)
    const ds = dsMap.get(id)
    const cu = callUpMap.get(id)
    const fwd = fwdMap.get(id)
    const wp = wpMap.get(id)

    // Derive name: registry > work pref > call up > forward order > DS
    const name = reg?.name || wp?.driverName || cu?.driverName || fwd?.driverName || id

    const profile: DriverFullProfile = {
      id,
      name,
      // Registry
      status: reg?.status ?? '',
      vehicleType: reg?.vehicleType ?? wp?.vehicleType ?? '',
      agency: reg?.agency ?? '',
      city: reg?.city ?? '',
      licenseExpiryDate: reg?.licenseExpiryDate ?? '',
      lastKycDate: reg?.lastKycDate ?? '',
      spxBlocklisted: reg?.spxBlocklisted ?? false,
      isNewDriver: wp?.isNewDriver ?? false,
      // DS
      dsReal: ds?.DS_Real ?? null,
      dsStatus: ds?.Status ?? null,
      performance: ds?.Media_Performance ?? null,
      clusterFromDs: null,
      // Call Up
      callUpTotal: cu?.total ?? 0,
      callUpAccepted: cu?.accepted ?? 0,
      callUpDeclined: cu?.declined ?? 0,
      acceptanceRate: cu?.acceptanceRate ?? null,
      timeoutCount: cu?.timeoutCount ?? 0,
      topDeclineReason: cu
        ? Object.entries(cu.declineReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        : null,
      // Forward Order
      pendingPackages: fwd?.totalPackages ?? 0,
      deliveringPending: fwd?.delivering ?? 0,
      onHoldPending: fwd?.onHold ?? 0,
      isCritical: fwd?.isCritical ?? false,
      oldestDays: fwd?.oldestDays ?? 0,
      // Work Preference
      clustersFromWorkPref: wp?.clusters ?? [],
      scheduleByDate: wp
        ? Object.fromEntries(
            Object.entries(wp.schedule).map(([date, sched]) => [
              date,
              { status: sched.status, slots: sched.slots, hasAM: sched.hasAM, hasPM: sched.hasPM },
            ])
          )
        : {},
      // Placeholders — filled after
      alertLevel: 'green',
      alertReasons: [],
    }

    const { level, reasons } = computeAlertLevel(profile)
    profile.alertLevel = level
    profile.alertReasons = reasons

    profiles.push(profile)
  }

  // Sort: red first, then yellow, then green; within each group by name
  const order = { red: 0, yellow: 1, green: 2 }
  return profiles.sort((a, b) => {
    const diff = order[a.alertLevel] - order[b.alertLevel]
    if (diff !== 0) return diff
    return (a.name || a.id).localeCompare(b.name || b.id)
  })
}
