import type {
  Driver,
  Route,
  SyncLog,
  AssignmentOverview,
  DriverBlocklist,
  FaqItem,
  DashboardStats,
  AuditLog,
} from "./types"

// ===== Drivers =====
const driverNames = [
  "Carlos Silva", "Ana Santos", "Pedro Oliveira", "Maria Souza", "Lucas Ferreira",
  "Juliana Costa", "Rafael Lima", "Fernanda Pereira", "Bruno Almeida", "Camila Rodrigues",
  "Thiago Martins", "Amanda Gomes", "Diego Barbosa", "Patricia Ribeiro", "Marcos Carvalho",
  "Vanessa Araujo", "Ricardo Nascimento", "Daniela Vieira", "Felipe Rocha", "Tatiana Melo",
]

const vehicleTypes = ["VUC", "3/4", "TOCO", "TRUCK", "CARRETA"]
const dsValues = ["DS01", "DS02", "DS03", "DS04", "DS05", "DS06"]
const cities = ["Sao Paulo", "Campinas", "Santos", "Guarulhos", "Osasco", "Ribeirao Preto"]
const bairros = ["Centro", "Jardins", "Mooca", "Pinheiros", "Lapa", "Bela Vista", "Vila Mariana", "Santana", "Tatuape", "Ipiranga"]

export const mockDrivers: Driver[] = driverNames.map((name, i) => ({
  id: `DRV${String(i + 1).padStart(4, "0")}`,
  name,
  vehicleType: vehicleTypes[i % vehicleTypes.length],
  ds: dsValues[i % dsValues.length],
  noShowCount: Math.floor(Math.random() * 8),
  declineRate: Math.round(Math.random() * 40) / 100,
  priorityScore: Math.round((Math.random() * 80 + 20) * 10) / 10,
  updatedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
  createdAt: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString(),
}))

// ===== Routes =====
const statuses: Array<"DISPONIVEL" | "ATRIBUIDA" | "BLOQUEADA"> = ["DISPONIVEL", "ATRIBUIDA", "BLOQUEADA"]

