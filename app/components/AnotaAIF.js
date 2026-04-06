'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import AuthScreen from './AuthScreen'

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
function toDb(task, userId = null) {
  return {
    id: task.id,
    type: task.type,
    subject: task.subject,
    description: task.description,
    due_date: task.dueDate,
    done: task.done,
    created_at: new Date(task.createdAt).toISOString(),
    ...(userId ? { created_by: userId } : {}),
  }
}

function fromDb(row) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    description: row.description,
    dueDate: row.due_date,
    done: row.done,
    createdAt: new Date(row.created_at).getTime(),
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

function getUrgency(task) {
  if (task.done) return 'done'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(task.dueDate + 'T00:00:00')
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'soon'
  return 'ok'
}

function formatDueDate(dateStr, urgency) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24))
  if (urgency === 'overdue') {
    const days = Math.abs(diffDays)
    return days === 1 ? 'Atrasada (ontem)' : `Atrasada (${days} dias)`
  }
  if (diffDays === 0) return 'Hoje!'
  if (diffDays === 1) return 'Amanhã'
  if (diffDays <= 6) return `Em ${diffDays} dias`
  return due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

// ── TaskCard ──────────────────────────────────────────
function TaskCard({ task, urgency, dueDateText, delay, onToggle, onEdit, onDelete }) {
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

    if (deltaX.current > 110) {
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
    if (deltaX.current > 8) return                        // foi swipe, não tap
    if (e.target.closest('.task-checkbox-wrap')) return   // checkbox: não abre edição
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
            </span>
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
      <button
        className="card-delete-btn"
        aria-label={`Deletar '${task.subject}'`}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
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
  const [subjectError, setSubjectError] = useState('')
  const [descError, setDescError]       = useState('')
  const [dateError, setDateError]       = useState('')
  const [savedSubjects, setSavedSubjects] = useState([])
  const [suggestions, setSuggestions]     = useState([])

  const subjectRef      = useRef(null)
  const snackTimerRef   = useRef(null)
  const pendingDeleteRef = useRef(null)   // { task, timerId }

  // Push notification subscription
  const [pushEnabled, setPushEnabled] = useState(false)
  const VAPID_PUBLIC = 'BG8Ia1k66BdRrC_v2ZxmVkDY47LLZwzhRfdv0aFSX9uRQMfwhk6m_roe9OAtnq3nUc0NOrfLK3QRv5LX_B6FtLU'

  // ── PWA: registra SW + detecta plataforma + captura prompt ──
  useEffect(() => {
    // Registra service worker e verifica push
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          if (sub) setPushEnabled(true)
        })
      }).catch(() => {})
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

  // Carrega dados quando o usuário estiver autenticado
  useEffect(() => {
    if (!user) return
    loadProfileThenData()

    // Matérias salvas (preferência local)
    try {
      const rawSubjects = localStorage.getItem(SUBJECTS_KEY)
      if (rawSubjects) setSavedSubjects(JSON.parse(rawSubjects))
    } catch {}
  }, [user])

  async function loadProfileThenData() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (error) throw error
      setProfile(data)
    } catch {
      // perfil não encontrado — usuário legado, usa class_code padrão
      setProfile({ class_code: 'INFO2026' })
    }
    loadData()
  }

  async function loadData() {
    try {
      const [tasksRes, completionsRes] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: true }),
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

  // Fecha com Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && isModalOpen) closeModal() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isModalOpen])

  // ── Modal ─────────────────────────────────────────────
  function openModal(task = null) {
    if (task) {
      setEditingTask(task)
      setTaskType(task.type)
      setSubject(task.subject)
      setDesc(task.description)
      setDueDate(task.dueDate)
    } else {
      setEditingTask(null)
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

    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timerId)
      pendingDeleteRef.current = null
    }

    setTasks(prev => prev.filter(t => t.id !== id))
    await supabase.from('tasks').delete().eq('id', id)

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

 // 1. Adicionamos a palavra 'async' aqui
  async function handleFormSubmit(e) {
    e.preventDefault()
    let valid = true

    if (subject.trim().length < 2) {
      setSubjectError('Digite o nome da matéria (mín. 2 caracteres).')
      valid = false
    }
    if (desc.trim().length < 5) {
      setDescError('Descreva melhor o que precisa ser feito (mín. 5 caracteres).')
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

    if (editingTask) {
      // Atualiza a tela primeiro (otimista)
      setTasks(prev => prev.map(t =>
        t.id === editingTask.id
          ? { ...t, type: taskType, subject: name, description: descTrimmed, dueDate }
          : t
      ))
      
      // 2. Adicionamos o 'await' e capturamos o erro na edição
      const { error } = await supabase.from('tasks')
        .update({ type: taskType, subject: name, description: descTrimmed, due_date: dueDate })
        .eq('id', editingTask.id)
        
      if (error) {
        console.error("🔴 ERRO AO EDITAR NO SUPABASE:", error.message)
        showSnackbar('Erro ao editar! Olhe o console (F12).')
        return
      }

      closeModal()
      setTimeout(() => showSnackbar(`"${name}" atualizada! ✓`), 400)
    } else {
      const classCode = profile?.class_code ?? 'INFO2026'
      const newTask = {
        id: generateId(),
        type: taskType,
        subject: name,
        description: descTrimmed,
        dueDate,
        done: false,
        createdAt: Date.now(),
      }
      
      // Atualiza a tela primeiro
      setTasks(prev => [...prev, newTask])
      
      // 3. Adicionamos o 'await' e capturamos o erro na inserção
      const { error } = await supabase.from('tasks')
        .insert({ ...toDb(newTask, user.id), class_code: classCode })
        
      if (error) {
        console.error("🔴 ERRO AO SALVAR NO SUPABASE:", error.message)
        showSnackbar('Erro ao salvar! Olhe o console (F12).')
        return
      }

      closeModal()
      setTimeout(() => showSnackbar(`"${name}" adicionada! ✓`), 400)
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
    await supabase.auth.signOut()
    setCompletions(new Set())
    setTasks([])
  }

  // ── Push Notifications ────────────────────────────────
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

  // ── Admin: gerar código da turma ─────────────────────
  const [copiedCode, setCopiedCode] = useState(false)

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

  const filtered = activeFilter === 'all'
    ? tasksWithDone
    : tasksWithDone.filter(t => t.type === activeFilter)

  const pending      = filtered.filter(t => !t.done).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
  const done         = filtered.filter(t => t.done)
  const sorted       = [...pending, ...done]
  const pendingCount = tasksWithDone.filter(t => !t.done).length
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
    const dueDateText = formatDueDate(task.dueDate, urgency)
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
        onDelete={() => handleDeleteTask(task.id)}
      />
    )
  })

  // ── Render ────────────────────────────────────────────
  if (user === undefined) return null  // verificando sessão
  if (user === null) return <AuthScreen onAuth={handleAuth} />

  return (
    <>
      {/* Header / Sidebar */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="logo-mark">
              <img src="/icons/logo-header.png" alt="Anota AIF!" className="logo-img" />
            </div>
            <div>
              <h1 className="app-title">Anota AIF!</h1>
              <p className="app-subtitle">
                {profile
                  ? `${profile.ano_turma ?? ''} · ${profile.curso ?? ''} · ${campusShort(profile.campus)}`
                  : 'IFSP'}
              </p>
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
          ].map(({ id, label }) => (
            <button
              key={id}
              className={`tab${activeFilter === id ? ' active' : ''}`}
              role="tab"
              aria-selected={activeFilter === id}
              onClick={() => setActiveFilter(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Admin: botão painel */}
        {profile?.is_admin && (
          <button className="btn-admin-panel" onClick={() => router.push('/admin')}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M3 17c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Painel de Alunos
          </button>
        )}

        {/* Admin: código da turma */}
        {profile?.is_admin && (
          <div className="admin-code-panel">
            <span className="admin-code-label">Código da Turma</span>
            <div className="admin-code-row">
              <span className="admin-code-value">{profile.class_code ?? '—'}</span>
              <button
                className="admin-code-btn"
                onClick={handleCopyCode}
                title="Copiar código"
                aria-label="Copiar código da turma"
              >
                {copiedCode ? '✓' : (
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                )}
              </button>
              {!profile.class_code && (
                <button
                  className="admin-code-btn admin-code-gen"
                  onClick={handleGenerateCode}
                  title="Gerar código"
                  aria-label="Gerar código da turma"
                >
                  Gerar
                </button>
              )}
            </div>
            {profile.class_code && (
              <button
                className="admin-regen-btn"
                onClick={() => {
                  if (confirm('Gerar um novo código? O código anterior deixará de funcionar.')) {
                    handleGenerateCode()
                  }
                }}
              >
                Gerar novo código
              </button>
            )}
          </div>
        )}

        {/* Usuário logado + sair */}
        <div className="user-bar">
          <span className="user-bar-name">
            {user.user_metadata?.full_name ?? 'Aluno'}
          </span>
          <button className="user-bar-signout" onClick={handleSignOut} title="Sair">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M13 3h4a1 1 0 011 1v12a1 1 0 01-1 1h-4M8 14l4-4-4-4M12 10H3"
                    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Sair
          </button>
        </div>
      </header>

      {/* Banner: ativar notificações */}
      {!pushEnabled && typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'denied' && (
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
        {sorted.length === 0 ? (
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
        )}
      </main>

      {/* FAB */}
      <button
        className={`fab${isModalOpen ? ' open' : ''}`}
        aria-label="Adicionar nova tarefa"
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
              {isEditing ? 'Editar Tarefa' : 'Nova Tarefa'}
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

            {/* Matéria */}
            <div className="form-group">
              <label className="form-label" htmlFor="subject-input">
                Matéria <span className="required" aria-hidden="true">*</span>
              </label>
              <div className="subject-wrap">
                <input
                  ref={subjectRef}
                  type="text"
                  id="subject-input"
                  className={`form-input${subjectError ? ' error' : ''}`}
                  placeholder="Ex: Matemática, Redes…"
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

            {/* Descrição */}
            <div className="form-group">
              <label className="form-label" htmlFor="desc-input">
                Descrição <span className="required" aria-hidden="true">*</span>
              </label>
              <textarea
                id="desc-input"
                className={`form-textarea${descError ? ' error' : ''}`}
                rows={3}
                placeholder="O que precisa ser feito? Capítulos, páginas, detalhes…"
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
                Data de Entrega <span className="required" aria-hidden="true">*</span>
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
                  : taskType === 'prova' ? 'Enviar Prova' : 'Enviar Tarefa'}
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
