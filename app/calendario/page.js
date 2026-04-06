'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

// ── Helpers de data ───────────────────────────────────
const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]
const DAY_NAMES = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

function toYMD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildCalendarDays(year, month) {
  const firstDay  = new Date(year, month, 1).getDay()   // 0=Dom
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays  = new Date(year, month, 0).getDate()  // último dia do mês anterior

  const cells = []
  // Dias do mês anterior (preenchimento)
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, current: false })
  }
  // Dias do mês atual
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, current: true })
  }
  // Dias do próximo mês (completar até múltiplo de 7)
  const remaining = 7 - (cells.length % 7)
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, current: false })
    }
  }
  return cells
}

// Verifica se uma data cai dentro de um intervalo (inclusive)
function inRange(dateStr, startStr, endStr) {
  if (!endStr) return dateStr === startStr
  return dateStr >= startStr && dateStr <= endStr
}

// Tipos de evento → cor + label
const EVENT_META = {
  feriado:     { color: '#F59E0B', bg: '#FFF8E1', label: 'Feriado'        },
  recesso:     { color: '#6B7280', bg: '#F3F4F6', label: 'Recesso'        },
  evento:      { color: '#8B5CF6', bg: '#F5F3FF', label: 'Evento'         },
  inicio_aulas:{ color: '#00843D', bg: '#E8F5E9', label: 'Início das Aulas'},
  fim_aulas:   { color: '#EF4444', bg: '#FEF2F2', label: 'Fim das Aulas'  },
  avaliacao:   { color: '#3B82F6', bg: '#EFF6FF', label: 'Avaliações'     },
}

const TASK_META = {
  prova:     { color: '#EF4444', label: 'Prova'     },
  atividade: { color: '#3B82F6', label: 'Atividade' },
}

