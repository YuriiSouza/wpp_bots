import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TOURS, type TourStep } from './steps'

// Tour guiado: escurece a tela e destaca, passo a passo, cada parte da tela atual.
// O alvo de cada passo é achado pelo texto que aparece na tela (ou pelo placeholder de um campo);
// se não estiver visível (ex.: tela sem dados), o passo aparece centralizado.

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function painted(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const bg = cs.backgroundColor
  return (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0
}

function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function findTarget(step: TourStep): HTMLElement | null {
  const root = document.querySelector('main')
  if (!root || !step.target) return null
  const want = norm(step.target)
  let found: HTMLElement | null = null
  if (want.startsWith('placeholder:')) {
    const p = want.slice('placeholder:'.length).trim()
    found = [...root.querySelectorAll<HTMLElement>('input, textarea')].find(el => norm(el.getAttribute('placeholder') ?? '').startsWith(p) && visible(el)) ?? null
  } else {
    // O elemento mais interno cujo texto começa com o procurado
    const all = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, button, th, label, div, a, td')]
    const matches = all.filter(el => visible(el) && norm(el.textContent ?? '').startsWith(want))
    found = matches.find(el => !matches.some(o => o !== el && el.contains(o))) ?? null
  }
  if (found && step.card) {
    // Sobe até o cartão/painel que contém o texto
    let el: HTMLElement | null = found
    for (let i = 0; i < 7 && el && el !== root; i++) {
      if (el !== found && painted(el)) return el
      el = el.parentElement
    }
  }
  return found
}

export function TourButton({ section, onStart }: { section: string; onStart: () => void }) {
  if (!TOURS[section]) return null
  return (
    <button onClick={onStart} title="Tour guiado desta tela"
      style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 900, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.45)' }}>
      ❓ Tour desta tela
    </button>
  )
}

export function Tour({ section, onClose }: { section: string; onClose: () => void }) {
  const tour = TOURS[section]
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = tour?.steps[i]
  const boxRef = useRef<HTMLDivElement>(null)
  const [boxH, setBoxH] = useState(0)
  useLayoutEffect(() => { const h = boxRef.current?.offsetHeight ?? 0; if (h && Math.abs(h - boxH) > 2) setBoxH(h) })

  const measure = useCallback(() => {
    if (!step) return
    const el = findTarget(step)
    if (!el) { setRect(null); return }
    const r0 = el.getBoundingClientRect()
    if (r0.top < 60 || r0.bottom > window.innerHeight - 40) el.scrollIntoView({ block: r0.height > window.innerHeight * 0.6 ? 'start' : 'center', behavior: 'instant' as ScrollBehavior })
    setRect(el.getBoundingClientRect())
  }, [step])

  useLayoutEffect(() => { measure() }, [measure])
  useEffect(() => {
    const t = setTimeout(measure, 120) // espera a tela assentar
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [measure])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') setI(v => Math.min(v + 1, (tour?.steps.length ?? 1) - 1))
      if (e.key === 'ArrowLeft') setI(v => Math.max(v - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, tour])

  if (!tour || !step) return null
  const last = i === tour.steps.length - 1
  const pad = 8
  const W = 380
  // Posição do balão: sempre dentro da tela. Abaixo do alvo, ou acima; se o alvo for grande demais
  // (ocupa boa parte da tela), o balão fica no canto inferior direito, por cima dele.
  const vw = window.innerWidth, vh = window.innerHeight
  const BH = boxH || 240
  const clampTop = (t: number) => Math.min(Math.max(12, t), vh - BH - 12)
  const clampLeft = (l: number) => Math.min(Math.max(12, l), vw - W - 12)
  let box: React.CSSProperties
  if (rect) {
    const spaceBelow = vh - rect.bottom
    const spaceAbove = rect.top
    if (spaceBelow >= BH + 30) box = { top: clampTop(rect.bottom + pad + 14), left: clampLeft(rect.left) }
    else if (spaceAbove >= BH + 30) box = { top: clampTop(rect.top - pad - 14 - BH), left: clampLeft(rect.left) }
    else if (vw - rect.right >= W + 40) box = { top: clampTop(rect.top), left: clampLeft(rect.right + pad + 14) }
    else box = { top: vh - BH - 24, left: vw - W - 24 }
  } else {
    box = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }
  // Destaque limitado à área visível
  const hl = rect ? {
    left: Math.max(4, rect.left - pad), top: Math.max(4, rect.top - pad),
    right: Math.min(vw - 4, rect.right + pad), bottom: Math.min(vh - 4, rect.bottom + pad),
  } : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
      {rect ? (
        <div style={{ position: 'fixed', left: hl!.left, top: hl!.top, width: hl!.right - hl!.left, height: hl!.bottom - hl!.top, borderRadius: 10, boxShadow: '0 0 0 9999px rgba(5,7,12,.72)', border: '2px solid #a78bfa', pointerEvents: 'none', transition: 'all .2s ease' }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,7,12,.72)' }} />
      )}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0 }} />
      <div ref={boxRef} style={{ position: 'fixed', width: W, maxHeight: vh - 24, overflow: 'auto', ...box, background: '#13151f', border: '1px solid #3b3f5c', borderRadius: 12, padding: '16px 18px', boxShadow: '0 12px 40px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '.06em' }}>{tour.title} · {i + 1} de {tour.steps.length}</span>
          <button onClick={onClose} title="Fechar (Esc)" style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>{step.title}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#cbd5e1', whiteSpace: 'pre-line' }}>{step.text}</p>
        {step.target && !rect && <p style={{ margin: 0, fontSize: 11, color: '#fbbf24' }}>Esta parte aparece quando a tela tem dados carregados.</p>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {tour.steps.map((_, k) => <span key={k} onClick={() => setI(k)} style={{ width: 7, height: 7, borderRadius: 4, cursor: 'pointer', background: k === i ? '#a78bfa' : '#2d3048' }} />)}
          </div>
          {i > 0 && <button onClick={() => setI(i - 1)} style={{ background: 'transparent', border: '1px solid #2d3048', color: '#cbd5e1', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>← Anterior</button>}
          <button onClick={() => (last ? onClose() : setI(i + 1))} style={{ background: '#7c3aed', border: 'none', color: '#fff', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{last ? 'Concluir ✓' : 'Próximo →'}</button>
        </div>
      </div>
    </div>
  )
}
