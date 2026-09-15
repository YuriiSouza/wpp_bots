export interface RawRoute {
  date?: string
  driver_id?: string
  dispatch_window?: string
  cluster_name?: string
  Performance?: string | number
  TaxaAderencia?: string | number
  qty_delivering?: string | number
  qty_delivered?: string | number
  qty_route_stop?: string | number
  vehicle_plan?: string
  vehicle_actual?: string
  DataHoraInicioRota?: string
  DataHoraPrimDelivered?: string
  DataHoraUltDelivered?: string
  PacoteHora?: string | number
  PacoteParada?: string | number
  route_distance_plan_km?: string | number
  [key: string]: string | number | undefined
}

export interface ParsedRoute {
  date: string
  driver_id: string
  dispatch_window: string
  cluster_name: string
  Performance: number | null
  TaxaAderencia: number | null
  qty_delivering: number | null
  qty_delivered: number | null
  qty_route_stop: number | null
  vehicle_plan: string
  vehicle_actual: string
  DataHoraInicioRota: Date | null
  DataHoraPrimDelivered: Date | null
  DataHoraUltDelivered: Date | null
  PacoteHora: number | null
  PacoteParada: number | null
  route_distance_plan_km: number | null
}

export type TrendStatus = 'Melhorando' | 'Piorando' | 'Estagnado'

export interface DriverResult {
  driver_id: string
  Media_Performance: number | null
  Status: TrendStatus
  Nivel_Entrega_Dia: number | null
  DS_Real: number | null
  route_count: number
}

export interface SummaryStats {
  totalRoutes: number
  totalDrivers: number
  periodStart: string
  periodEnd: string
  avgDsReal: number | null
  medianDsReal: number | null
  statusCounts: { Melhorando: number; Piorando: number; Estagnado: number }
}

export interface TurnStats {
  turn: string
  avgPerformance: number
  routeCount: number
  byCluster: { cluster: string; avgPerformance: number; routeCount: number }[]
}

export interface ClusterStats {
  cluster: string
  avgPerformance: number
  routeCount: number
  amAvg: number | null
  pm1Avg: number | null
  correlationVolume: number | null
  correlationStops: number | null
  isSensitiveToVolume: boolean
}

export interface TimelinePoint {
  date: string
  routeCount: number
}

export interface DsBucket {
  label: string
  min: number
  max: number
  count: number
}

export interface DriverActivity {
  driver_id: string
  daysActive: number
  maxGap: number
  avgGap: number
  vehicle: string
  routeCount: number
}

export interface VehicleConcentration {
  vehicle: string
  top20Pct: number
  bottom20Pct: number
  totalDrivers: number
}

export interface TurnoverByVehicle {
  vehicle: string
  retained: number
  churned: number
  newDrivers: number
  turnoverRate: number
}

export interface SPRSuggestion {
  cluster: string
  suggestedSPR: number | null
  note: string
  bins: { label: string; avgPerformance: number; count: number }[]
}

export interface LateStartAlert {
  driver_id: string
  lateCount: number
  totalAmRoutes: number
  latePct: number
}

export interface NightDeliveryAlert {
  driver_id: string
  date: string
  cluster: string
  ultDelivered: string
}

export interface AnalysisResult {
  drivers: DriverResult[]
  summary: SummaryStats
  turnStats: TurnStats[]
  clusterStats: ClusterStats[]
  timeline: TimelinePoint[]
  dsBuckets: DsBucket[]
  driverActivity: DriverActivity[]
  vehicleConcentration: VehicleConcentration[]
  turnoverByVehicle: TurnoverByVehicle[]
  sprSuggestions: SPRSuggestion[]
  lateStartAlerts: LateStartAlert[]
  nightDeliveryAlerts: NightDeliveryAlert[]
  missingColumns: string[]
}