// ── Componente Principal ──────────────────────────────
export default function CalendarioPage() {
  const router  = useRouter()
  const today   = new Date()

  // Calendário restrito a 2026
  const initMonth = today.getFullYear() === 2026 ? today.getMonth() : 0
  const [year,  setYear]  = useState(2026)
  const [month, setMonth] = useState(initMonth)
  const [selectedDay, setSelectedDay] = useState(null)    // 'YYYY-MM-DD'

  const canGoPrev = month > 0   // Jan 2026 = limite inferior
  const canGoNext = month < 11  // Dez 2026 = limite superior

  const [tasks,  setTasks]  = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  // ── Auth + dados ──────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/'); return }
      await fetchAll()
      setLoading(false)
    })
  }, [])

  async function fetchAll() {
    const [tasksRes, eventsRes] = await Promise.all([
      supabase.from('tasks').select('id,type,subject,description,due_date,done'),
      supabase.from('academic_events').select('*').order('date'),
    ])
    if (tasksRes.data)  setTasks(tasksRes.data)
    if (eventsRes.data) setEvents(eventsRes.data)
  }

  // ── Navegação de mês ──────────────────────────────────
  function prevMonth() {
    if (!canGoPrev) return
    setMonth(m => m - 1)
    setSelectedDay(null)
  }
  function nextMonth() {
    if (!canGoNext) return
    setMonth(m => m + 1)
    setSelectedDay(null)
  }
  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setSelectedDay(toYMD(today))
  }

  // ── Indexa dados por data para renderização rápida ───
  const tasksByDate   = {}
  const eventsByDate  = {}

  tasks.forEach(t => {
    if (!tasksByDate[t.due_date]) tasksByDate[t.due_date] = []
    tasksByDate[t.due_date].push(t)
  })

  events.forEach(ev => {
    // Eventos multi-dia: marca cada dia do intervalo
    const start = ev.date
    const end   = ev.end_date ?? ev.date
    let cur = new Date(start + 'T00:00:00')
    const endDate = new Date(end + 'T00:00:00')
    while (cur <= endDate) {
      const key = toYMD(cur)
      if (!eventsByDate[key]) eventsByDate[key] = []
      eventsByDate[key].push(ev)
      cur.setDate(cur.getDate() + 1)
    }
  })

  const cells   = buildCalendarDays(year, month)
  const todayStr = toYMD(today)

  // ── Detalhes do dia selecionado ───────────────────────
  const selTasks  = selectedDay ? (tasksByDate[selectedDay] ?? [])  : []
  const selEvents = selectedDay ? (eventsByDate[selectedDay] ?? []) : []

  // ── Render ────────────────────────────────────────────
  if (loading) return (
    <div className="cal-loading" role="status" aria-live="polite">
      Carregando calendário…
    </div>
  )

  return (
    <div className="cal-page">
      {/* Header */}
      <header className="cal-header">
        <div className="cal-header-inner">
          <button className="cal-back-btn" onClick={() => router.push('/')} aria-label="Voltar">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M13 4l-6 6 6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Voltar
          </button>

          <h1 className="cal-title">Calendário do IF</h1>

          <button className="cal-today-btn" onClick={goToday}>Hoje</button>
        </div>
      </header>

      <main className="cal-main">
        {/* Layout: coluna esquerda = grid, coluna direita = detalhes (desktop) */}
        <div className="cal-body">

          {/* ── Coluna do calendário ─────────────────── */}
          <div className="cal-col-grid">
            {/* Navegação de mês */}
            <div className="cal-nav">
              <button className="cal-nav-btn" onClick={prevMonth} aria-label="Mês anterior" disabled={!canGoPrev}>
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <h2 className="cal-month-label">{MONTH_NAMES[month]} {year}</h2>
              <button className="cal-nav-btn" onClick={nextMonth} aria-label="Próximo mês" disabled={!canGoNext}>
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Grid */}
            <div className="cal-grid-wrap">
              <div className="cal-grid cal-grid-header">
                {DAY_NAMES.map(d => (
                  <div key={d} className={`cal-day-name${d === 'Dom' || d === 'Sáb' ? ' weekend' : ''}`}>
                    {d}
                  </div>
                ))}
              </div>

              <div className="cal-grid cal-grid-body">
                {cells.map((cell, i) => {
                  if (!cell.current) {
                    return <div key={`ghost-${i}`} className="cal-cell cal-cell--ghost" />
                  }

                  const dateStr   = `${year}-${String(month + 1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`
                  const dayTasks  = tasksByDate[dateStr] ?? []
                  const dayEvents = eventsByDate[dateStr] ?? []
                  const isToday    = dateStr === todayStr
                  const isSelected = dateStr === selectedDay
                  const hasData    = dayTasks.length > 0 || dayEvents.length > 0

                  let cellBg = ''
                  if (dayEvents.length > 0) {
                    cellBg = EVENT_META[dayEvents[0].type]?.bg ?? ''
                  }

                  return (
                    <button
                      key={dateStr}
                      className={[
                        'cal-cell',
                        isToday    ? 'cal-cell--today'    : '',
                        isSelected ? 'cal-cell--selected' : '',
                        hasData    ? 'cal-cell--has-data'  : '',
                      ].join(' ').trim()}
                      style={cellBg && !isSelected ? { backgroundColor: cellBg } : {}}
                      onClick={() => setSelectedDay(prev => prev === dateStr ? null : dateStr)}
                      aria-label={`${cell.day} de ${MONTH_NAMES[month]}`}
                      aria-pressed={isSelected}
                    >
                      <span className="cal-day-num">{cell.day}</span>
                      <div className="cal-dots">
                        {dayEvents.slice(0, 2).map((ev, ei) => (
                          <span key={ei} className="cal-dot"
                            style={{ backgroundColor: EVENT_META[ev.type]?.color ?? '#6B7280' }} />
                        ))}
                        {dayTasks.filter(t => t.type === 'prova').length > 0 && (
                          <span className="cal-dot" style={{ backgroundColor: '#EF4444' }} />
                        )}
                        {dayTasks.filter(t => t.type === 'atividade').length > 0 && (
                          <span className="cal-dot" style={{ backgroundColor: '#3B82F6' }} />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Legenda */}
            <div className="cal-legend">
              {Object.entries(EVENT_META).map(([key, meta]) => (
                <div key={key} className="cal-legend-item">
                  <span className="cal-legend-dot" style={{ backgroundColor: meta.color }} />
                  <span>{meta.label}</span>
                </div>
              ))}
              <div className="cal-legend-item">
                <span className="cal-legend-dot" style={{ backgroundColor: '#EF4444' }} />
                <span>Prova</span>
              </div>
              <div className="cal-legend-item">
                <span className="cal-legend-dot" style={{ backgroundColor: '#3B82F6' }} />
                <span>Atividade</span>
              </div>
            </div>
          </div>

          {/* ── Coluna de detalhes (desktop: sempre visível) ─ */}
          <div className="cal-col-detail">
            <div className="cal-detail" role="region" aria-label="Detalhes do dia">
              {!selectedDay ? (
                <div className="cal-detail-placeholder">
                  <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
                    <rect x="4" y="8" width="40" height="36" rx="5" stroke="var(--border-strong)" strokeWidth="2"/>
                    <path d="M4 18h40" stroke="var(--border-strong)" strokeWidth="2"/>
                    <path d="M16 4v8M32 4v8" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="16" cy="30" r="2" fill="var(--text-muted)"/>
                    <circle cx="24" cy="30" r="2" fill="var(--text-muted)"/>
                    <circle cx="32" cy="30" r="2" fill="var(--text-muted)"/>
                  </svg>
                  <p>Clique em um dia para ver os eventos e tarefas.</p>
                </div>
              ) : (
                <>
                  <h3 className="cal-detail-title">
                    {new Date(selectedDay + 'T00:00:00').toLocaleDateString('pt-BR', {
                      weekday: 'long', day: 'numeric', month: 'long',
                    })}
                  </h3>

                  {selEvents.length === 0 && selTasks.length === 0 && (
                    <p className="cal-detail-empty">Nenhum evento ou tarefa neste dia.</p>
                  )}

                  {selEvents.map(ev => {
                    const meta = EVENT_META[ev.type] ?? {}
                    return (
                      <div key={ev.id} className="cal-detail-item"
                        style={{ borderLeftColor: meta.color, backgroundColor: meta.bg }}>
                        <span className="cal-detail-item-type" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="cal-detail-item-title">{ev.title}</span>
                        {ev.end_date && ev.end_date !== ev.date && (
                          <span className="cal-detail-item-sub">
                            até {new Date(ev.end_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}
                          </span>
                        )}
                      </div>
                    )
                  })}

                  {selTasks.map(t => {
                    const meta = TASK_META[t.type] ?? {}
                    return (
                      <div key={t.id}
                        className={`cal-detail-item${t.done ? ' cal-detail-item--done' : ''}`}
                        style={{ borderLeftColor: meta.color }}>
                        <span className="cal-detail-item-type" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        <span className="cal-detail-item-title">{t.subject}</span>
                        <span className="cal-detail-item-sub">{t.description}</span>
                        {t.done && <span className="cal-detail-item-done">Concluída ✓</span>}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
