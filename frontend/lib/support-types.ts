import type { User, UserRole } from "./types"

export type SupportTicketStatus =
  | "WAITING_ANALYST"
  | "IN_PROGRESS"
  | "WAITING_DRIVER"
  | "CLOSED"

export type SupportMessageAuthorType = "DRIVER" | "ANALYST" | "SYSTEM"

export interface Hub {
  id: string
  name: string
  timezone: string
}

export interface Analyst extends User {
  role: UserRole
  hubId: string | null
  hubName: string | null
  isOnline: boolean
  activeTickets: number
}

export interface DriverRouteSnapshot {
  id: string
  city: string
  status: string
  assignedAt: string
}

export interface DriverSupportContext {
  driverId: string
  driverName: string
  telegramChatId: string
  hubId: string
  hubName: string
  vehicleType: string | null
  ds: string | null
  noShowCount: number
  declineRate: number
  priorityScore: number
  isBlocked: boolean
  hasActiveRoute: boolean
  activeRouteStatus: string | null
  lastRoutes: DriverRouteSnapshot[]
}

export interface SupportMessage {
  id: string
  ticketId: string
  authorType: SupportMessageAuthorType
  authorId: string | null
  authorName: string
  body: string
  telegramText: string
  createdAt: string
  pending?: boolean
}

export interface SupportTicket {
  id: string
  protocol: string
  status: SupportTicketStatus
  hubId: string
  hubName: string
  driverId: string
  driverName: string
  analystId: string | null
  analystName: string | null
  queuePosition: number | null
  waitingSince: string
  lastMessageAt: string
  unreadCount: number
  lastMessagePreview: string
}

export interface SupportTicketDetail extends SupportTicket {
  driver: DriverSupportContext
}

export interface TicketListResponse {
  hubs: Hub[]
  tickets: SupportTicket[]
  onlineAnalysts: Analyst[]
}

export interface SupportMetrics {
  avgFirstResponseMinutes: number
  avgResolutionMinutes: number
  closureRate: number
  ticketsByHub: Array<{ hubId: string; hubName: string; total: number }>
  ticketsByAnalyst: Array<{ analystId: string; analystName: string; total: number }>
}

export interface SupportHistoryItem {
  id: string
  protocol: string
  ticketId: string
  hubName: string
  driverName: string
  driverId: string
  analystName: string | null
  startedAt: string
  endedAt: string
  resolutionMinutes: number
  messageCount: number
  status: SupportTicketStatus
}

export interface TicketFilters {
  hubId?: string
  status?: SupportTicketStatus | "ALL"
}

export interface HistoryFilters extends TicketFilters {
  search?: string
  from?: string
  to?: string
}

export interface SendSupportMessageInput {
  ticketId: string
  body: string
  analyst: Pick<Analyst, "id" | "name">
}

export interface TransferTicketInput {
  ticketId: string
  analystId: string
}
