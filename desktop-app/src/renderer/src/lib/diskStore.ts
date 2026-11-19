// Armazenamento em arquivos (pasta de dados do app). Sem limite de tamanho do localStorage.
// Fora do Electron cai para o localStorage.
type DiskBridge = { get(k: string): string | null; set(k: string, v: string | null): boolean; keys(p: string): string[] }
const bridge = (): DiskBridge | null => (window as unknown as { diskBridge?: DiskBridge }).diskBridge ?? null

export const diskStore = {
  getRaw(key: string): string | null {
    const b = bridge()
    if (!b) { try { return localStorage.getItem(key) } catch { return null } }
    const v = b.get(key)
    if (v !== null) return v
    // migração: dado antigo ainda no localStorage → passa para o disco
    try {
      const old = localStorage.getItem(key)
      if (old !== null && b.set(key, old)) localStorage.removeItem(key)
      return old
    } catch { return null }
  },
  get<T>(key: string): T | null {
    const raw = diskStore.getRaw(key)
    try { return raw ? (JSON.parse(raw) as T) : null } catch { return null }
  },
  set(key: string, val: unknown): boolean {
    const raw = JSON.stringify(val)
    const b = bridge()
    if (!b) { try { localStorage.setItem(key, raw); return true } catch { return false } }
    const ok = b.set(key, raw)
    if (ok) try { localStorage.removeItem(key) } catch { /* */ }
    return ok
  },
  remove(key: string) {
    bridge()?.set(key, null)
    try { localStorage.removeItem(key) } catch { /* */ }
  },
}
