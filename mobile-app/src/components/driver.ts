import { C } from './ui'

export function licenseStatus(expiry: string): { label: string; color: string } | null {
  if (!expiry) return null
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: 'CNH vencida', color: C.red }
  if (days < 30) return { label: `CNH ${days}d`, color: C.red }
  if (days < 90) return { label: `CNH ${days}d`, color: C.yellow }
  return null
}
