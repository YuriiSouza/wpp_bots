"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Map,
  Users,
  MapPin,
  ShieldBan,
  MessageCircleQuestion,
  RefreshCw,
  Table2,
  Headset,
  History,
  BarChart3,
  FileText,
  Bot,
  Settings,
  UserCircle2,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useAuthContext } from "@/components/auth-provider"

const mainNav = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Motoristas", href: "/dashboard/drivers", icon: Users },
  { title: "Rotas", href: "/dashboard/routes", icon: MapPin },
  { title: "Planejamento", href: "/dashboard/route-planning", icon: Map },
  { title: "Realocacao de volumoso", href: "/dashboard/route-consult", icon: MapPin },
  { title: "Overview", href: "/dashboard/overview", icon: Table2 },
]

const supportNav = [
  { title: "Atendimento", href: "/dashboard/support", icon: Headset },
  { title: "Historico", href: "/dashboard/history", icon: History },
  { title: "Metricas", href: "/dashboard/metrics", icon: BarChart3 },
]

const managementNav = [
  { title: "Blocklist", href: "/dashboard/blocklist", icon: ShieldBan },
  { title: "FAQ", href: "/dashboard/faq", icon: MessageCircleQuestion },
  { title: "Sync Monitor", href: "/dashboard/sync", icon: RefreshCw },
]

const systemNav = [
  { title: "Auditoria", href: "/dashboard/audit", icon: FileText },
  { title: "Saude do Bot", href: "/dashboard/bot-health", icon: Bot },
  { title: "Configuracoes", href: "/dashboard/settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { user } = useAuthContext()

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard"
    return pathname.startsWith(href)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Headset className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground">Fleet Analysis</span>
            <span className="text-xs text-sidebar-foreground/60">Central operacional</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Atendimento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {supportNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Gestao</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive("/dashboard/profile")} tooltip="Perfil">
              <Link href="/dashboard/profile">
                <UserCircle2 className="h-4 w-4" />
                <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                  <span className="text-xs font-medium">{user?.name}</span>
                  <span className="text-xs text-sidebar-foreground/60">{user?.role}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
