declare global {
  interface Window {
    fileBridge?: {
      pickFolder: (defaultPath?: string) => Promise<string | null>
      findLatestFile: (folder: string, pattern: string) => Promise<{ name: string; content: string } | { error: string }>
    }
  }
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  return window.fileBridge?.pickFolder(defaultPath) ?? null
}

export async function findLatestFile(
  folder: string,
  pattern: string,
): Promise<{ name: string; content: string } | { error: string }> {
  if (!window.fileBridge) return { error: 'fileBridge não disponível' }
  return window.fileBridge.findLatestFile(folder, pattern)
}

// Padrões conhecidos por tipo de arquivo
export const FILE_PATTERNS = {
  ds:          'resultado.csv',
  driver:      'br_driver_*.csv',
  callUp:      'br_export_call_up_notification_*.csv',
  forwardOrder:'export_forward_order_*.csv',
  assignment:  'br_assignment_task_*.csv',
  queueList:   'QueueList_*.csv',
} as const

export type FileType = keyof typeof FILE_PATTERNS
