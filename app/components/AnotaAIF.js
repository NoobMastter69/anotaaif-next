'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import AuthScreen from './AuthScreen'

// ── Filtro de palavrões e nomes sensíveis ────────────
const BLOCKED = [
  // Palavrões PT-BR
  'porra','caralho','puta','viado','buceta','cu','merda','foda','fodase',
  'cuzão','cuzao','arrombado','arrombada','otário','otario','otaria',
  'vagabundo','vagabunda','piranha','cacete','desgraça','desgracado',
  'filhadaputa','fdp','vsf','vtnc','tnc','pnc','corno','corna',
  'babaca','idiota','imbecil','retardado','retardada','rola','rolinha',
  'xereca','xoxota','punheta','tesão','tesao','safado','safada',
  // Palavrões EN
  'fuck','shit','bitch','nigga','nigger','faggot','dick','pussy','cunt','asshole','bastard',
  // Figuras históricas sensíveis / hate speech
  'hitler','adolf','himmler','goebbels','goering','mengele','heydrich','eichmann',
  'mussolini','stalin','osama','bin laden','binladen','pol pot','idi amin',
  'saddam','hussein','gaddafi','milosevic',
  'epstein','jeffrey epstein','pdiddy','p diddy','diddy','sean combs',
  // Grupos de ódio / termos ofensivos
  'nazista','nazi','nazismo','fascista','kkk','ku klux',
].map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))

// Frases/nomes compostos que o \b não pega bem
const BLOCKED_PHRASES = [
  'bin laden','ku klux','adolf hitler','pol pot','idi amin',
].map(p => p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))

function hasProfanity(str) {
  const normalized = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  if (BLOCKED_PHRASES.some(p => normalized.includes(p))) return true
  return BLOCKED.some(w => new RegExp(`\\b${w}\\b`).test(normalized))
}

// ── Audit log helper ──────────────────────────────────────
async function logAudit(userId, userName, action, details = {}, classCode = null) {
  try {
    await supabase.from('audit_logs').insert({ user_id: userId, user_name: userName, action, details, class_code: classCode })
  } catch (_) {}
}

// Captura beforeinstallprompt ANTES do React montar (evita perder o evento)
let _installPrompt = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    _installPrompt = e
  })
}

// ── Helpers ───────────────────────────────────────────
function campusShort(campus) {
  if (!campus) return 'IFSP'
  // "IFSP – Itapetininga" → "IFSP Itapetininga"
  // "IFSP – São Paulo (São Paulo)" → "IFSP São Paulo"
  const m = campus.match(/–\s*(.+)/)
  if (!m) return campus
  const city = m[1].trim().replace(/\s*\(.*\)/, '') // remove "(São Paulo)" duplicado
  return `IFSP ${city}`
}

// ── Constantes ────────────────────────────────────────
const STORAGE_KEY  = 'anotaaif_tasks'
const SUBJECTS_KEY = 'anotaaif_subjects'

// ── Mapeamento JS ↔ DB ───────────────────────────────
function toDb(task, userId = null, includeExtraDates = false) {
  const obj = {
    id: task.id,
    type: task.type,
    subject: task.subject,
    description: task.description,
    due_date: task.dueDate,
    done: task.done,
    material_url: task.materialUrl || null,
    created_at: new Date(task.createdAt).toISOString(),
    ...(userId ? { created_by: userId } : {}),
  }
  if (includeExtraDates) {
    obj.extra_dates = (task.extraDates && task.extraDates.length > 0) ? task.extraDates : null
  }
  return obj
}

function fromDb(row) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    description: row.description,
    dueDate: row.due_date,
    done: row.done,
    materialUrl: row.material_url || null,
    createdAt: new Date(row.created_at).getTime(),
    createdBy: row.created_by || null,
    subgroupId: row.subgroup_id || null,
    extraDates: row.extra_dates || null,
  }
}

// ── Utilitários ───────────────────────────────────────
function getTodayString() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function generateId() {
  return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// Retorna a data mais próxima que ainda não passou (ou a última se todas passaram)
function getNearestDate(task) {
  const all = [task.dueDate, ...(task.extraDates || [])].filter(Boolean).sort()
  if (all.length === 0) return task.dueDate
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return all.find(d => new Date(d + 'T00:00:00') >= today) ?? all[all.length - 1]
}

function getUrgency(task) {
  if (task.done) return 'done'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(getNearestDate(task) + 'T00:00:00')
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24))
  if (diffDays <= 1) return 'overdue'  // atrasado, hoje ou amanhã → vermelho
  if (diffDays <= 3) return 'soon'     // 2-3 dias → amarelo
  return 'ok'
}

function formatDueDate(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) {
    const days = Math.abs(diffDays)
    return days === 1 ? 'Atrasada (ontem)' : `Atrasada (${days} dias)`
  }
  if (diffDays === 0) return 'Hoje!'
  if (diffDays === 1) return 'Amanhã'
  if (diffDays <= 6) return `Em ${diffDays} dias`
  return due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ── TaskCard ──────────────────────────────────────────
function TaskCard({ task, urgency, dueDateText, delay, onToggle, onEdit, onDelete, canDelete, onDoubts }) {
  const cardRef    = useRef(null)
  const startX     = useRef(0)
  const deltaX     = useRef(0)      // px arrastados (para distinguir tap de swipe)

  function handleTouchStart(e) {
    startX.current  = e.touches[0].clientX
    deltaX.current  = 0
    if (cardRef.current) cardRef.current.style.transition = 'none'
  }

  function handleTouchMove(e) {
    const dx = startX.current - e.touches[0].clientX
    if (dx <= 0) return                         // arrasto p/ direita: ignora
    deltaX.current = dx
    if (cardRef.current) cardRef.current.style.transform = `translateX(${-dx}px)`
  }

  function handleTouchEnd() {
    const card = cardRef.current
    if (!card) return
    card.style.transition = ''                  // restaura transição CSS

    if (deltaX.current > 110 && canDelete) {
      // Threshold atingido → desliza para fora e deleta
      card.style.transform = 'translateX(-110%)'
      card.style.opacity   = '0'
      setTimeout(onDelete, 300)
    } else {
      // Volta ao lugar
      card.style.transform = ''
    }
  }

  function handleCardClick(e) {
    if (deltaX.current > 8) return
    if (e.target.closest('.task-checkbox-wrap')) return
    if (e.target.closest('.task-card-footer')) return     // footer: não abre edição
    onEdit()
  }

  return (
    <div className="swipe-container" style={{ animationDelay: `${delay}s` }}>
      {/* Fundo vermelho */}
      <div className="swipe-delete-bg" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Card deslizável */}
      <div
        ref={cardRef}
        className={`task-card urgency-${urgency}${task.done ? ' done' : ''}`}
        role="listitem"
        onClick={handleCardClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="task-accent" />
        <div className="task-body">
          <div className="task-info">
            <div className="task-header-row">
              <span className="task-subject">{task.subject}</span>
              <span className={`task-type-badge badge-${task.type}`}>
                {task.type === 'prova' ? 'Prova' : 'Atividade'}
              </span>
            </div>
            <p className="task-description">{task.description}</p>
            <span className="task-due">
              <svg className="due-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M4 1v2.5M10 1v2.5M1 6h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              {dueDateText}
              {task.extraDates && task.extraDates.length > 0 && (
                <span className="task-multiday-badge">
                  +{task.extraDates.length} {task.extraDates.length === 1 ? 'data' : 'datas'}
                </span>
              )}
            </span>
            {task.extraDates && task.extraDates.length > 0 && (
              <div className="task-extra-dates">
                {[task.dueDate, ...task.extraDates].sort().map((d, i) => {
                  const today = new Date(); today.setHours(0,0,0,0)
                  const isPast = new Date(d + 'T00:00:00') < today
                  return (
                    <span key={i} className={`task-date-chip${isPast ? ' past' : ''}`}>
                      {formatShortDate(d)}
                    </span>
                  )
                })}
              </div>
            )}
            {(task.materialUrl || onDoubts) && (
              <div className="task-card-footer" onClick={e => e.stopPropagation()}>
                {task.materialUrl && (
                  <a href={task.materialUrl} target="_blank" rel="noopener noreferrer" className="task-footer-btn task-footer-material">
                    {task.materialUrl.includes('/storage/v1/object/public/task-files/') ? '📁 Arquivo' : '📎 Material'}
                  </a>
                )}
                <button className="task-footer-btn task-footer-doubts" onClick={onDoubts}>
                  💬 Dúvidas
                </button>
              </div>
            )}
          </div>
          <div className="task-checkbox-wrap">
            <input
              type="checkbox"
              className="task-checkbox"
              checked={task.done}
              onChange={onToggle}
              aria-label={`Marcar '${task.subject}' como concluída`}
            />
          </div>
        </div>
      </div>

      {/* Botão de deletar (desktop — aparece no hover) */}
      {canDelete && <button
        className="card-delete-btn"
        aria-label={`Deletar '${task.subject}'`}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>}
    </div>
  )
}

