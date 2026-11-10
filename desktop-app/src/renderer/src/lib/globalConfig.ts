export type Shift = 'AM' | 'PM1' | 'PM2'

export interface ShiftConfig {
  patterns: string[]  // substrings to match against work preference slot strings
}

export interface RodizioConfig {
  mediaMinDays: number  // days without route to be MÉDIA (default 4)
  altaMinDays: number   // days without route to be ALTA (default 8)
}

export interface ScoreWeightsConfig {
  dsWeight: number
  declineWeight: number
  noShowWeight: number
}

export interface GlobalConfig {
  shifts: Record<Shift, ShiftConfig>
  rodizio: RodizioConfig
  scoreWeights: ScoreWeightsConfig
  hubName: string
  downloadsFolder: string
  ehaSheetUrl: string   // planilha com a guia "[IR] Base de BRs"
  ehaStation: string    // station_name usado para filtrar a base (ex.: LM Hub_GO_Anápolis)
}

export const DEFAULT_CONFIG: GlobalConfig = {
  shifts: {
    AM:  { patterns: ['05:30', '06:00', '04:00', '05:00'] },
    PM1: { patterns: ['11:15', '11:00', '12:00', '10:00'] },
    PM2: { patterns: ['17:00', '16:00', '18:00', '15:00'] },
  },
  rodizio: { mediaMinDays: 4, altaMinDays: 8 },
  scoreWeights: { dsWeight: 20, declineWeight: 25, noShowWeight: 30 },
  hubName: '',
  downloadsFolder: '',
  ehaSheetUrl: '',
  ehaStation: '',
}

const CONFIG_KEY = 'spx:global-config'

export function getGlobalConfig(): GlobalConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return DEFAULT_CONFIG
    const saved = JSON.parse(raw) as Partial<GlobalConfig>
    return {
      shifts: { ...DEFAULT_CONFIG.shifts, ...saved.shifts },
      rodizio: { ...DEFAULT_CONFIG.rodizio, ...saved.rodizio },
      scoreWeights: { ...DEFAULT_CONFIG.scoreWeights, ...saved.scoreWeights },
      hubName: saved.hubName ?? DEFAULT_CONFIG.hubName,
      downloadsFolder: saved.downloadsFolder ?? DEFAULT_CONFIG.downloadsFolder,
      ehaSheetUrl: saved.ehaSheetUrl ?? '',
      ehaStation: saved.ehaStation ?? '',
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveGlobalConfig(config: GlobalConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function driverMatchesShift(slots: string[], shift: Shift, config: GlobalConfig): boolean {
  const patterns = config.shifts[shift].patterns
  // Compara só o horário de INÍCIO da janela: "11:15-15:00" é PM1, mesmo terminando às 15:00 (padrão do PM2)
  return slots.some(slot => { const start = slot.split('-')[0].trim(); return patterns.some(p => start.startsWith(p)) })
}

export function calcRodizio(lastTripDate: string | null | undefined, config: GlobalConfig): 'BAIXA' | 'MÉDIA' | 'ALTA' {
  if (!lastTripDate) return 'ALTA'
  // try to parse various date formats
  const clean = lastTripDate.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')
  const d = new Date(clean)
  if (isNaN(d.getTime())) return 'BAIXA'
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (diffDays >= config.rodizio.altaMinDays) return 'ALTA'
  if (diffDays >= config.rodizio.mediaMinDays) return 'MÉDIA'
  return 'BAIXA'
}
