// ===== Enums =====
export type RouteStatus = "DISPONIVEL" | "ATRIBUIDA" | "BLOQUEADA"
export type BlocklistStatus = "BLOCKED" | "UNBLOCKED"
export type UserRole = "ADMIN" | "ANALISTA" | "SUPERVISOR"

// ===== Models =====
export interface Driver {
  id: string
  name: string | null
  vehicleType: string | null
  ds: string | null
  noShowCount: number
  declineRate: number
  priorityScore: number
  updatedAt: string
  createdAt: string
}

export interface Route {
  id: string
  atId?: string | null
  routeDate?: string | null
  shift?: string | null
  cluster?: string | null
  gaiola: string | null
  bairro: string | null
  cidade: string | null
  requiredVehicleType: string | null
  requiredVehicleTypeNorm: string | null
  suggestionDriverDs: string | null
  km: string | null
  spr: string | null
  volume: string | null
  gg: string | null
  veiculoRoterizado: string | null
  requestedDriverId?: string | null
  noShow?: boolean
  sheetRowNumber?: number | null
  driverId: string | null
  driverName: string | null
  driverVehicleType: string | null
  driverAccuracy: string | null
  driverPlate: string | null
  status: RouteStatus
  assignedAt: string | null
  updatedAt: string
  createdAt: string
  driver?: Driver | null
}

export interface SyncLog {
  id: string
  status: string
  startedAt: string
  finishedAt: string | null
  driversCount: number
  routesAvailable: number
  routesAssigned: number
  message: string | null
}

export interface AssignmentOverview {
  id: string
  rowNumber: number
  driverId: string | null
  payload: Record<string, unknown>
  updatedAt: string
  createdAt: string
}

export interface DriverBlocklist {
  driverId: string
  driverName?: string | null
  status: BlocklistStatus
  timesListed: number
  lastActivatedAt: string | null
  lastInactivatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface FaqItem {
  id: string
  title: string
  answer: string
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ConversationState {
  phone: string
  step: string
  lastDriverId: string | null
  updatedAt: string
  createdAt: string
}

export interface AuditLog {
  id: string
  entityType: string
  entityId: string
  action: string
  userId: string
  userName: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

// ===== Auth =====
export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  hubId?: string | null
  hubName?: string | null
}

export interface ManagedUser extends User {
  isActive: boolean
  telegramChatId?: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface HubOption {
  id: string
  name: string
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
}

// ===== Dashboard =====
export interface DashboardStats {
  totalDrivers: number
  routesAvailable: number
  routesAssigned: number
  routesBlocked: number
  occupationRate: number
  blockedDrivers: number
  lastSync: SyncLog | null
  avgDeclineRate: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PlanningDriverOption {
  id: string
  name: string
  vehicleType: string
  available: boolean
  ds: number
  profile: string
  clusters: string[]
}

export interface RoutePlanningItem extends Route {
  hasTelegramRequest: boolean
  hasManualRequest: boolean
  suggestedDriverId: string | null
  suggestedDriverName: string | null
  suggestedPhase: "FASE A" | "FASE B" | null
  suggestedObservation: string | null
  suggestedDriverVehicle: string | null
  suggestedDriverDs: number | null
  clusterRoute: string | null
  clusterDriver: string | null
}

export interface RoutePlanningPreference {
  cluster: string
  clusterName: string | null
  driverId: string
  driverName: string | null
  vehicleType: string | null
  available: boolean
}

export interface RoutePlanningPayload {
  date: string
  shift: string | null
  focus: "DS" | "VOLUME"
  totals: {
    routes: number
    noShowAvailable: number
    telegramRequested: number
    manualRequested: number
    pendingRequest: number
    suggestions: number
  }
  drivers: PlanningDriverOption[]
  preferredAssignments: RoutePlanningPreference[]
  data: RoutePlanningItem[]
}

export interface RoutePlanningRunResult {
  ok: boolean
  message: string
  focus: "DS" | "VOLUME"
  totalAssignments: number
  totalDriversUsed: number
  assignments: Array<{
    atId: string
    suggestedDriverId: string
    phase: "FASE A" | "FASE B"
    obs: string
  }>
}

export interface RoutePlanningMapStop {
  stop: number
  latitude: number
  longitude: number
  packageCount: number
  cluster: string
  brs: string[]
}

export interface RoutePlanningMapRoute {
  atId: string
  color: string
  stops: RoutePlanningMapStop[]
}

export interface RoutePlanningMapPayload {
  routes: RoutePlanningMapRoute[]
  clusters: string[]
  searchedBr: {
    br: string
    latitude: number | null
    longitude: number | null
    atId: string | null
    stop: number | null
    cluster: string | null
  } | null
  nearbyRoutes: Array<{
    atId: string
    color: string
    distanceKm: number
    nearestStop: number
    cluster: string
    isSameRoute: boolean
    driverName: string | null
    vehicleType: string | null
  }>
}
