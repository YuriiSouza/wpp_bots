import { api } from "./api"
import type {
  AssignmentOverview,
  HubOption,
  ManagedUser,
  User,
  AuditLog,
  ConversationState,
  DashboardStats,
  Driver,
  DriverBlocklist,
  FaqItem,
  PaginatedResponse,
  Route,
  RoutePlanningMapPayload,
  RoutePlanningPreference,
  RoutePlanningPayload,
  RoutePlanningRunResult,
  SyncLog,
} from "./types"
import type {
  Analyst,
  DriverSupportContext,
  HistoryFilters,
  SendSupportMessageInput,
  SupportHistoryItem,
  SupportMessage,
  SupportMetrics,
  SupportTicket,
  TicketFilters,
  TicketListResponse,
  TransferTicketInput,
} from "./support-types"

export interface DashboardPayload {
  stats: DashboardStats
  routesPerDay: { date: string; atribuidas: number; disponiveis: number; bloqueadas: number }[]
  routeDistribution: { status: string; count: number; fill: string }[]
  topDrivers: { name: string; score: number; routes: number }[]
  noShow: {
    summary: {
      total: number
      last30Days: number
      today: number
      rate: number
      affectedCities: number
      affectedClusters: number
      topShift: string | null
      topCity: string | null
      topCluster: string | null
    }
    byDay: { date: string; count: number }[]
    byShift: { label: string; count: number }[]
    byCity: { label: string; count: number }[]
    byCluster: { label: string; count: number }[]
    byClusterTrend: Array<{
      date: string
      values: { label: string; count: number }[]
    }>
    byVehicle: { label: string; count: number }[]
    byAssignmentSource: { label: string; count: number }[]
    byWeekday: { label: string; count: number }[]
    recentRoutes: Array<{
      id: string
      atId: string
      routeDate: string | null
      shift: string | null
      cidade: string | null
      bairro: string | null
      driverId: string | null
      driverName: string | null
      driverVehicleType: string | null
      assignmentSource: string
      cluster: string | null
      createdAt: string | null
      updatedAt: string | null
    }>
  }
}

interface ApiActionResponse {
  ok: boolean
  message: string
}

export interface UserManagementPayload {
  users: ManagedUser[]
  hubs: HubOption[]
}

export interface OperationContextPayload {
  date: string
  shift: "AM" | "PM" | "PM2"
}

export interface DriversAnalyticsPayload {
  summary: {
    totalActiveDrivers: number
    blockedCount: number
    highRiskCount: number
    totalNoShow: number
    avgScore: number
    avgDs: number
  }
  dsAnalysis: {
    above90Count: number
    between80And90Count: number
    below80Count: number
    maxDs: number
    minDs: number
    byVehicle: Array<{
      label: string
      avgDs: number
      count: number
    }>
    topDs: Array<{
      id: string
      name: string | null
      vehicleType: string | null
      ds: number
    }>
    lowDs: Array<{
      id: string
      name: string | null
      vehicleType: string | null
      ds: number
    }>
  }
  byVehicle: Array<{
    label: string
    count: number
  }>
  topScore: Array<{
    id: string
    name: string | null
    vehicleType: string | null
    ds: string | null
    noShowCount: number
    declineRate: number
    priorityScore: number
  }>
  topRisk: Array<{
    id: string
    name: string | null
    vehicleType: string | null
    ds: string | null
    noShowCount: number
    declineRate: number
    priorityScore: number
  }>
  filterOptions: {
    vehicleTypes: string[]
    dsValues: string[]
  }
}

export interface OverviewPayload {
  routeRequests: Array<{
    driverId: string
    driverName: string | null
    vehicleType: string | null
    displayedRoutes: Array<{
      atId: string
      bairro: string | null
    }>
    displayedAt: string | null
    requestedAt: string | null
    choseRoute: boolean
    chosenRoute: string | null
    chosenAt: string | null
  }>
}

export interface BotHealthPayload {
  messagesPerMin: number
  uptime: number
  status: "ONLINE" | "DEGRADED"
  activeConversations: number
  totalUsers: number
  recentErrors: number
  conversations: ConversationState[]
  alerts: Array<{ type: "warning" | "error" | "info"; message: string; time: string }>
}

export interface SettingsPayload {
  algorithm: {
    noShowWeight: number
    declineWeight: number
    dsWeight: number
    blockThreshold: number
    autoBlock: boolean
  }
  system: {
    apiUrl: string
    telegramBotName: string
    environment: string
  }
  permissions: Array<{ role: string; desc: string; perms: string[] }>
  meta: {
    version: string
    stack: string
    database: string
    bot: string
    environment: string
  }
}

export async function fetchDashboard() {
  const response = await api.get<DashboardPayload>("/api/dashboard")
  return response.data
}

export async function fetchDriversPage(params?: {
  page?: number
  pageSize?: number
  search?: string
  vehicleType?: string
  ds?: string
  sortBy?: "name" | "priorityScore" | "noShowCount" | "declineRate"
  sortDir?: "asc" | "desc"
}) {
  const response = await api.get<PaginatedResponse<Driver>>("/api/drivers", {
    params,
  })
  return response.data
}