// ── EventCard ─────────────────────────────────────────
function EventCard({ task, delay, onEdit, onDelete, canDelete }) {
  const today = new Date(); today.setHours(0,0,0,0)
  const eventDate = new Date(task.dueDate + 'T00:00:00')
  const diffDays = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24))
  const isPast = diffDays < 0
  const dateText = formatDueDate(task.dueDate)

  return (
    <div className={`event-card${isPast ? ' event-past' : ''}`} style={{ animationDelay: `${delay}s` }}>
      <div className="event-accent" />
      <div className="event-body">
        <div className="event-header-row">
          <span className="event-name">{task.subject}</span>
          <span className="event-badge">Evento</span>
        </div>
        {task.description && <p className="event-description">{task.description}</p>}
        <div className="event-footer">
          <span className="event-date">
            <svg className="due-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 1v2.5M10 1v2.5M1 6h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {dateText}
          </span>
          {task.materialUrl && (
            <a href={task.materialUrl} target="_blank" rel="noopener noreferrer" className="event-link-btn">
              🔗 Mais info
            </a>
          )}
        </div>
      </div>
      {canDelete && (
        <div className="event-actions">
          <button className="event-action-btn event-edit-btn" onClick={onEdit} title="Editar evento" aria-label="Editar evento">
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <path d="M13.5 2.5l4 4L6 18H2v-4L13.5 2.5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="event-action-btn event-del-btn" onClick={onDelete} title="Remover evento" aria-label="Remover evento">
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <path d="M3 5h14M8 5V3h4v2M16 5l-1 12H5L4 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Componente Principal ──────────────────────────────
export default function AnotaAIF() {
  const router = useRouter()

  // Auth
  const [user, setUser]             = useState(undefined)  // undefined = ainda verificando
  const [profile, setProfile]       = useState(null)       // perfil do aluno (turma, campus…)
  const [welcomeName, setWelcomeName] = useState('')
  const [welcomeVisible, setWelcomeVisible] = useState(false)

  // App
  const [tasks, setTasks]           = useState([])
  const [completions, setCompletions] = useState(new Set())  // task_ids concluídas pelo aluno
  const [activeFilter, setActiveFilter] = useState('all')
  const [isModalOpen, setIsModalOpen]   = useState(false)
  const [editingTask, setEditingTask]   = useState(null)
  const [snackbar, setSnackbar]         = useState({ message: '', visible: false })

  // PWA Install
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstallButton, setShowInstallButton] = useState(false)
  const [showIosInstallModal, setShowIosInstallModal] = useState(false)
  const [isIos, setIsIos]                 = useState(false)
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false)


  // Estado do formulário
  const [taskType, setTaskType]     = useState('prova')
  const [subject, setSubject]       = useState('')
  const [desc, setDesc]             = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [materialUrl, setMaterialUrl] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState('')
  const fileInputRef = useRef(null)
  // Múltiplos dias
  const [isMultiDay, setIsMultiDay]     = useState(false)
  const [extraDates, setExtraDates]     = useState([])
  const [hasExtraDates, setHasExtraDates] = useState(false) // coluna existe no DB?
  const [subjectError, setSubjectError] = useState('')
  const [descError, setDescError]       = useState('')
  const [dateError, setDateError]       = useState('')

  // Feedback
  const [feedbackOpen, setFeedbackOpen]   = useState(false)
  const [feedbackText, setFeedbackText]   = useState('')
  const [feedbackSent, setFeedbackSent]   = useState(false)
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [feedbackNudge, setFeedbackNudge] = useState(false)

  // Popup de novidade: Eventos
  const [showEventsPopup, setShowEventsPopup] = useState(false)

  // Popup de atualização 28/04/2026
  const [showUpdatePopup, setShowUpdatePopup] = useState(false)

  // Aviso de sala removida
  const [roomRemovedNotice, setRoomRemovedNotice] = useState(false)

  // Subgrupos + seletor de contexto
  const [mySubgroups, setMySubgroups]         = useState([])
  const [activeSubgroup, setActiveSubgroup]   = useState(null) // { id, name, invite_code, role, class_code }
  const [viewMode, setViewMode]               = useState(null) // null=seletor | 'class' | 'subgroup'
  const [sgTab, setSgTab]                     = useState('create') // 'create' | 'join'
  const [sgName, setSgName]                   = useState('')
  const [sgJoinCode, setSgJoinCode]           = useState('')
  const [sgError, setSgError]                 = useState('')
  const [sgLoading, setSgLoading]             = useState(false)

  // Ver colegas
  const [showMembers, setShowMembers] = useState(null)
  const [members, setMembers]         = useState([])

  // Dúvidas
  const [doubtsTask, setDoubtsTask]   = useState(null)
  const [doubts, setDoubts]           = useState([])
  const [newDoubt, setNewDoubt]       = useState('')
  const [replyTexts, setReplyTexts]   = useState({})
  const [savedSubjects, setSavedSubjects] = useState([])
  const [suggestions, setSuggestions]     = useState([])

  const subjectRef       = useRef(null)
  const snackTimerRef    = useRef(null)
  const pendingDeleteRef = useRef(null)   // { task, timerId }
  const banChannelRef    = useRef(null)
  const manualSignOutRef = useRef(false)

  // Ban detection
  const [isBanned, setIsBanned] = useState(false)

  // Push notification subscription
  const [pushEnabled, setPushEnabled] = useState(false)
  const VAPID_PUBLIC = 'BP68pPed7fc05A0rpVHStsZdJkxXdbVg-_dmjz4DDq6RB1PxLef6slZQ4ix_A_MGHYMB-LEUEq1IVciYn6ixjeg'

  // ── PWA: registra SW + detecta plataforma + captura prompt ──
  useEffect(() => {
    // Registra service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    // Detecta iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
    setIsIos(ios)
    setIsInStandaloneMode(standalone)

    if (!standalone) {
      if (ios) {
        setShowInstallButton(true)
      } else {
        // Usa prompt já capturado globalmente antes do React montar
        if (_installPrompt) {
          setDeferredPrompt(_installPrompt)
          setShowInstallButton(true)
        }
        // Também ouve eventos futuros (caso ainda não tenha chegado)
        const handler = (e) => {
          e.preventDefault()
          _installPrompt = e
          setDeferredPrompt(e)
          setShowInstallButton(true)
        }
        window.addEventListener('beforeinstallprompt', handler)
        return () => window.removeEventListener('beforeinstallprompt', handler)
      }
    }
  }, [])

  async function handleInstallClick() {
    if (isIos) {
      setShowIosInstallModal(true)
      return
    }
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setShowInstallButton(false)
    setDeferredPrompt(null)
  }

  // Verifica sessão ativa ao montar
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Detecta se a coluna extra_dates existe no banco
  useEffect(() => {
    if (!user) return
    supabase.from('tasks').select('extra_dates').limit(1)
      .then(({ error }) => setHasExtraDates(!error))
  }, [user])

  // Carrega dados quando o usuário estiver autenticado
  useEffect(() => {
    if (!user) return
    loadProfileThenData()
    loadMySubgroups()

    // Preenche código de subgrupo automaticamente se vier da URL (?sgcode=XXXX)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const sgcode = params.get('sgcode')
      if (sgcode) {
        setSgJoinCode(sgcode.toUpperCase())
        setSgTab('join')
        // Limpa o param da URL sem reload
        const url = new URL(window.location.href)
        url.searchParams.delete('sgcode')
        window.history.replaceState({}, '', url)
      }
    }

    // Matérias salvas (preferência local)
    try {
      const rawSubjects = localStorage.getItem(SUBJECTS_KEY)
      if (rawSubjects) setSavedSubjects(JSON.parse(rawSubjects))
    } catch {}
  }, [user])

  // Mostra nudge de feedback (só 1x, some após enviar ou fechar)
  useEffect(() => {
    if (!user) return
    try {
      const dismissed = localStorage.getItem('feedback_nudge_dismissed')
      if (!dismissed) {
        const t = setTimeout(() => setFeedbackNudge(true), 4000)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [user])

  // Popup de novidade: Eventos — aparece 1x (hoje/amanhã), some para sempre no X
  useEffect(() => {
    if (!user) return
    try {
      const dismissed = localStorage.getItem('events_popup_v1')
      if (dismissed) return
      // Janela: 14 e 15/04/2026
      const now = new Date()
      const cutoff = new Date('2026-04-16T00:00:00')
      if (now < cutoff) {
        const t = setTimeout(() => setShowEventsPopup(true), 1800)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [user])

  // Popup de atualização 28/04/2026 — aparece até 29/04 23:00, some para sempre no X
  useEffect(() => {
    if (!user) return
    try {
      if (localStorage.getItem('update_280426_v1')) return
      const now = new Date()
      const cutoff = new Date('2026-04-29T23:00:00')
      if (now < cutoff) {
        const t = setTimeout(() => setShowUpdatePopup(true), 2400)
        return () => clearTimeout(t)
      }
    } catch {}
  }, [user])

  // Carrega tasks quando o viewMode mudar (classe ou subgrupo escolhido)
  useEffect(() => {
    if (!user || !viewMode) return
    if (viewMode === 'class') loadData(null)
    else if (viewMode === 'subgroup' && activeSubgroup) loadData(activeSubgroup.id)
  }, [viewMode, activeSubgroup?.id])

  async function loadProfileThenData() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (error) throw error
      setProfile(data)

      // Detecta sala removida: se o admin deletou a sala, profile.class_code vira null
      // mas localStorage ainda guarda o código anterior → mostra aviso
      try {
        const lastCode = localStorage.getItem('anotaaif_last_class_code')
        if (lastCode && !data.class_code) {
          localStorage.removeItem('anotaaif_last_class_code')
          setRoomRemovedNotice(true)
        } else if (data.class_code) {
          localStorage.setItem('anotaaif_last_class_code', data.class_code)
        }
      } catch {}

      // Detecta ban em tempo real — se o perfil for deletado, exibe tela de banido
      if (banChannelRef.current) supabase.removeChannel(banChannelRef.current)
      banChannelRef.current = supabase
        .channel(`ban-${user.id}`)
        .on('postgres_changes', {
          event: 'DELETE', schema: 'public', table: 'profiles',
          filter: `id=eq.${user.id}`,
        }, () => {
          setIsBanned(true)
          supabase.auth.signOut()
        })
        .subscribe()

      syncPushSubscription(user.id)

      // Verifica ?room=CODE para admin entrar em outra sala
      if (data?.is_admin && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const room = params.get('room')
        // Só ativa viewingRoom se for uma sala DIFERENTE da própria
        if (room && room.toUpperCase() !== data.class_code) {
          viewingRoomRef.current = room.toUpperCase()
          setViewingRoom(room.toUpperCase())
        }
      }
    } catch (err) {
      // PGRST116 = 0 rows de .single() → perfil deletado (ban ou deleção acidental)
      if (err?.code === 'PGRST116') {
        setIsBanned(true)
        supabase.auth.signOut()
        return
      }
      // Outros erros (rede, etc.) → não quebra o app, deixa sem perfil carregado
    }
    // Não carrega tasks automaticamente — seletor de contexto cuida disso
  }

  async function loadMySubgroups() {
    if (!user) return
    const { data } = await supabase
      .from('subgroup_members')
      .select('role, subgroup:subgroups(id, name, invite_code, class_code, created_by)')
      .eq('user_id', user.id)
    setMySubgroups((data ?? []).map(r => ({ ...r.subgroup, role: r.role })))
  }

  async function loadData(subgroupId = null) {
    // Admin visualizando outra sala — busca via API (bypassa RLS)
    if (viewingRoomRef.current) {
      try {
        const res = await fetch(`/api/admin/room-tasks?code=${viewingRoomRef.current}`)
        const { tasks: data } = await res.json()
        setTasks((data ?? []).map(fromDb))
      } catch {
        setTasks([])
      }
      return
    }

    try {
      const taskQuery = subgroupId
        ? supabase.from('tasks').select('*').eq('subgroup_id', subgroupId).order('created_at', { ascending: true })
        : supabase.from('tasks').select('*').is('subgroup_id', null).order('created_at', { ascending: true })

      const [tasksRes, completionsRes] = await Promise.all([
        taskQuery,
        // completions são sempre do próprio usuário (RLS já garante)
        supabase.from('completions').select('task_id').eq('user_id', user.id),
      ])

      if (tasksRes.error) throw tasksRes.error

      setTasks(tasksRes.data.map(fromDb))

      if (completionsRes.data) {
        setCompletions(new Set(completionsRes.data.map(c => c.task_id)))
      }
    } catch {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        setTasks(raw ? JSON.parse(raw) : [])
      } catch {
        setTasks([])
      }
    }
  }

  function handleAuth(newUser, displayName) {
    setUser(newUser)
    setWelcomeName(displayName)
    setWelcomeVisible(true)
    setTimeout(() => setWelcomeVisible(false), 3000)
  }

  // Scroll lock quando modal abre
  useEffect(() => {
    document.body.style.overflow = isModalOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isModalOpen])

  // Foca o primeiro campo após animação
  useEffect(() => {
    if (isModalOpen) {
      const t = setTimeout(() => subjectRef.current?.focus(), 350)
      return () => clearTimeout(t)
    }
  }, [isModalOpen])

  // Fecha qualquer modal aberto com Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (doubtsTask)          { setDoubtsTask(null); return }
      if (showMembers)         { setShowMembers(null); return }
      if (feedbackOpen)        { setFeedbackOpen(false); setFeedbackSent(false); setFeedbackText(''); return }
      if (showIosInstallModal) { setShowIosInstallModal(false); return }
      if (isModalOpen)         { closeModal() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isModalOpen, doubtsTask, showMembers, feedbackOpen, showIosInstallModal])

  // ── Modal ─────────────────────────────────────────────
  function openModal(task = null) {
    if (task) {
      setEditingTask(task)
      setTaskType(task.type)
      setSubject(task.subject)
      setDesc(task.description)
      setDueDate(task.dueDate)
      const url = task.materialUrl ?? ''
      setMaterialUrl(url)
      const isStorageUrl = url.includes('/storage/v1/object/public/task-files/')
      setUploadedFileName(isStorageUrl ? decodeURIComponent(url.split('/').pop().replace(/^\d+_[a-z0-9]+\./, '')) : '')
      const eds = task.extraDates || []
      setIsMultiDay(eds.length > 0)
      setExtraDates(eds)
    } else {
      setEditingTask(null)
      // Pré-seleciona 'evento' quando estiver na aba Eventos
      if (activeFilter === 'evento') setTaskType('evento')
    }
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingTask(null)
    setTaskType('prova')
    setSubject('')
    setDesc('')
    setDueDate('')
    setMaterialUrl('')
    setUploadedFileName('')
    setUploadingFile(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setIsMultiDay(false)
    setExtraDates([])
    setSubjectError('')
    setDescError('')
    setDateError('')
  }

  // ── CRUD ──────────────────────────────────────────────
  async function handleToggleDone(id) {
    const isDone = completions.has(id)
    if (isDone) {
      setCompletions(prev => { const s = new Set(prev); s.delete(id); return s })
      await supabase.from('completions').delete().eq('task_id', id).eq('user_id', user.id)
    } else {
      setCompletions(prev => new Set([...prev, id]))
      await supabase.from('completions').insert({ task_id: id, user_id: user.id })
    }
  }

  async function handleDeleteTask(id) {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    // Em subgrupo: criador ou dono do subgrupo pode deletar. Na sala: apenas admin/mod.
    const inSubgroup = !!task.subgroupId
    const isOwner = inSubgroup && (task.createdBy === user?.id || activeSubgroup?.role === 'owner')
    if (!inSubgroup && !profile?.is_admin && !profile?.is_moderator) return
    if (inSubgroup && !isOwner && !profile?.is_admin) return

    const tipo = task.type === 'prova' ? 'prova' : task.type === 'evento' ? 'evento' : 'atividade'
    if (!confirm(`Tem certeza que quer apagar essa ${tipo}?\n"${task.subject}"`)) return

    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timerId)
      pendingDeleteRef.current = null
    }

    setTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('tasks').delete().eq('id', id)
    logAudit(user.id, profile?.full_name, 'task_deleted', { subject: task.subject, type: task.type }, profile?.class_code)

    const timerId = setTimeout(() => {
      pendingDeleteRef.current = null
    }, 4000)

    pendingDeleteRef.current = { task, timerId }

    showSnackbar('Tarefa removida', {
      label: 'Desfazer',
      fn: handleUndoDelete,
    })
  }

  async function handleUndoDelete() {
    if (!pendingDeleteRef.current) return
    const { task, timerId } = pendingDeleteRef.current
    clearTimeout(timerId)
    pendingDeleteRef.current = null

    setTasks(prev =>
      [...prev, task].sort((a, b) => a.createdAt - b.createdAt)
    )
    await supabase.from('tasks').insert(toDb(task))
    setSnackbar(s => ({ ...s, visible: false }))
  }

  async function handleFileUpload(file) {
    if (!file) return
    setUploadingFile(true)
    setUploadedFileName('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sessão expirada')

      const fd = new FormData()
      fd.append('file', file)
      fd.append('classCode', profile?.class_code ?? 'geral')

      const res = await fetch('/api/upload-task-file', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro no upload')

      setMaterialUrl(json.url)
      setUploadedFileName(json.filename)
    } catch (err) {
      showSnackbar(err.message || 'Erro ao enviar arquivo. Tente novamente.')
    } finally {
      setUploadingFile(false)
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault()
    let valid = true

    if (subject.trim().length < 2) {
      setSubjectError('Digite o nome da matéria (mín. 2 caracteres).')
      valid = false
    }

    if (!dueDate) {
      setDateError('Selecione a data de entrega.')
      valid = false
    }
    if (!valid) return

    const name = subject.trim()
    const descTrimmed = desc.trim()
    persistSubject(name)

    const validExtraDates = isMultiDay && hasExtraDates
      ? [...new Set(extraDates.filter(d => d && d !== dueDate))].sort()
      : []

    if (editingTask) {
      const mat = materialUrl.trim() || null
      setTasks(prev => prev.map(t =>
        t.id === editingTask.id
          ? { ...t, type: taskType, subject: name, description: descTrimmed, dueDate, materialUrl: mat, extraDates: hasExtraDates ? validExtraDates : t.extraDates }
          : t
      ))

      const updateObj = { type: taskType, subject: name, description: descTrimmed, due_date: dueDate, material_url: mat }
      if (hasExtraDates) updateObj.extra_dates = validExtraDates.length > 0 ? validExtraDates : null
      const { error } = await supabase.from('tasks').update(updateObj).eq('id', editingTask.id)

      if (error) {
        console.error("🔴 ERRO AO EDITAR NO SUPABASE:", error.message)
        showSnackbar('Erro ao editar! Olhe o console (F12).')
        return
      }

      closeModal()
      setTimeout(() => showSnackbar(`"${name}" atualizada! ✓`), 400)
    } else {
      const classCode = profile?.class_code ?? 'INFO2026'
      const canCreate = profile?.is_admin || profile?.is_moderator || !!activeSubgroup

      if (canCreate) {
        const newTask = {
          id: generateId(),
          type: taskType,
          subject: name,
          description: descTrimmed,
          dueDate,
          materialUrl: materialUrl.trim() || null,
          done: false,
          createdAt: Date.now(),
          subgroupId: activeSubgroup?.id ?? null,
          extraDates: validExtraDates,
        }
        setTasks(prev => [...prev, newTask])
        const insertData = { ...toDb(newTask, user.id, hasExtraDates), class_code: classCode }
        if (activeSubgroup) insertData.subgroup_id = activeSubgroup.id
        const { error } = await supabase.from('tasks').insert(insertData)
        if (error) {
          console.error("🔴 ERRO AO SALVAR NO SUPABASE:", error.message)
          showSnackbar('Erro ao salvar! Olhe o console (F12).')
          return
        }
        logAudit(user.id, profile?.full_name, activeSubgroup ? 'subgroup_task_created' : 'task_created',
          { subject: name, type: taskType, subgroup: activeSubgroup?.name }, classCode)
        if (activeSubgroup) {
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'subgroup_task',
              subgroup_id: activeSubgroup.id,
              subgroup_name: activeSubgroup.name,
              subject: name,
              task_type: taskType,
              created_by_id: user.id,
              created_by_name: profile?.full_name,
            }),
          }).catch(() => {})
          fetch('/api/notify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subgroup_id: activeSubgroup.id,
              title: name,
              type: taskType,
              due_date: dueDate || null,
              description: descTrimmed || null,
            }),
          }).catch(() => {})
        } else {
          // Notifica todos os membros da sala quando uma tarefa é criada
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'room_task',
              class_code: classCode,
              subject: name,
              task_type: taskType,
              created_by_name: profile?.full_name,
            }),
          }).catch(() => {})
          fetch('/api/notify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              class_code: classCode,
              title: name,
              type: taskType,
              due_date: dueDate || null,
              description: descTrimmed || null,
            }),
          }).catch(() => {})
        }
        closeModal()
        setTimeout(() => showSnackbar(`"${name}" adicionada! ✓`), 400)
      } else {
        // Aluno comum → envia sugestão para o moderador aprovar
        const { error } = await supabase.from('task_suggestions').insert({
          class_code: classCode,
          suggested_by: user.id,
          suggested_by_name: profile?.full_name ?? user.user_metadata?.full_name ?? 'Aluno',
          type: taskType,
          subject: name,
          description: descTrimmed,
          due_date: dueDate || null,
        })
        if (error) {
          console.error("🔴 ERRO AO SOLICITAR:", error.message)
          showSnackbar('Erro ao solicitar! Olhe o console (F12).')
          return
        }
        logAudit(user.id, profile?.full_name, 'suggestion_sent', { subject: name, type: taskType }, classCode)
        closeModal()
        setTimeout(() => showSnackbar(`Solicitação de "${name}" enviada! ✓`), 400)
        // Notifica moderador/admin
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'suggestion', class_code: classCode, subject: name, suggested_by_name: profile?.full_name }),
        }).catch(() => {})
      }
    }
  }

  // ── Matérias salvas ───────────────────────────────────
  function persistSubject(name) {
    setSavedSubjects(prev => {
      if (prev.includes(name)) return prev
      const next = [...prev, name]
      try { localStorage.setItem(SUBJECTS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function handleSubjectChange(e) {
    const val = e.target.value
    setSubject(val)
    if (val.trim().length >= 2) setSubjectError('')
    const q = val.trim().toLowerCase()
    if (q.length > 0) {
      setSuggestions(
        savedSubjects.filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      )
    } else {
      setSuggestions([])
    }
  }

  function handleSuggestionPick(s) {
    setSubject(s)
    setSuggestions([])
    setSubjectError('')
  }

  async function handleSignOut() {
    manualSignOutRef.current = true
    if (banChannelRef.current) { supabase.removeChannel(banChannelRef.current); banChannelRef.current = null }
    await supabase.auth.signOut()
    setCompletions(new Set())
    setTasks([])
  }

  async function handleFeedbackSubmit(e) {
    e.preventDefault()
    const msg = feedbackText.trim()
    if (!msg) return
    setFeedbackSending(true)
    await supabase.from('feedback').insert({
      user_id: user?.id ?? null,
      nome: profile?.full_name ?? null,
      turma: profile?.class_code ?? null,
      message: msg,
    })
    setFeedbackSending(false)
    setFeedbackSent(true)
    setFeedbackText('')
    try { localStorage.setItem('feedback_nudge_dismissed', '1') } catch {}
    setFeedbackNudge(false)
    setTimeout(() => { setFeedbackOpen(false); setFeedbackSent(false) }, 2000)
  }

  // ── Subgrupos ─────────────────────────────────────────
  async function handleCreateSubgroup(e) {
    e.preventDefault()
    const name = sgName.trim()
    if (!name) return
    if (hasProfanity(name)) { setSgError('Nome inapropriado. Tente outro.'); return }
    if (!profile?.class_code) { setSgError('Você precisa estar em uma turma.'); return }
    setSgLoading(true); setSgError('')

    const { data, error } = await supabase
      .from('subgroups')
      .insert({ name, class_code: profile.class_code, created_by: user.id })
      .select()
      .single()

    if (error) { setSgError('Erro ao criar: ' + error.message); setSgLoading(false); return }
    if (!data?.id) { setSgError('Erro ao obter ID do subgrupo.'); setSgLoading(false); return }

    // Adiciona como owner
    await supabase.from('subgroup_members').insert({ subgroup_id: data.id, user_id: user.id, role: 'owner' })
    await logAudit(user.id, profile?.full_name, 'subgroup_created', { name, subgroup_id: data.id }, profile.class_code)

    await loadMySubgroups()
    setActiveSubgroup({ ...data, role: 'owner' })
    setViewMode('subgroup')
    setSgName(''); setSgError(''); setSgLoading(false)
  }

  async function handleJoinSubgroup(e) {
    e.preventDefault()
    const code = sgJoinCode.trim().toUpperCase()
    if (!code) return
    setSgLoading(true); setSgError('')

    const { data: sg, error } = await supabase
      .from('subgroups')
      .select('*')
      .eq('invite_code', code)
      .maybeSingle()

    if (error || !sg) { setSgError('Código inválido.'); setSgLoading(false); return }
    if (sg.class_code !== profile?.class_code) { setSgError('Este subgrupo é de outra sala.'); setSgLoading(false); return }

    const { error: joinErr } = await supabase
      .from('subgroup_members')
      .insert({ subgroup_id: sg.id, user_id: user.id, role: 'member' })

    if (joinErr && joinErr.code !== '23505') { setSgError('Erro ao entrar.'); setSgLoading(false); return }

    await loadMySubgroups()
    setActiveSubgroup({ ...sg, role: 'member' })
    setViewMode('subgroup')
    setSgJoinCode(''); setSgLoading(false)
  }

  async function handleLeaveSubgroup(sg) {
    if (!confirm(`Sair do subgrupo "${sg.name}"?`)) return
    await supabase.from('subgroup_members').delete().eq('subgroup_id', sg.id).eq('user_id', user.id)
    if (activeSubgroup?.id === sg.id) { setActiveSubgroup(null); setViewMode(null) }
    await loadMySubgroups()
  }

  async function handleDeleteSubgroup(sg) {
    if (!confirm(`Apagar o subgrupo "${sg.name}" permanentemente? Todas as tarefas do subgrupo serão removidas.`)) return
    await supabase.from('subgroups').delete().eq('id', sg.id)
    if (activeSubgroup?.id === sg.id) { setActiveSubgroup(null); setViewMode(null) }
    await loadMySubgroups()
  }

  async function copySubgroupInvite(code) {
    const link = `${window.location.origin}/?sgcode=${code}`
    try { await navigator.clipboard.writeText(link) } catch (_) {}
    showSnackbar('Link do subgrupo copiado! ✓')
  }

  // ── Push Notifications ────────────────────────────────

  // Sincroniza subscription do browser com o DB — força re-subscrição se VAPID mudou
  async function syncPushSubscription(userId) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (!existing) {
        // Permissão já concedida mas sem subscription (PWA instalado ou VAPID mudou) → re-subscreve
        if (Notification.permission === 'granted') {
          try {
            const newSub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
            })
            const { endpoint, keys } = newSub.toJSON()
            await supabase.from('push_subscriptions').upsert(
              { user_id: userId, endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
              { onConflict: 'user_id,endpoint' }
            )
            setPushEnabled(true)
          } catch (e) {
            console.warn('syncPush auto-subscribe:', e)
          }
        }
        return
      }

      // Verifica se está no DB
      const { data } = await supabase.from('push_subscriptions')
        .select('id').eq('user_id', userId).eq('endpoint', existing.endpoint).maybeSingle()

      if (data) {
        setPushEnabled(true)
        return
      }

      // Não está no DB → desinscreveu com key velha, re-inscreve com nova
      await existing.unsubscribe()
      const newSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
      const { endpoint, keys } = newSub.toJSON()
      await supabase.from('push_subscriptions').upsert(
        { user_id: userId, endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
        { onConflict: 'user_id,endpoint' }
      )
      setPushEnabled(true)
    } catch (e) {
      console.warn('syncPush:', e)
    }
  }

  async function handleEnablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      showSnackbar('Seu navegador não suporta notificações.')
      return
    }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      showSnackbar('Permissão de notificação negada.')
      return
    }
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
      const { endpoint, keys } = sub.toJSON()
      await supabase.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
      }, { onConflict: 'user_id,endpoint' })
      setPushEnabled(true)
      showSnackbar('Notificações ativadas! ✓')
    } catch {
      showSnackbar('Erro ao ativar notificações.')
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(base64)
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
  }

  // ── Admin: gerar código da turma / convite ────────────
  const [copiedCode, setCopiedCode]     = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [adminBarOpen, setAdminBarOpen] = useState(false)

  // Admin: visualizar outra sala via ?room=CODE
  const viewingRoomRef = useRef(null)
  const [viewingRoom, setViewingRoom]   = useState(null)

  async function handleGenerateCode() {
    if (!profile?.is_admin) return
    // Só gera se ainda não tem código definido pelo admin ou usuário confirma
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]

    const { error } = await supabase
      .from('profiles')
      .update({ class_code: code })
      .eq('id', user.id)

    if (error) {
      showSnackbar('Erro ao gerar código.')
      return
    }
    setProfile(prev => ({ ...prev, class_code: code }))
    showSnackbar(`Código gerado: ${code}`)
  }

  async function handleCopyCode() {
    if (!profile?.class_code) return
    try {
      await navigator.clipboard.writeText(profile.class_code)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      showSnackbar(profile.class_code)
    }
  }

  async function handleInvite() {
    if (!profile?.class_code) return
    const link = `${window.location.origin}/?join=${profile.class_code}`
    try {
      await navigator.clipboard.writeText(link)
      setInviteCopied(true)
      showSnackbar('Link copiado! Compartilhe somente com alunos da sua sala.')
      setTimeout(() => setInviteCopied(false), 3000)
    } catch {
      showSnackbar(link)
    }
  }

  async function loadMembers() {
    if (!profile?.class_code) return
    const { data } = await supabase.from('profiles')
      .select('full_name, ano_turma, curso')
      .eq('class_code', profile.class_code)
      .order('full_name')
    setMembers(data ?? [])
    setShowMembers('class')
  }

  async function loadSubgroupMembers() {
    if (!activeSubgroup?.id) return
    const { data: sm } = await supabase.from('subgroup_members')
      .select('role, user_id')
      .eq('subgroup_id', activeSubgroup.id)
    if (!sm?.length) { setMembers([]); setShowMembers('subgroup'); return }
    const ids = sm.map(r => r.user_id)
    const { data: profs } = await supabase.from('profiles')
      .select('id, full_name, ano_turma, curso')
      .in('id', ids)
    const roleMap = Object.fromEntries(sm.map(r => [r.user_id, r.role]))
    setMembers((profs ?? []).map(p => ({ ...p, role: roleMap[p.id] })))
    setShowMembers('subgroup')
  }

  async function openDoubts(task) {
    setDoubtsTask(task)
    const { data } = await supabase.from('doubts')
      .select('*, doubt_replies(*)')
      .eq('task_id', task.id)
      .order('created_at')
    setDoubts(data ?? [])
  }

  async function handleDeleteDoubt(doubtId, isOwn) {
    const msg = isOwn ? 'Tem certeza que quer apagar sua dúvida?' : 'Apagar essa dúvida por ser ofensiva?'
    if (!confirm(msg)) return
    await supabase.from('doubts').delete().eq('id', doubtId)
    setDoubts(prev => prev.filter(d => d.id !== doubtId))
  }

  async function handleSubmitDoubt() {
    if (!newDoubt.trim() || !doubtsTask) return
    const id = 'doubt_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    const row = {
      id, task_id: doubtsTask.id,
      class_code: profile.class_code,
      user_id: user.id,
      user_name: profile.full_name ?? 'Aluno',
      question: newDoubt.trim(),
    }
    await supabase.from('doubts').insert(row)
    setDoubts(prev => [...prev, { ...row, doubt_replies: [] }])
    setNewDoubt('')
  }

  async function handleSubmitReply(doubtId) {
    const text = replyTexts[doubtId]?.trim()
    if (!text) return
    const id = 'reply_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    const row = {
      id, doubt_id: doubtId,
      user_id: user.id,
      user_name: profile.full_name ?? 'Aluno',
      reply: text,
    }
    await supabase.from('doubt_replies').insert(row)
    setDoubts(prev => prev.map(d =>
      d.id === doubtId ? { ...d, doubt_replies: [...(d.doubt_replies ?? []), row] } : d
    ))
    setReplyTexts(prev => ({ ...prev, [doubtId]: '' }))
  }

  function handleLeaveRoomView() {
    viewingRoomRef.current = null
    setViewingRoom(null)
    // Remove ?room= da URL sem reload
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState({}, '', url)
    loadData(null)
  }

  // ── Snackbar ──────────────────────────────────────────
  function showSnackbar(message, action = null) {
    if (snackTimerRef.current) clearTimeout(snackTimerRef.current)
    setSnackbar({ message, action, visible: true })
    snackTimerRef.current = setTimeout(
      () => setSnackbar(s => ({ ...s, visible: false, action: null })),
      action ? 4000 : 2500
    )
  }

  // ── Filtro + ordenação ────────────────────────────────
  // Injeta done por aluno
  const tasksWithDone = tasks.map(t => ({ ...t, done: completions.has(t.id) }))

  // Eventos são sempre separados das tarefas
  const events      = tasksWithDone.filter(t => t.type === 'evento').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  const tasksOnly   = tasksWithDone.filter(t => t.type !== 'evento')

  const filtered = activeFilter === 'all' || activeFilter === 'evento'
    ? tasksOnly
    : tasksOnly.filter(t => t.type === activeFilter)

  const pending      = filtered.filter(t => !t.done).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  const done         = filtered.filter(t => t.done)
  const sorted       = [...pending, ...done]
  const pendingCount = tasksOnly.filter(t => !t.done).length  // eventos não contam como pendentes
  const descLen      = desc.length
  const counterClass = 'char-counter' + (descLen >= 220 ? ' over' : descLen >= 180 ? ' limit' : '')
  const isEditing    = Boolean(editingTask)

  // Monta lista com rótulos de seção
  const listItems = []
  let addedPending = false
  let addedDone    = false

  sorted.forEach((task, i) => {
    if (!task.done && !addedPending) {
      listItems.push(<p key="label-pending" className="section-label">Pendentes</p>)
      addedPending = true
    }
    if (task.done && !addedDone) {
      listItems.push(<p key="label-done" className="section-label">Concluídas</p>)
      addedDone = true
    }
    const urgency     = getUrgency(task)
    const dueDateText = formatDueDate(getNearestDate(task))
    const delay       = Math.min(i * 0.065, 0.30).toFixed(2)
    listItems.push(
      <TaskCard
        key={task.id}
        task={task}
        urgency={urgency}
        dueDateText={dueDateText}
        delay={delay}
        onToggle={() => handleToggleDone(task.id)}
        onEdit={() => openModal(task)}
        canDelete={!!(profile?.is_admin || profile?.is_moderator || (task.subgroupId && (task.createdBy === user?.id || activeSubgroup?.role === 'owner')))}
        onDelete={() => handleDeleteTask(task.id)}
        onDoubts={() => openDoubts(task)}
      />
    )
  })

  // ── Render ────────────────────────────────────────────
  if (isBanned) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f0f0f', padding:24 }}>
      <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:20, padding:'56px 48px', maxWidth:480, width:'100%', textAlign:'center' }}>
        <div style={{ fontSize:56, marginBottom:16, lineHeight:1 }}>🔨</div>
        <h2 style={{ fontSize:22, fontWeight:700, color:'#ef4444', margin:'0 0 10px' }}>Você foi banido</h2>
        <p style={{ fontSize:14, color:'rgba(255,255,255,0.5)', lineHeight:1.7, margin:'0 0 20px' }}>
          Sua conta foi removida por um moderador.<br/>Se acha que foi engano, fala com seu professor.
        </p>
        <button
          onClick={async () => { await supabase.auth.signOut(); setIsBanned(false) }}
          style={{ background:'#2a2a2a', border:'1px solid #3a3a3a', color:'#fff', borderRadius:10, padding:'10px 20px', cursor:'pointer', fontSize:13 }}
        >
          Voltar ao login
        </button>
      </div>
    </div>
  )

  if (user === undefined) return null  // verificando sessão
  if (user === null) return <AuthScreen onAuth={handleAuth} />

  // ── Seletor de contexto (Google Classroom style) ─────
  if (!viewMode && profile) {
    const classLabel = profile.ano_turma && profile.curso
      ? `${profile.ano_turma} · ${profile.curso}`
      : profile.class_code ?? 'Minha Sala'
    const campusLabel = campusShort(profile.campus)

    return (
      <div className="selector-screen">
        <header className="selector-header">
          <div className="selector-brand">
            <img src="/icons/anotaAIF.jpg" alt="Anota AIF!" className="logo-img" style={{ width:36, height:36, borderRadius:8 }}/>
            <span className="app-title" style={{ fontSize:18 }}>Anota AIF!</span>
          </div>
          <button className="user-bar-signout" style={{ color:'rgba(255,255,255,0.7)', border:'1px solid rgba(255,255,255,0.25)' }}
            onClick={handleSignOut}>
            <svg viewBox="0 0 20 20" fill="none" style={{ width:14, height:14 }}><path d="M13 3h4a1 1 0 011 1v12a1 1 0 01-1 1h-4M8 14l4-4-4-4M12 10H3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Sair
          </button>
        </header>

        <main className="selector-main">
          <p className="selector-greeting">Olá, {profile?.full_name?.split(' ')[0] ?? 'Aluno'}! Onde você quer entrar?</p>

          {roomRemovedNotice && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1.5px solid rgba(239,68,68,0.3)',
              borderRadius: 12, padding: '12px 14px', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>🏫</span>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--red)', lineHeight: 1.5, flex: 1 }}>
                <strong>Sua sala foi removida.</strong> Entre em contato com seu professor para entrar em uma nova turma.
              </p>
              <button
                onClick={() => setRoomRemovedNotice(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}
                aria-label="Fechar"
              >×</button>
            </div>
          )}

          <div className="selector-grid">
            {/* Card da sala */}
            {profile?.class_code && (
              <button className="selector-card selector-card--class" onClick={() => setViewMode('class')}>
                <div className="sc-accent"/>
                <div className="sc-body">
                  <p className="sc-label">Turma</p>
                  <p className="sc-title">{classLabel}</p>
                  <p className="sc-sub">{campusLabel}</p>
                </div>
                <div className="sc-arrow">→</div>
              </button>
            )}

            {/* Cards de subgrupos */}
            {mySubgroups.map(sg => (
              <div key={sg.id} style={{ position:'relative' }}>
                <button className="selector-card selector-card--subgroup"
                  onClick={() => { setActiveSubgroup(sg); setViewMode('subgroup') }}
                  style={{ width:'100%' }}>
                  <div className="sc-accent"/>
                  <div className="sc-body">
                    <p className="sc-label">Subgrupo {sg.role === 'owner' ? '👑' : ''}</p>
                    <p className="sc-title">{sg.name}</p>
                    <p className="sc-sub">Código: {sg.invite_code}</p>
                  </div>
                  <div className="sc-arrow">→</div>
                </button>
                {(sg.role === 'owner' || profile?.is_admin) && (
                  <div style={{ position:'absolute', top:8, right:8 }}>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSubgroup(sg) }}
                      title="Apagar subgrupo"
                      style={{ background:'rgba(239,68,68,0.1)', border:'none', borderRadius:6,
                        color:'var(--red)', cursor:'pointer', fontSize:12, padding:'4px 8px', fontWeight:700 }}
                    >
                      🗑
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Criar / Entrar em subgrupo */}
          {profile?.class_code && (
            <div className="selector-sg-section">
              <p className="selector-sg-title">Subgrupos</p>
              <div className="selector-sg-tabs">
                {[{id:'create',label:'Criar'},{id:'join',label:'Entrar com código'}].map(t => (
                  <button key={t.id} onClick={() => setSgTab(t.id)}
                    className={`selector-sg-tab${sgTab===t.id?' active':''}`}>{t.label}</button>
                ))}
              </div>

              {sgError && <p style={{ color:'var(--red)', fontSize:13, margin:'8px 0 0' }}>{sgError}</p>}

              {sgTab === 'create' && (
                <>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.4 }}>
                    🔒 Este grupo só será visível para você e quem você convidar
                  </p>
                  <form onSubmit={handleCreateSubgroup} style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                    <input className="form-input" type="text" maxLength={40}
                      placeholder="Nome do grupo (ex: Grupo de Física)"
                      value={sgName} onChange={e => setSgName(e.target.value)} required
                      style={{ flex:1, minWidth:200 }}/>
                    <button type="submit" className="btn-submit" disabled={!sgName.trim()||sgLoading} style={{ flexShrink:0 }}>
                      {sgLoading ? 'Criando…' : 'Criar'}
                    </button>
                  </form>
                </>
              )}

              {sgTab === 'join' && (
                <form onSubmit={handleJoinSubgroup} style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                  <input className="form-input" type="text" maxLength={8}
                    placeholder="Código do subgrupo" value={sgJoinCode}
                    onChange={e => setSgJoinCode(e.target.value.toUpperCase())} required
                    style={{ flex:1, minWidth:160, textTransform:'uppercase', letterSpacing:2, fontWeight:700 }}/>
                  <button type="submit" className="btn-submit" disabled={!sgJoinCode.trim()||sgLoading} style={{ flexShrink:0 }}>
                    {sgLoading ? 'Entrando…' : 'Entrar'}
                  </button>
                </form>
              )}
            </div>
          )}
        </main>

        {showUpdatePopup && (
          <div style={{
            position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1300, width: 'min(340px, calc(100vw - 32px))',
            background: 'var(--surface)',
            border: '2px solid var(--green-border, #86efac)',
            borderRadius: 18,
            boxShadow: '0 8px 36px rgba(0,132,61,0.18), 0 2px 8px rgba(0,132,61,0.10)',
            padding: '18px 16px 18px 18px',
            display: 'flex', alignItems: 'flex-start', gap: 14,
            animation: 'nudgePop .35s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: 'rgba(0,132,61,0.10)', border: '1.5px solid rgba(0,132,61,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>🗓️</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: 'var(--green-primary)', letterSpacing: '-0.1px' }}>
                Novidade: Múltiplos dias!
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.55 }}>
                Agora você pode marcar tarefas com várias datas — ideal para apresentações em dias diferentes. O app sempre mostra o próximo dia mais próximo!
              </p>
            </div>
            <button
              aria-label="Fechar"
              onClick={() => {
                try { localStorage.setItem('update_280426_v1', '1') } catch {}
                setShowUpdatePopup(false)
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 0, flexShrink: 0, marginTop: 1 }}
            >×</button>
          </div>
        )}
      </div>
    )
  }

  if (!viewMode) return null // perfil ainda carregando

  return (
    <>
      {/* Header / Sidebar */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="logo-mark">
              <img src="/icons/anotaAIF.jpg" alt="Anota AIF!" className="logo-img" />
            </div>
            <div>
              <h1 className="app-title">
                {viewMode === 'subgroup' ? activeSubgroup?.name : 'Anota AIF!'}
              </h1>
              <p className="app-subtitle">
                {viewMode === 'subgroup'
                  ? `Subgrupo · ${profile?.ano_turma ?? ''} ${profile?.curso ?? ''}`
                  : profile
                    ? `${profile.ano_turma ?? ''} · ${profile.curso ?? ''} · ${campusShort(profile.campus)}`
                    : 'IFSP'}
              </p>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                <button className="btn-turma" onClick={() => { setViewMode(null); setTasks([]); setActiveSubgroup(null) }} title="Voltar à tela inicial">
                  ← Início
                </button>
                {profile?.class_code && viewMode === 'class' && (
                  <button className="btn-turma" onClick={loadMembers} title="Ver colegas">
                    👥 Turma
                  </button>
                )}
                {viewMode === 'subgroup' && (
                  <>
                    <button className="btn-turma" onClick={loadSubgroupMembers} title="Ver participantes do subgrupo">
                      👥 Grupo
                    </button>
                    {(activeSubgroup?.role === 'owner' || profile?.is_admin) && (
                      <button
                        className="btn-turma"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(activeSubgroup.invite_code)
                            showSnackbar(`Código copiado: ${activeSubgroup.invite_code}`)
                          } catch { showSnackbar(activeSubgroup.invite_code) }
                        }}
                        title="Copiar código do subgrupo"
                      >
                        🔑 {activeSubgroup.invite_code}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="header-actions">
            {showInstallButton && (
              <button
                className="btn-install"
                onClick={handleInstallClick}
                aria-label="Instalar App"
                title="Instalar App"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 3v10M6 9l4 4 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span>Instalar</span>
              </button>
            )}

            {!pushEnabled && 'Notification' in (typeof window !== 'undefined' ? window : {}) && (
              <button
                className="btn-calendar"
                onClick={handleEnablePush}
                title="Ativar notificações de prazo"
                aria-label="Ativar notificações"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z" stroke="white" strokeWidth="1.5"/>
                  <path d="M8 15.5a2 2 0 004 0" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <span>Notificações</span>
              </button>
            )}

            <button
              className="btn-calendar"
              onClick={() => router.push('/calendario')}
              title="Abrir Calendário"
              aria-label="Abrir Calendário"
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="white" strokeWidth="1.5"/>
                <path d="M6 2v2.5M14 2v2.5M2 8h16" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="7" cy="13" r="1" fill="white"/>
                <circle cx="10" cy="13" r="1" fill="white"/>
                <circle cx="13" cy="13" r="1" fill="white"/>
              </svg>
              <span>Calendário</span>
            </button>

            <div className="stat-badge" title="Tarefas pendentes">
              <span className="stat-number">{pendingCount}</span>
              <span className="stat-label">pendentes</span>
            </div>
          </div>
        </div>

        <nav className="tabs" role="tablist" aria-label="Filtrar tarefas">
          {[
            { id: 'all',       label: 'Todas'      },
            { id: 'prova',     label: 'Provas'     },
            { id: 'atividade', label: 'Atividades' },
            { id: 'evento',    label: 'Eventos'    },
          ].map(({ id, label }) => (
            <button
              key={id}
              className={`tab${activeFilter === id ? ' active' : ''}${id === 'evento' ? ' tab-evento' : ''}`}
              role="tab"
              aria-selected={activeFilter === id}
              onClick={() => setActiveFilter(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Admin/Mod: toggle compacto no mobile */}
        {(profile?.is_admin || profile?.is_moderator) && (
          <button className="btn-admin-toggle" onClick={() => setAdminBarOpen(o => !o)}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span>{profile.is_admin ? 'Admin' : 'Mod'}</span>
            <svg className={`toggle-chevron${adminBarOpen ? ' open' : ''}`} viewBox="0 0 20 20" fill="none">
              <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}

        {/* Painel admin/mod — mobile: colapsa; desktop: sempre visível */}
        {(profile?.is_admin || profile?.is_moderator) && (
          <div className={`admin-bar-panel${adminBarOpen ? ' open' : ''}`}>
            {profile.is_admin && (
              <button className="btn-admin-panel" onClick={() => router.push('/admin')}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Painel de Alunos
              </button>
            )}
            {profile.is_moderator && !profile.is_admin && (
              <button className="btn-admin-panel" onClick={() => router.push('/moderador')}>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Painel da Sala
              </button>
            )}
            <div className="admin-code-panel">
              <span className="admin-code-label">Código da Turma</span>
              <div className="admin-code-row">
                <span className="admin-code-value">{profile.class_code ?? '—'}</span>
                <button className="admin-code-btn" onClick={handleCopyCode} title="Copiar código">
                  {copiedCode ? '✓' : (
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  )}
                </button>
                {!profile.class_code && (
                  <button className="admin-code-btn admin-code-gen" onClick={handleGenerateCode}>Gerar</button>
                )}
              </div>
              {profile.class_code && profile.is_admin && (
                <button className="admin-regen-btn" onClick={() => {
                  if (confirm('Gerar um novo código? O código anterior deixará de funcionar.')) handleGenerateCode()
                }}>Gerar novo código</button>
              )}
            </div>
          </div>
        )}

        {/* Usuário logado + sair */}
        <div className="user-bar">
          <button
            className="user-bar-name"
            style={{ background:'none', border:'none', cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:5 }}
            onClick={() => router.push('/perfil')}
            title="Ver perfil"
          >
            {profile?.full_name ?? user.user_metadata?.full_name ?? 'Aluno'}
            <span style={{ fontSize:10, opacity:0.5 }}>✏️</span>
          </button>
          {profile?.class_code && (
            <button
              className="user-bar-signout"
              onClick={handleInvite}
              title="Convidar para a sala"
              style={{ background: inviteCopied ? '#00843D' : undefined }}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M13 10l4-4-4-4M17 6H7a4 4 0 000 8h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {inviteCopied ? 'Copiado!' : 'Convidar'}
            </button>
          )}
          <button className="user-bar-signout" onClick={() => setFeedbackOpen(true)} title="Dar feedback">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3V5z"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Feedback
          </button>
          <button className="user-bar-signout" onClick={handleSignOut} title="Sair">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M13 3h4a1 1 0 011 1v12a1 1 0 01-1 1h-4M8 14l4-4-4-4M12 10H3"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sair
          </button>
        </div>
      </header>

      {/* Banner: subgrupo ativo */}
      {activeSubgroup && !viewingRoom && (
        <div className="notif-banner" style={{ background: '#6366f1' }}>
          <div className="notif-banner-icon">🔵</div>
          <div className="notif-banner-text">
            <strong>{activeSubgroup.name}</strong>
            <span>Você está vendo as tarefas do subgrupo · código: {activeSubgroup.invite_code}</span>
          </div>
          <button className="notif-banner-btn" onClick={() => { setActiveSubgroup(null); setViewMode(null); setTasks([]) }}>Sair</button>
        </div>
      )}

      {/* Banner: admin visualizando outra sala */}
      {viewingRoom && (
        <div className="notif-banner" style={{ background: '#1a56db' }}>
          <div className="notif-banner-icon">👁</div>
          <div className="notif-banner-text">
            <strong>Modo visualização</strong>
            <span>Sala {viewingRoom} — você está vendo as tarefas dessa sala</span>
          </div>
          <button className="notif-banner-btn" onClick={handleLeaveRoomView}>Voltar à minha sala</button>
        </div>
      )}

      {/* Banner: ativar notificações */}
      {!pushEnabled && !viewingRoom && typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'denied' && (
        <div className="notif-banner">
          <div className="notif-banner-icon">🔔</div>
          <div className="notif-banner-text">
            <strong>Ative as notificações</strong>
            <span>Receba aviso 1 dia antes das provas e atividades</span>
          </div>
          <button className="notif-banner-btn" onClick={handleEnablePush}>Ativar</button>
        </div>
      )}

      {/* Main */}
      <main className="main" role="main">

        {/* ── Seção de Eventos (sempre separada das tarefas) ── */}
        {events.length > 0 && (
          <div className="events-section">
            <div className="events-section-header">
              <span className="events-section-icon" aria-hidden="true">
                <svg viewBox="0 0 18 18" fill="none" width="16" height="16">
                  <rect x="1" y="2" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M5 1v2.5M13 1v2.5M1 7h16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="6" cy="12" r="1.2" fill="currentColor"/>
                  <circle cx="9" cy="12" r="1.2" fill="currentColor"/>
                  <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
                </svg>
              </span>
              <span className="events-section-title">Eventos</span>
              <span className="events-count-badge">{events.length}</span>
            </div>
            <div className="events-list">
              {events.map((ev, i) => (
                <EventCard
                  key={ev.id}
                  task={ev}
                  delay={Math.min(i * 0.06, 0.25).toFixed(2)}
                  onEdit={() => openModal(ev)}
                  canDelete={!!(profile?.is_admin || profile?.is_moderator)}
                  onDelete={() => handleDeleteTask(ev.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Aba Eventos (sem tarefas): estado vazio ── */}
        {activeFilter === 'evento' && events.length === 0 && (
          <div className="empty-state" role="status">
            <div className="empty-icon" aria-hidden="true">
              <svg viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="44" fill="#FDF4FF"/>
                <circle cx="50" cy="50" r="32" fill="#F5D0FE"/>
                <rect x="27" y="28" width="46" height="42" rx="6" stroke="#D946EF" strokeWidth="3"/>
                <path d="M27 40h46M37 24v8M63 24v8" stroke="#D946EF" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className="empty-title">Sem eventos</h2>
            <p className="empty-message">
              Nenhum evento programado.<br/>Olimpíadas, feiras e eventos do campus vão aparecer aqui!
            </p>
          </div>
        )}

        {/* ── Lista de tarefas (oculta na aba Eventos) ── */}
        {activeFilter !== 'evento' && (
          sorted.length === 0 ? (
            <div className="empty-state" role="status">
              <div className="empty-icon" aria-hidden="true">
                <svg viewBox="0 0 100 100" fill="none">
                  <circle cx="50" cy="50" r="44" fill="#E8F5E9"/>
                  <circle cx="50" cy="50" r="32" fill="#C8E6C9"/>
                  <path d="M35 50l10 10 20-20" stroke="#00843D" strokeWidth="3.5"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="empty-title">Tudo em dia!</h2>
              <p className="empty-message">
                Nenhuma pendência por aqui.<br/>Aproveite o momento livre! ✨
              </p>
            </div>
          ) : (
            <div className="tasks-list" role="list" aria-live="polite" aria-label="Lista de tarefas">
              {listItems}
            </div>
          )
        )}
      </main>

      {/* FAB */}
      <button
        className={`fab${isModalOpen ? ' open' : ''}`}
        aria-label={(profile?.is_admin || profile?.is_moderator || activeSubgroup) ? 'Adicionar nova tarefa' : 'Solicitar tarefa ao moderador'}
        onClick={isModalOpen ? closeModal : () => openModal()}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Modal */}
      <div
        className={`modal-overlay${isModalOpen ? ' open' : ''}`}
        role="presentation"
        onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
      >
        <div className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-handle" aria-hidden="true"/>

          <div className="modal-header">
            <h2 className="modal-title" id="modal-title">
              {isEditing
                ? (editingTask?.type === 'evento' ? 'Editar Evento' : 'Editar Tarefa')
                : taskType === 'evento'
                  ? 'Novo Evento'
                  : (profile?.is_admin || profile?.is_moderator || activeSubgroup)
                    ? (activeSubgroup ? `Nova — ${activeSubgroup.name}` : 'Nova Tarefa')
                    : 'Solicitar Tarefa'}
            </h2>
            <button className="modal-close" aria-label="Fechar modal" onClick={closeModal}>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <form className="task-form" noValidate autoComplete="off" onSubmit={handleFormSubmit}>
            {/* Tipo */}
            <div className="form-group">
              <span className="form-label" id="type-label">Tipo</span>
              <div className="type-selector" role="group" aria-labelledby="type-label">
                {[
                  {
                    id: 'prova', label: 'Prova',
                    icon: (
                      <svg viewBox="0 0 20 20" fill="none">
                        <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    ),
                  },
                  {
                    id: 'atividade', label: 'Atividade',
                    icon: (
                      <svg viewBox="0 0 20 20" fill="none">
                        <rect x="3" y="2" width="14" height="16" rx="2"
                              stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M7 7h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <path d="M7 15l1.5 1.5L11 13" stroke="currentColor" strokeWidth="1.5"
                              strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ),
                  },
                  {
                    id: 'evento', label: 'Evento',
                    icon: (
                      <svg viewBox="0 0 20 20" fill="none">
                        <rect x="2" y="3" width="16" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M6 2v2.5M14 2v2.5M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <circle cx="7" cy="13" r="1.3" fill="currentColor"/>
                        <circle cx="10" cy="13" r="1.3" fill="currentColor"/>
                        <circle cx="13" cy="13" r="1.3" fill="currentColor"/>
                      </svg>
                    ),
                  },
                ].map(({ id, label, icon }) => (
                  <label
                    key={id}
                    className={`type-option${taskType === id ? ` selected-${id}` : ''}`}
                    onClick={() => setTaskType(id)}
                  >
                    <span className="type-icon" aria-hidden="true">{icon}</span>
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Matéria / Nome do Evento */}
            <div className="form-group">
              <label className="form-label" htmlFor="subject-input">
                {taskType === 'evento' ? 'Nome do Evento' : 'Matéria'} <span className="required" aria-hidden="true">*</span>
              </label>
              <div className="subject-wrap">
                <input
                  ref={subjectRef}
                  type="text"
                  id="subject-input"
                  className={`form-input${subjectError ? ' error' : ''}`}
                  placeholder={taskType === 'evento' ? 'Ex: Olimpíadas de Química, Semana do IF…' : 'Ex: Matemática, Redes…'}
                  maxLength={60}
                  value={subject}
                  onChange={handleSubjectChange}
                  onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                  aria-required="true"
                  aria-describedby="subject-error"
                  autoComplete="off"
                />
                {suggestions.length > 0 && (
                  <ul className="subject-suggestions" role="listbox" aria-label="Matérias sugeridas">
                    {suggestions.map(s => (
                      <li
                        key={s}
                        role="option"
                        onMouseDown={() => handleSuggestionPick(s)}
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <span className="form-error" id="subject-error" role="alert" aria-live="polite">
                {subjectError}
              </span>
            </div>

            {/* Descrição / Detalhes do Evento */}
            <div className="form-group">
              <label className="form-label" htmlFor="desc-input">
                {taskType === 'evento' ? 'Detalhes' : 'Descrição'} <span className="required" aria-hidden="true">*</span>
              </label>
              <textarea
                id="desc-input"
                className={`form-textarea${descError ? ' error' : ''}`}
                rows={3}
                placeholder={taskType === 'evento' ? 'Horário, local, como participar…' : 'O que precisa ser feito? Capítulos, páginas, detalhes…'}
                maxLength={220}
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value)
                  if (e.target.value.trim().length >= 5) setDescError('')
                }}
                aria-required="true"
                aria-describedby="desc-error desc-counter"
              />
              <div className="textarea-footer">
                <span className="form-error" id="desc-error" role="alert" aria-live="polite">
                  {descError}
                </span>
                <span className={counterClass} id="desc-counter" aria-live="polite">
                  {descLen}/220
                </span>
              </div>
            </div>

            {/* Data */}
            <div className="form-group">
              <label className="form-label" htmlFor="date-input">
                {taskType === 'evento' ? 'Data do Evento' : 'Data de Entrega'} <span className="required" aria-hidden="true">*</span>
              </label>
              <input
                type="date"
                id="date-input"
                className={`form-input form-input--date${dateError ? ' error' : ''}`}
                min={isEditing ? undefined : getTodayString()}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value)
                  if (e.target.value) setDateError('')
                }}
                aria-required="true"
                aria-describedby="date-error"
              />
              <span className="form-error" id="date-error" role="alert" aria-live="polite">
                {dateError}
              </span>
            </div>

            {/* Múltiplos dias */}
            {taskType !== 'evento' && hasExtraDates && (
              <div className="form-group multiday-group">
                <label className="multiday-toggle" onClick={() => { setIsMultiDay(v => !v); if (isMultiDay) setExtraDates([]) }}>
                  <span className={`multiday-toggle-track${isMultiDay ? ' on' : ''}`}>
                    <span className="multiday-toggle-thumb" />
                  </span>
                  <span className="multiday-toggle-label">
                    📅 Múltiplos dias
                    <span className="multiday-toggle-hint">Ex: apresentações em datas diferentes</span>
                  </span>
                </label>
                {isMultiDay && (
                  <div className="multiday-dates-list">
                    <div className="multiday-dates-title">Datas adicionais:</div>
                    {extraDates.map((d, i) => (
                      <div key={i} className="multiday-date-row">
                        <input
                          type="date"
                          className="form-input form-input--date multiday-date-input"
                          value={d}
                          min={getTodayString()}
                          onChange={e => {
                            const nd = [...extraDates]
                            nd[i] = e.target.value
                            setExtraDates(nd)
                          }}
                        />
                        <button
                          type="button"
                          className="multiday-date-remove"
                          onClick={() => setExtraDates(extraDates.filter((_, j) => j !== i))}
                          aria-label="Remover data"
                        >×</button>
                      </div>
                    ))}
                    {extraDates.length < 5 && (
                      <button
                        type="button"
                        className="multiday-add-btn"
                        onClick={() => setExtraDates([...extraDates, ''])}
                      >
                        + Adicionar data
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Material (opcional) */}
            <div className="form-group">
              <label className="form-label" htmlFor="material-input">
                {taskType === 'evento' ? 'Link ou arquivo do evento' : 'Link ou arquivo de material'} <span style={{ opacity: 0.5, fontWeight: 400 }}>(opcional)</span>
              </label>
              <input
                id="material-input"
                type="url"
                className="form-input"
                placeholder={taskType === 'evento' ? 'Ex: instagram.com/… ou formulário de inscrição' : 'Ex: drive.google.com/… ou classroom.google.com/…'}
                value={uploadedFileName ? '' : materialUrl}
                disabled={!!uploadedFileName || uploadingFile}
                onChange={e => { setMaterialUrl(e.target.value); setUploadedFileName('') }}
              />
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.gif,.webp"
                onChange={e => handleFileUpload(e.target.files?.[0])}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn-upload-file"
                  disabled={uploadingFile}
                  onClick={() => { if (!uploadingFile) fileInputRef.current?.click() }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 8, border: '1.5px dashed #aaa',
                    background: 'transparent', cursor: uploadingFile ? 'not-allowed' : 'pointer',
                    fontSize: 13, color: '#555', fontWeight: 500,
                  }}
                >
                  {uploadingFile ? (
                    <>⏳ Enviando…</>
                  ) : (
                    <>📁 Enviar arquivo</>
                  )}
                </button>
                {uploadedFileName && (
                  <span style={{ fontSize: 13, color: '#22a355', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                    ✓ {uploadedFileName}
                    <button
                      type="button"
                      onClick={() => { setMaterialUrl(''); setUploadedFileName(''); if (fileInputRef.current) fileInputRef.current.value = '' }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53', fontSize: 15, padding: '0 2px', lineHeight: 1 }}
                      title="Remover arquivo"
                    >×</button>
                  </span>
                )}
              </div>
            </div>

            {/* Ações */}
            <div className="form-actions">
              <button type="button" className="btn-cancel" onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" className="btn-save">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 3v14M3 10h14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {isEditing
                  ? 'Salvar Alterações'
                  : taskType === 'prova' ? 'Enviar Prova'
                  : taskType === 'evento' ? 'Criar Evento'
                  : 'Enviar Tarefa'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Snackbar */}
      <div className={`snackbar${snackbar.visible ? ' show' : ''}`} role="alert">
        <span>{snackbar.message}</span>
        {snackbar.action && (
          <button className="snackbar-action" onClick={snackbar.action.fn}>
            {snackbar.action.label}
          </button>
        )}
      </div>

      {/* Modal iOS — instruções para instalar */}
      {showIosInstallModal && (
        <div
          className="ios-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Instalar AnotaAIF no iPhone"
          onClick={(e) => { if (e.target === e.currentTarget) setShowIosInstallModal(false) }}
        >
          <div className="ios-modal">
            <button className="ios-modal-close" onClick={() => setShowIosInstallModal(false)} aria-label="Fechar">
              <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            <div className="ios-modal-icon" aria-hidden="true">📲</div>
            <h2 className="ios-modal-title">Instalar no iPhone</h2>
            <p className="ios-modal-sub">Adicione à Tela de Início para usar como app, sem navegador.</p>
            <ol className="ios-modal-steps">
              <li>
                <span className="ios-step-num">1</span>
                <span>Toque no botão <strong>Compartilhar</strong>
                  <svg className="ios-share-icon" viewBox="0 0 24 24" fill="none">
                    <path d="M8.59 5.41L12 2l3.41 3.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  na barra do Safari (parte de baixo da tela).
                </span>
              </li>
              <li>
                <span className="ios-step-num">2</span>
                <span>Role o menu e toque em <strong>&ldquo;Adicionar à Tela de Início&rdquo;</strong>.</span>
              </li>
              <li>
                <span className="ios-step-num">3</span>
                <span>Toque em <strong>Adicionar</strong> no canto superior direito.</span>
              </li>
            </ol>
            <p className="ios-modal-note">⚠️ Funciona apenas no Safari. Chrome/Firefox no iOS não suportam.</p>
          </div>
        </div>
      )}

      {/* Modal: colegas / participantes */}
      {showMembers && (
        <div className="modal-overlay open" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setShowMembers(null) }}>
          <div className="modal-sheet">
            <div className="modal-handle" aria-hidden="true"/>
            <div className="modal-header">
              <h2 className="modal-title">
                {showMembers === 'subgroup' ? `👥 ${activeSubgroup?.name}` : '👥 Colegas da turma'}
              </h2>
              <button className="modal-close" onClick={() => setShowMembers(null)} aria-label="Fechar">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <ul style={{ listStyle:'none', padding:'0 20px 24px', display:'flex', flexDirection:'column', gap:8 }}>
              {members.map((m, i) => (
                <li key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'1px solid #f0f0f0' }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'#E8F5E9', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#00843D', fontSize:15, flexShrink:0 }}>
                    {m.full_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div>
                    <p style={{ fontSize:14, fontWeight:600, margin:0 }}>
                      {m.full_name}
                      {showMembers === 'subgroup' && m.role === 'owner' && (
                        <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:'#00843D', background:'#E8F5E9', borderRadius:4, padding:'1px 5px' }}>dono</span>
                      )}
                    </p>
                    <p style={{ fontSize:12, opacity:0.6, margin:0 }}>{m.ano_turma} · {m.curso}</p>
                  </div>
                </li>
              ))}
              {members.length === 0 && <li style={{ fontSize:13, opacity:0.5, padding:'12px 0' }}>Nenhum participante encontrado.</li>}
            </ul>
          </div>
        </div>
      )}

      {/* Modal: dúvidas de uma tarefa */}
      {doubtsTask && (
        <div className="modal-overlay open" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setDoubtsTask(null) }}>
          <div className="modal-sheet" style={{ maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
            <div className="modal-handle" aria-hidden="true"/>
            <div className="modal-header">
              <h2 className="modal-title">💬 {doubtsTask.subject}</h2>
              <button className="modal-close" onClick={() => setDoubtsTask(null)} aria-label="Fechar">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div style={{ overflowY:'auto', flex:1, padding:'0 20px 24px' }}>
              {/* Enviar dúvida */}
              <div style={{ display:'flex', gap:8, marginBottom:16 }}>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="Qual é sua dúvida?"
                  value={newDoubt}
                  onChange={e => setNewDoubt(e.target.value)}
                  style={{ flex:1, fontSize:13 }}
                />
                <button
                  className="btn-submit"
                  style={{ alignSelf:'flex-end', padding:'8px 14px', fontSize:13 }}
                  onClick={handleSubmitDoubt}
                  disabled={!newDoubt.trim()}
                >
                  Enviar
                </button>
              </div>

              {/* Lista de dúvidas */}
              {doubts.length === 0 && <p style={{ fontSize:13, opacity:0.5, textAlign:'center', padding:'12px 0' }}>Nenhuma dúvida ainda. Seja o primeiro!</p>}
              {doubts.map(d => (
                <div key={d.id} style={{ marginBottom:14, background:'#f8f9f8', borderRadius:12, padding:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:4 }}>
                    <p style={{ margin:0, fontSize:13 }}><strong>{d.user_name}</strong>: {d.question}</p>
                    {(d.user_id === user.id || profile?.is_admin || profile?.is_moderator) && (
                      <button onClick={() => handleDeleteDoubt(d.id, d.user_id === user.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ccc', fontSize:16, padding:0, flexShrink:0 }} title="Apagar dúvida">✕</button>
                    )}
                  </div>
                  <p style={{ margin:'0 0 8px', fontSize:11, opacity:0.5 }}>{new Date(d.created_at).toLocaleDateString('pt-BR')}</p>
                  {(d.doubt_replies ?? []).map(r => (
                    <div key={r.id} style={{ marginLeft:12, padding:'6px 10px', background:'#fff', borderRadius:8, marginBottom:4, fontSize:12 }}>
                      <strong>{r.user_name}</strong>: {r.reply}
                    </div>
                  ))}
                  <div style={{ display:'flex', gap:6, marginTop:8 }}>
                    <input
                      className="form-input"
                      style={{ flex:1, fontSize:12, padding:'6px 10px' }}
                      placeholder="Responder…"
                      value={replyTexts[d.id] ?? ''}
                      onChange={e => setReplyTexts(prev => ({ ...prev, [d.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleSubmitReply(d.id) }}
                    />
                    <button
                      className="btn-submit"
                      style={{ padding:'6px 12px', fontSize:12 }}
                      onClick={() => handleSubmitReply(d.id)}
                      disabled={!replyTexts[d.id]?.trim()}
                    >
                      ↩
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Popup de atualização 28/04/2026 */}
      {showUpdatePopup && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1300, width: 'min(340px, calc(100vw - 32px))',
          background: 'var(--surface)',
          border: '2px solid var(--green-border, #86efac)',
          borderRadius: 18,
          boxShadow: '0 8px 36px rgba(0,132,61,0.18), 0 2px 8px rgba(0,132,61,0.10)',
          padding: '18px 16px 18px 18px',
          display: 'flex', alignItems: 'flex-start', gap: 14,
          animation: 'nudgePop .35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: 'rgba(0,132,61,0.10)', border: '1.5px solid rgba(0,132,61,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>
            🗓️
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: 'var(--green-primary)', letterSpacing: '-0.1px' }}>
              Novidade: Múltiplos dias!
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.55 }}>
              Agora você pode marcar tarefas com várias datas — ideal para apresentações em dias diferentes. O app sempre mostra o próximo dia mais próximo!
            </p>
          </div>
          <button
            aria-label="Fechar"
            onClick={() => {
              try { localStorage.setItem('update_280426_v1', '1') } catch {}
              setShowUpdatePopup(false)
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 22, lineHeight: 1,
              padding: 0, flexShrink: 0, marginTop: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Popup de novidade: Eventos */}
      {showEventsPopup && (
        <div style={{
          position: 'fixed', bottom: 90, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1300, width: 'min(340px, calc(100vw - 32px))',
          background: 'var(--surface)',
          border: '2px solid var(--magenta-border)',
          borderRadius: 18,
          boxShadow: '0 8px 36px rgba(217,70,239,0.22), 0 2px 8px rgba(217,70,239,0.10)',
          padding: '18px 16px 18px 18px',
          display: 'flex', alignItems: 'flex-start', gap: 14,
          animation: 'nudgePop .35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          {/* Ícone */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: 'var(--magenta-pale)', border: '1.5px solid var(--magenta-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 22 22" fill="none" width="22" height="22">
              <rect x="1" y="2.5" width="20" height="18" rx="3.5" stroke="var(--magenta)" strokeWidth="1.6"/>
              <path d="M6 1.5v3M16 1.5v3M1 8.5h20" stroke="var(--magenta)" strokeWidth="1.6" strokeLinecap="round"/>
              <circle cx="8" cy="14" r="1.5" fill="var(--magenta)"/>
              <circle cx="11" cy="14" r="1.5" fill="var(--magenta)"/>
              <circle cx="14" cy="14" r="1.5" fill="var(--magenta)"/>
            </svg>
          </div>

          {/* Texto */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: 'var(--magenta-mid)', letterSpacing: '-0.1px' }}>
              Novidade: Seção de Eventos! 🎉
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.55 }}>
              Olimpíadas, feiras e eventos do campus agora ficam numa seção separada — em magenta, sem misturar com as atividades. Clique em <strong style={{ color: 'var(--magenta-mid)' }}>Eventos</strong> no menu!
            </p>
          </div>

          {/* X */}
          <button
            aria-label="Fechar"
            onClick={() => {
              try { localStorage.setItem('events_popup_v1', '1') } catch {}
              setShowEventsPopup(false)
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 22, lineHeight: 1,
              padding: 0, flexShrink: 0, marginTop: 1,
              transition: 'color 0.15s',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Nudge: aviso sobre a aba de feedback */}
      {feedbackNudge && !feedbackOpen && (
        <div style={{
          position: 'fixed', bottom: 80, right: 16, zIndex: 1200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          padding: '14px 16px 14px 18px', maxWidth: 280,
          display: 'flex', alignItems: 'flex-start', gap: 10,
          animation: 'nudgePop .3s ease',
        }}>
          <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>💬</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, fontSize: 13, margin: 0, color: 'var(--text-primary)' }}>Deixe seu feedback!</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px', lineHeight: 1.4 }}>
              Tem sugestões ou encontrou algum problema? Clique em <strong>Feedback</strong> no menu e nos conta!
            </p>
            <button
              onClick={() => {
                try { localStorage.setItem('feedback_nudge_dismissed', '1') } catch {}
                setFeedbackNudge(false)
                setFeedbackOpen(true)
              }}
              style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Abrir feedback
            </button>
          </div>
          <button
            aria-label="Fechar"
            onClick={() => {
              try { localStorage.setItem('feedback_nudge_dismissed', '1') } catch {}
              setFeedbackNudge(false)
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Modal de Feedback */}
      {feedbackOpen && (
        <div
          className="modal-overlay open"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) { setFeedbackOpen(false); setFeedbackSent(false); setFeedbackText('') } }}
        >
          <div className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="feedback-title" style={{ maxHeight: '60vh' }}>
            <div className="modal-handle" aria-hidden="true"/>
            <div className="modal-header">
              <h2 className="modal-title" id="feedback-title">Feedback</h2>
              <button className="modal-close" aria-label="Fechar" onClick={() => { setFeedbackOpen(false); setFeedbackSent(false); setFeedbackText('') }}>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {feedbackSent ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
                <p style={{ fontWeight: 600, fontSize: 16, color: 'var(--green-primary)' }}>Obrigado pelo feedback!</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>Sua opinião ajuda a melhorar o app.</p>
              </div>
            ) : (
              <form className="task-form" onSubmit={handleFeedbackSubmit} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="feedback-input">O que você achou? Tem alguma sugestão?</label>
                  <textarea
                    id="feedback-input"
                    className="form-input"
                    style={{ resize: 'vertical', minHeight: 100, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}
                    placeholder="Escreva aqui seu feedback…"
                    value={feedbackText}
                    onChange={e => setFeedbackText(e.target.value.slice(0, 500))}
                    maxLength={500}
                    required
                  />
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>{feedbackText.length}/500</p>
                </div>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={!feedbackText.trim() || feedbackSending}
                  style={{ width: '100%' }}
                >
                  {feedbackSending ? 'Enviando…' : 'Enviar Feedback'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Boas-vindas */}
      {welcomeVisible && (
        <div className="welcome-overlay" aria-live="polite">
          <div className="welcome-content">
            <div className="welcome-emoji" aria-hidden="true">🎉</div>
            <p className="welcome-label">Obrigado por usar,</p>
            <p className="welcome-name">{welcomeName}!</p>
          </div>
        </div>
      )}
    </>
  )
}
