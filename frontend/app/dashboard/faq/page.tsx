"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, GripVertical, MessageCircle } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  createFaqItem,
  deleteFaqItem,
  fetchFaqItems,
  getApiErrorMessage,
  updateFaqItem,
} from "@/lib/admin-api"
import type { FaqItem } from "@/lib/types"
import { toast } from "sonner"

export default function FaqPage() {
  const [items, setItems] = useState<FaqItem[]>([])
  const [editItem, setEditItem] = useState<FaqItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [title, setTitle] = useState("")
  const [answer, setAnswer] = useState("")
  const [previewItem, setPreviewItem] = useState<FaqItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    const loadItems = async () => {
      try {
        const data = await fetchFaqItems()
        if (active) {
          setItems(data)
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Nao foi possivel carregar o FAQ"))
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadItems()

    return () => {
      active = false
    }
  }, [])

  const sorted = [...items].sort((a, b) => a.position - b.position)

  const handleNew = () => {
    setIsNew(true)
    setTitle("")
    setAnswer("")
    setEditItem({
      id: `faq-new-${Date.now()}`,
      title: "",
      answer: "",
      position: items.length + 1,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  const handleEdit = (item: FaqItem) => {
    setIsNew(false)
    setTitle(item.title)
    setAnswer(item.answer)
    setEditItem(item)
  }

  const handleSave = async () => {
    if (!editItem || !title.trim() || !answer.trim()) {
      toast.error("Preencha titulo e resposta")
      return
    }
    try {
      if (isNew) {
        const response = await createFaqItem({
          title: title.trim(),
          answer: answer.trim(),
          position: editItem.position,
        })
        if (!response.ok) {
          toast.error(response.message)
          return
        }

        const refreshed = await fetchFaqItems()
        setItems(refreshed)
        toast.success("FAQ criada com sucesso")
      } else {
        const response = await updateFaqItem({
          id: editItem.id,
          title: title.trim(),
          answer: answer.trim(),
          position: editItem.position,
          active: editItem.active,
        })
        if (!response.ok) {
          toast.error(response.message)
          return
        }

        setItems((prev) =>
          prev.map((i) =>
            i.id === editItem.id ? { ...i, title: title.trim(), answer: answer.trim(), updatedAt: new Date().toISOString() } : i
          )
        )
        toast.success("FAQ atualizada")
      }
      setEditItem(null)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel salvar a FAQ"))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const response = await deleteFaqItem(id)
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setItems((prev) => prev.filter((i) => i.id !== id))
      toast.success("FAQ removida")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel remover a FAQ"))
    }
  }

  const handleToggleActive = async (id: string) => {
    const target = items.find((item) => item.id === id)
    if (!target) return

    try {
      const response = await updateFaqItem({
        id: target.id,
        title: target.title,
        answer: target.answer,
        position: target.position,
        active: !target.active,
      })
      if (!response.ok) {
        toast.error(response.message)
        return
      }

      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, active: !i.active, updatedAt: new Date().toISOString() } : i))
      )
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Nao foi possivel atualizar o status da FAQ"))
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="FAQ" breadcrumbs={[{ label: "FAQ" }]} />
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">FAQ Manager</h2>
            <p className="text-sm text-muted-foreground">{items.length} perguntas cadastradas</p>
          </div>
          <Button onClick={handleNew}>
            <Plus className="mr-2 h-4 w-4" /> Nova Pergunta
          </Button>
        </div>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            Carregando FAQ...
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((item) => (
            <Card key={item.id} className={!item.active ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground cursor-grab">
                    <GripVertical className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">#{item.position}</Badge>
                      <h3 className="text-sm font-semibold text-card-foreground">{item.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{item.answer}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={item.active}
                      onCheckedChange={() => handleToggleActive(item.id)}
                      aria-label={item.active ? "Desativar" : "Ativar"}
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewItem(item)} aria-label="Preview">
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(item)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(item.id)} aria-label="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        )}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={!!editItem} onOpenChange={() => setEditItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "Nova Pergunta" : "Editar Pergunta"}</DialogTitle>
            <DialogDescription>Preencha os campos abaixo</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label>Titulo</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Como me cadastrar?" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Resposta</Label>
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Resposta completa..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancelar</Button>
            <Button onClick={handleSave}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram Preview */}
      <Dialog open={!!previewItem} onOpenChange={() => setPreviewItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Preview Telegram</DialogTitle>
            <DialogDescription>Como a mensagem aparece no bot</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4">
            <div className="rounded-lg bg-card p-3 shadow-sm">
              <p className="text-sm font-bold text-card-foreground mb-2">{previewItem?.title}</p>
              <p className="text-sm text-card-foreground whitespace-pre-wrap">{previewItem?.answer}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewItem(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