export async function fetchDrivers(params?: {
  page?: number
  pageSize?: number
  search?: string
  vehicleType?: string
  ds?: string
  sortBy?: "name" | "priorityScore" | "noShowCount" | "declineRate"
  sortDir?: "asc" | "desc"
}) {
  const response = await api.get<PaginatedResponse<Driver>>("/api/drivers", {
    params,
  })
  return response.data.data
}

export async function fetchDriversAnalytics() {
  const response = await api.get<DriversAnalyticsPayload>("/api/drivers/analytics")
  return response.data
}

export async function updateDriverPriorityScore(driverId: string, priorityScore: number) {
  const response = await api.patch<ApiActionResponse>(`/api/drivers/${driverId}/priority-score`, {
    priorityScore,
  })
  return response.data
}

export async function resetDriverNoShow(driverId: string) {
  const response = await api.post<ApiActionResponse>(`/api/drivers/${driverId}/reset-no-show`)
  return response.data
}

export async function fetchRoutes() {
  const response = await api.get<Route[]>("/api/routes")
  return response.data
}

export async function fetchRoutePlanning(params?: {
  date?: string
  shift?: "AM" | "PM" | "PM2"
  atId?: string
  focus?: "DS" | "VOLUME"
}) {
  const response = await api.get<RoutePlanningPayload>("/api/route-planning", {
    params,
  })
  return response.data
}

export async function saveRoutePlanningPreferences(
  preferences: Array<{ cluster: string; driverId: string }>
) {
  const response = await api.put<{ ok: boolean; message: string; preferences: RoutePlanningPreference[] }>(
    "/api/route-planning/preferences",
    { preferences }
  )
  return response.data
}

export async function runRoutePlanning(params?: {
  date?: string
  shift?: "AM" | "PM" | "PM2"
  focus?: "DS" | "VOLUME"
}) {
  const response = await api.post<RoutePlanningRunResult>("/api/route-planning/run", params)
  return response.data
}

export async function fetchRoutePlanningMap(params?: {
  atId?: string
  cluster?: string
  br?: string
}) {
  const response = await api.get<RoutePlanningMapPayload>("/api/route-planning/map", {
    params,
  })
  return response.data
}

export async function assignRoute(routeId: string, driverId: string) {
  const response = await api.post<ApiActionResponse>(`/api/routes/${routeId}/assign`, { driverId })
  return response.data
}

export async function unassignRoute(routeId: string, markNoShow = false) {
  const response = await api.post<ApiActionResponse>(`/api/routes/${routeId}/unassign`, { markNoShow })
  return response.data
}

export async function blockRoute(routeId: string) {
  const response = await api.post<ApiActionResponse>(`/api/routes/${routeId}/block`)
  return response.data
}

export async function markRouteNoShow(routeId: string, makeAvailable = false) {
  const response = await api.post<ApiActionResponse>(`/api/routes/${routeId}/no-show`, { makeAvailable })
  return response.data
}

export async function clearRouteNoShow(routeId: string) {
  const response = await api.post<ApiActionResponse>(`/api/routes/${routeId}/clear-no-show`)
  return response.data
}

export async function exportBotAssignedRoutesCsv(date?: string) {
  const response = await api.get<Blob>("/api/routes/export/bot-csv", {
    params: date ? { date } : undefined,
    responseType: "blob",
  })
  return response.data
}

export async function fetchBlocklist() {
  const response = await api.get<DriverBlocklist[]>("/api/blocklist")
  return response.data
}

export async function addBlocklistDriver(driverId: string) {
  const response = await api.post<ApiActionResponse>("/acess/analist/blocklist/add", { driverId })
  return response.data
}

export async function removeBlocklistDriver(driverId: string) {
  const response = await api.post<ApiActionResponse>("/acess/analist/blocklist/remove", { driverId })
  return response.data
}

export async function fetchFaqItems() {
  const response = await api.get<FaqItem[]>("/api/faq")
  return response.data
}

export async function fetchOverview() {
  const response = await api.get<OverviewPayload>("/api/overview")
  return response.data
}

export async function fetchSyncLogs() {
  const response = await api.get<SyncLog[]>("/api/sync/logs")
  return response.data
}

export async function runSync(
  action: "drivers" | "routes" | "all",
  date?: string,
  shift?: "AM" | "PM" | "PM2"
) {
  const response = await api.post<ApiActionResponse>("/api/sync/run", { action, date, shift })
  return response.data
}

export async function resetQueue() {
  const response = await api.post<ApiActionResponse>("/api/sync/reset-queue")
  return response.data
}

export async function fetchAuditLogs() {
  const response = await api.get<AuditLog[]>("/api/audit-logs")
  return response.data
}

export async function fetchBotHealth() {
  const response = await api.get<BotHealthPayload>("/api/bot-health")
  return response.data
}

export async function fetchSettings() {
  const response = await api.get<SettingsPayload>("/api/settings")
  return response.data
}

