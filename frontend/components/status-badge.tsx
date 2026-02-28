import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusConfig: Record<string, { label: string; className: string }> = {
  DISPONIVEL: { label: "Disponivel", className: "bg-chart-2/15 text-chart-2 border-chart-2/30" },
  ATRIBUIDA: { label: "Atribuida", className: "bg-chart-1/15 text-chart-1 border-chart-1/30" },
  BLOQUEADA: { label: "Bloqueada", className: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
  ACTIVE: { label: "Ativo", className: "bg-chart-3/15 text-chart-3 border-chart-3/30" },
  INACTIVE: { label: "Inativo", className: "bg-muted text-muted-foreground border-border" },
  UNLISTED: { label: "Nao listado", className: "bg-chart-4/15 text-chart-4 border-chart-4/30" },
  SUCCESS: { label: "Sucesso", className: "bg-success/15 text-success border-success/30" },
  FAILED: { label: "Falha", className: "bg-destructive/15 text-destructive border-destructive/30" },
  RUNNING: { label: "Executando", className: "bg-chart-4/15 text-chart-4 border-chart-4/30" },
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground border-border" }
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", config.className, className)}>
      {config.label}
    </Badge>
  )
}
