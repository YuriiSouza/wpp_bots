import { api } from "./api"
import type { User } from "./types"
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