export const mockRoutes: Route[] = Array.from({ length: 40 }, (_, i) => {
  const status = statuses[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]
  const driver = status === "ATRIBUIDA" ? mockDrivers[i % mockDrivers.length] : null
  return {
    id: `RT${String(i + 1).padStart(5, "0")}`,
    gaiola: `G${Math.floor(Math.random() * 20 + 1)}`,
    bairro: bairros[i % bairros.length],
    cidade: cities[i % cities.length],
    requiredVehicleType: vehicleTypes[i % vehicleTypes.length],
    requiredVehicleTypeNorm: vehicleTypes[i % vehicleTypes.length].toLowerCase(),
    suggestionDriverDs: dsValues[i % dsValues.length],
    km: String(Math.floor(Math.random() * 50 + 5)),
    spr: `SPR${Math.floor(Math.random() * 100)}`,
    volume: String(Math.floor(Math.random() * 500 + 50)),
    gg: `GG${Math.floor(Math.random() * 10)}`,
    veiculoRoterizado: vehicleTypes[i % vehicleTypes.length],
    driverId: driver?.id ?? null,
    driverName: driver?.name ?? null,
    driverVehicleType: driver?.vehicleType ?? null,
    driverAccuracy: driver ? `${Math.floor(Math.random() * 30 + 70)}%` : null,
    driverPlate: driver ? `ABC${Math.floor(Math.random() * 9000 + 1000)}` : null,
    status,
    assignedAt: status === "ATRIBUIDA" ? new Date(Date.now() - Math.random() * 86400000).toISOString() : null,
    updatedAt: new Date(Date.now() - Math.random() * 3 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
    driver,
  }
})

// ===== SyncLogs =====
export const mockSyncLogs: SyncLog[] = Array.from({ length: 20 }, (_, i) => {
  const started = new Date(Date.now() - i * 3600000)
  const duration = Math.floor(Math.random() * 120 + 10)
  return {
    id: `sync-${i + 1}`,
    status: i === 3 ? "FAILED" : "SUCCESS",
    startedAt: started.toISOString(),
    finishedAt: new Date(started.getTime() + duration * 1000).toISOString(),
    driversCount: Math.floor(Math.random() * 10 + 15),
    routesAvailable: Math.floor(Math.random() * 20 + 5),
    routesAssigned: Math.floor(Math.random() * 15 + 2),
    message: i === 3 ? "Connection timeout to spreadsheet API" : null,
  }
})

// ===== AssignmentOverview =====
export const mockOverviews: AssignmentOverview[] = Array.from({ length: 15 }, (_, i) => ({
  id: `ov-${i + 1}`,
  rowNumber: i + 1,
  driverId: mockDrivers[i % mockDrivers.length].id,
  payload: {
    routeId: mockRoutes[i % mockRoutes.length].id,
    driverName: mockDrivers[i % mockDrivers.length].name,
    cidade: cities[i % cities.length],
    vehicleType: vehicleTypes[i % vehicleTypes.length],
    score: Math.round(Math.random() * 100),
    status: statuses[i % 3],
  },
  updatedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
  createdAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
}))

// ===== Blocklist =====
export const mockBlocklist: DriverBlocklist[] = mockDrivers.slice(0, 6).map((d, i) => ({
  driverId: d.id,
  status: i < 4 ? "BLOCKED" as const : "UNBLOCKED" as const,
  timesListed: Math.floor(Math.random() * 5 + 1),
  lastActivatedAt: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
  lastInactivatedAt: i >= 4 ? new Date(Date.now() - Math.random() * 3 * 86400000).toISOString() : null,
  createdAt: new Date(Date.now() - Math.random() * 60 * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
}))

// ===== FAQ =====
export const mockFaqItems: FaqItem[] = [
  { id: "faq-1", title: "Como me cadastrar?", answer: "Envie /start no Telegram e siga as instrucoes.", position: 1, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "faq-2", title: "Como ver rotas disponiveis?", answer: "Use o comando /rotas para listar todas as rotas disponiveis para seu perfil.", position: 2, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "faq-3", title: "O que acontece se eu recusar uma rota?", answer: "Sua taxa de recusa (declineRate) aumenta e pode impactar seu priorityScore.", position: 3, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "faq-4", title: "Como funciona o bloqueio?", answer: "Motoristas com alto noShowCount ou declineRate podem ser bloqueados automaticamente.", position: 4, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "faq-5", title: "Posso trocar meu veiculo?", answer: "Entre em contato com o suporte para atualizar seu tipo de veiculo.", position: 5, active: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

// ===== Audit Log =====
export const mockAuditLogs: AuditLog[] = [
  { id: "aud-1", entityType: "Driver", entityId: "DRV0001", action: "UPDATE_PRIORITY", userId: "admin-1", userName: "Admin Master", before: { priorityScore: 45 }, after: { priorityScore: 72 }, createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "aud-2", entityType: "Route", entityId: "RT00005", action: "MANUAL_ASSIGN", userId: "admin-1", userName: "Admin Master", before: { status: "DISPONIVEL", driverId: null }, after: { status: "ATRIBUIDA", driverId: "DRV0003" }, createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: "aud-3", entityType: "DriverBlocklist", entityId: "DRV0002", action: "BLOCK", userId: "admin-1", userName: "Admin Master", before: { status: "UNBLOCKED" }, after: { status: "BLOCKED" }, createdAt: new Date(Date.now() - 10800000).toISOString() },
  { id: "aud-4", entityType: "FaqItem", entityId: "faq-1", action: "UPDATE", userId: "admin-1", userName: "Admin Master", before: { title: "Como cadastrar?" }, after: { title: "Como me cadastrar?" }, createdAt: new Date(Date.now() - 14400000).toISOString() },
  { id: "aud-5", entityType: "Driver", entityId: "DRV0005", action: "RESET_NOSHOW", userId: "admin-1", userName: "Admin Master", before: { noShowCount: 5 }, after: { noShowCount: 0 }, createdAt: new Date(Date.now() - 18000000).toISOString() },
  { id: "aud-6", entityType: "Route", entityId: "RT00010", action: "UNASSIGN", userId: "admin-1", userName: "Admin Master", before: { status: "ATRIBUIDA", driverId: "DRV0007" }, after: { status: "DISPONIVEL", driverId: null }, createdAt: new Date(Date.now() - 21600000).toISOString() },
]

// ===== Dashboard Stats =====
export const mockDashboardStats: DashboardStats = {
  totalDrivers: mockDrivers.length,
  routesAvailable: mockRoutes.filter((r) => r.status === "DISPONIVEL").length,
  routesAssigned: mockRoutes.filter((r) => r.status === "ATRIBUIDA").length,
  routesBlocked: mockRoutes.filter((r) => r.status === "BLOQUEADA").length,
  occupationRate: Math.round(
    (mockRoutes.filter((r) => r.status === "ATRIBUIDA").length / mockRoutes.length) * 100
  ),
  blockedDrivers: mockBlocklist.filter((b) => b.status === "BLOCKED").length,
  lastSync: mockSyncLogs[0],
  avgDeclineRate: Math.round(
    (mockDrivers.reduce((acc, d) => acc + d.declineRate, 0) / mockDrivers.length) * 100
  ) / 100,
}

// ===== Chart data =====
export const mockRoutesPerDay = Array.from({ length: 14 }, (_, i) => {
  const date = new Date(Date.now() - (13 - i) * 86400000)
  return {
    date: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    atribuidas: Math.floor(Math.random() * 15 + 5),
    disponiveis: Math.floor(Math.random() * 10 + 3),
    bloqueadas: Math.floor(Math.random() * 5),
  }
})

export const mockTopDrivers = mockDrivers
  .sort((a, b) => b.priorityScore - a.priorityScore)
  .slice(0, 10)
  .map((d) => ({
    name: d.name?.split(" ")[0] ?? d.id,
    score: d.priorityScore,
    routes: Math.floor(Math.random() * 20 + 5),
  }))

export const mockRouteDistribution = [
  { status: "Disponiveis", count: mockDashboardStats.routesAvailable, fill: "var(--color-chart-2)" },
  { status: "Atribuidas", count: mockDashboardStats.routesAssigned, fill: "var(--color-chart-1)" },
  { status: "Bloqueadas", count: mockDashboardStats.routesBlocked, fill: "var(--color-chart-3)" },
]