export async function saveSettings(payload: SettingsPayload) {
  const response = await api.put<ApiActionResponse>("/api/settings", payload)
  return response.data
}

export async function fetchManagedUsers() {
  const response = await api.get<UserManagementPayload>("/api/users")
  return response.data
}

export async function fetchHubs() {
  const response = await api.get<HubOption[]>("/api/hubs")
  return response.data
}

export async function fetchOperationContext() {
  const response = await api.get<OperationContextPayload>("/api/operation-context")
  return response.data
}

export async function updateOperationContext(payload: OperationContextPayload) {
  const response = await api.put<ApiActionResponse & { context: OperationContextPayload }>(
    "/api/operation-context",
    payload
  )
  return response.data
}

export async function createHub(payload: {
  name: string
  timezone?: string
}) {
  const response = await api.post<ApiActionResponse & { hub: HubOption }>("/api/hubs", payload)
  return response.data
}

export async function createManagedUser(payload: {
  name: string
  email: string
  role: "ADMIN" | "ANALISTA" | "SUPERVISOR"
  hubId?: string | null
  telegramChatId?: string | null
}) {
  const response = await api.post<ApiActionResponse & { user: ManagedUser }>("/api/users", payload)
  return response.data
}

export async function updateManagedUser(
  userId: string,
  payload: {
    role?: "ADMIN" | "ANALISTA" | "SUPERVISOR"
    hubId?: string | null
    isActive?: boolean
    telegramChatId?: string | null
  }
) {
  const response = await api.patch<ApiActionResponse & { user: ManagedUser }>(`/api/users/${userId}`, payload)
  return response.data
}

export async function createFaqItem(payload: Pick<FaqItem, "title" | "answer" | "position">) {
  const response = await api.post<ApiActionResponse>("/acess/duvidas/create", payload)
  return response.data
}

export async function updateFaqItem(payload: Pick<FaqItem, "id" | "title" | "answer" | "position" | "active">) {
  const response = await api.post<ApiActionResponse>("/acess/duvidas/update", payload)
  return response.data
}

export async function deleteFaqItem(id: string) {
  const response = await api.post<ApiActionResponse>("/acess/duvidas/delete", { id })
  return response.data
}

export async function fetchTicketList(user: User | null, filters?: TicketFilters): Promise<TicketListResponse> {
  const response = await api.get<TicketListResponse>("/api/support/tickets", {
    params: {
      hubId: filters?.hubId,
      status: filters?.status,
      role: user?.role,
      userHubId: user?.hubId,
    },
  })
  return response.data
}

export async function fetchTicketMessages(ticketId: string): Promise<SupportMessage[]> {
  const response = await api.get<SupportMessage[]>(`/api/support/tickets/${ticketId}/messages`)
  return response.data
}

export async function fetchTicketContext(ticketId: string): Promise<DriverSupportContext | null> {
  const response = await api.get<DriverSupportContext | null>(`/api/support/tickets/${ticketId}/context`)
  return response.data
}

export async function fetchSupportMetrics(user: User | null, filters?: TicketFilters): Promise<SupportMetrics> {
  const response = await api.get<SupportMetrics>("/api/support/metrics", {
    params: {
      hubId: filters?.hubId,
      status: filters?.status,
      role: user?.role,
      userHubId: user?.hubId,
    },
  })
  return response.data
}

export async function fetchSupportHistory(user: User | null, filters?: HistoryFilters): Promise<SupportHistoryItem[]> {
  const response = await api.get<SupportHistoryItem[]>("/api/support/history", {
    params: {
      ...filters,
      role: user?.role,
      userHubId: user?.hubId,
    },
  })
  return response.data
}

export async function fetchAssignableAnalysts(user: User | null, ticketId: string): Promise<Analyst[]> {
  const response = await api.get<Analyst[]>(`/api/support/tickets/${ticketId}/analysts`, {
    params: {
      role: user?.role,
      userHubId: user?.hubId,
    },
  })
  return response.data
}

export async function assumeTicket(user: User, ticketId: string) {
  const response = await api.post<SupportTicket>(`/api/support/tickets/${ticketId}/assume`, {
    analystId: user.id,
  })
  return response.data
}

export async function closeTicket(ticketId: string) {
  const response = await api.post<SupportTicket>(`/api/support/tickets/${ticketId}/close`)
  return response.data
}

export async function transferTicket(input: TransferTicketInput) {
  const response = await api.post<SupportTicket>(`/api/support/tickets/${input.ticketId}/transfer`, {
    analystId: input.analystId,
  })
  return response.data
}

export async function sendSupportMessage(input: SendSupportMessageInput): Promise<SupportMessage> {
  const telegramText = `${input.analyst.name}: ${input.body}`
  const response = await api.post<SupportMessage>(`/api/support/tickets/${input.ticketId}/messages`, {
    body: input.body,
    telegramText,
    authorId: input.analyst.id,
    authorName: input.analyst.name,
  })
  return response.data
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response
    if (response?.data?.message) return response.data.message
  }

  if (error instanceof Error && error.message) return error.message
  return fallback
}
