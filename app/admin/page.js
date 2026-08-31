'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import ThemeToggle from '../components/ThemeToggle'

export default function AdminPage() {
  const router = useRouter()
  const [profiles, setProfiles]       = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [rooms, setRooms]             = useState([])
  const [feedbacks, setFeedbacks]     = useState([])
  const [auditLogs, setAuditLogs]     = useState([])
  const [subgroups, setSubgroups]     = useState([])
  const [expandedRoom, setExpandedRoom] = useState(null)
  const [roomTasks, setRoomTasks]     = useState({})
  const [copiedInvite, setCopiedInvite] = useState(null)
  const [loginLogs, setLoginLogs]     = useState([])
  // ── Presença (SOMENTE o dono) ──
  const [isOwner, setIsOwner]         = useState(false)
  const [presSessions, setPresSessions] = useState([])
  const [presRange, setPresRange]     = useState('hoje')   // 'hoje' | '7d' | '30d'
  const [presSearch, setPresSearch]   = useState('')
  const [agora, setAgora]             = useState(() => Date.now())
  const [actLogins, setActLogins]     = useState([])   // login_logs dos últimos 14 dias
  const [actTasks, setActTasks]       = useState([])   // audit_logs (criação de atividade) dos últimos 14 dias
  const [activeTab, setActiveTab]     = useState('overview')  // 'overview' | 'atividade' | 'feedback' | 'logs' | 'subgroups' | 'ips'
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [flash, setFlash]             = useState('')
  const [authError, setAuthError]     = useState('')

  async function loadProfiles() {
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString()
    const [{ data, error }, { data: sug }, { data: rms }, { data: fbs }, { data: logs }, { data: sgs }, { data: ips }, { data: actL }, { data: actT }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, campus, curso, ano_turma, class_code, is_admin, is_moderator, kick_requested, created_at').order('campus'),
      supabase.from('task_suggestions').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('rooms').select('*').order('campus'),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('subgroups').select('*, subgroup_members(count)').order('created_at', { ascending: false }),
      supabase.from('login_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('login_logs').select('user_id, full_name, created_at').gte('created_at', since14),
      supabase.from('audit_logs').select('user_id, user_name, created_at').gte('created_at', since14).in('action', ['task_created', 'subgroup_task_created']),
    ])
    if (error) setAuthError('Erro ao carregar perfis: ' + error.message)
    setProfiles(data ?? [])
    setSuggestions(sug ?? [])
    setRooms(rms ?? [])
    setFeedbacks(fbs ?? [])
    setAuditLogs(logs ?? [])
    setSubgroups(sgs ?? [])
    setLoginLogs(ips ?? [])
    setActLogins(actL ?? [])
    setActTasks(actT ?? [])
  }

  // Carrega as sessões de acesso. A RLS da tabela só libera SELECT para o
  // dono — admin e moderador recebem lista vazia mesmo se chamarem direto.
  async function loadPresence(range = presRange) {
    const days = range === 'hoje' ? 1 : range === '7d' ? 7 : 30
    const since = range === 'hoje'
      ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      : new Date(Date.now() - days * 86400000).toISOString()

    setAgora(Date.now())
    const { data } = await supabase
      .from('access_sessions')
      .select('*')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(800)
    setPresSessions(data ?? [])
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setAuthError('Sem sessão. Faça login primeiro.')
        setLoading(false)
        return
      }
      const { data: me, error: meErr } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id).single()
      if (meErr) {
        setAuthError(`Erro ao verificar admin: ${meErr.message} (uid: ${session.user.id})`)
        setLoading(false)
        return
      }
      if (!me?.is_admin) {
        setAuthError(`Acesso negado. is_admin=${me?.is_admin} (uid: ${session.user.id})`)
        setLoading(false)
        return
      }
      // Dono: consulta separada e tolerante — se a migration ainda não rodou,
      // a coluna não existe e o painel simplesmente segue sem a aba.
      const { data: own } = await supabase
        .from('profiles').select('is_owner').eq('id', session.user.id).maybeSingle()
      const owner = !!own?.is_owner
      setIsOwner(owner)

      await loadProfiles()
      if (owner) await loadPresence('hoje')
      setLoading(false)
    })
  }, [])

  // Enquanto a aba Presença estiver aberta, atualiza sozinha.
  useEffect(() => {
    if (!isOwner || activeTab !== 'presenca') return
    const id = setInterval(() => loadPresence(), 20000)
    return () => clearInterval(id)
  }, [isOwner, activeTab, presRange])

  function showFlash(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  async function toggleModerador(p) {
    const next = !p.is_moderator
    const { error } = await supabase.from('profiles').update({ is_moderator: next }).eq('id', p.id)
    if (error) { showFlash('Erro: ' + error.message); return }
    showFlash(`${p.full_name} ${next ? 'agora é moderador ✓' : 'não é mais moderador'}`)
    await loadProfiles()
  }

  async function kickUser(p) {
    if (!confirm(`Banir ${p.full_name}? A conta será excluída permanentemente.`)) return
    const res = await fetch('/api/admin/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p.id }),
    })
    const data = await res.json()
    if (data.error) { showFlash('Erro: ' + data.error); return }
    showFlash(`${p.full_name} foi banido e a conta excluída ✓`)
    await loadProfiles()
  }

  async function pushRoom(code) {
    showFlash(`Enviando push para sala ${code}…`)
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        class_code: code,
        title: '🔔 Teste de notificação — Anota AIF',
        body: 'Notificação de teste enviada pelo admin!',
      }),
    })
    const data = await res.json()
    if (!data.ok) {
      showFlash(`❌ Erro: ${data.error ?? JSON.stringify(data)}`)
    } else if (data.members === 0) {
      showFlash(`Sala ${code}: nenhum membro encontrado.`)
    } else if (data.subscriptions === 0) {
      showFlash(`Sala ${code}: ${data.members} membro(s), mas nenhum ativou notificações ainda.`)
    } else if (data.sent === 0) {
      showFlash(`Sala ${code}: ${data.subscriptions} inscrito(s), mas nenhuma entregue (VAPID inválida?).`)
    } else {
      showFlash(`Sala ${code}: ${data.sent}/${data.subscriptions} notificação(ões) enviada(s) ✓`)
    }
  }

  async function sendUpdateNotification() {
    if (!confirm('Enviar notificação de atualização para todos os alunos?')) return
    showFlash('Enviando…')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/notify-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({
        title: '🗓️ Novidade no Anota AIF!',
        body: 'Agora você pode marcar tarefas com múltiplas datas — perfeito para apresentações em dias diferentes!',
        url: 'https://anotaaif-next.vercel.app',
      }),
    })
    const data = await res.json()
    showFlash(data.ok ? `Notificação enviada para ${data.sent}/${data.total} salas ✓` : `Erro: ${data.error}`)
  }

  async function approveSuggestion(sug) {
    const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    await supabase.from('tasks').insert({
      id, type: sug.type, subject: sug.subject,
      description: sug.description ?? '', due_date: sug.due_date,
      done: false, class_code: sug.class_code,
    })
    await supabase.from('task_suggestions').update({ status: 'approved' }).eq('id', sug.id)
    showFlash(`Tarefa "${sug.subject}" criada!`)
    await loadProfiles()
  }

  async function rejectSuggestion(sug) {
    await supabase.from('task_suggestions').update({ status: 'rejected' }).eq('id', sug.id)
    showFlash('Sugestão rejeitada')
    await loadProfiles()
  }

  async function copyInvite(code) {
    const link = `${window.location.origin}/?join=${code}`
    try {
      await navigator.clipboard.writeText(link)
      setCopiedInvite(code)
      setTimeout(() => setCopiedInvite(null), 2500)
    } catch {
      showFlash(link)
    }
  }

  async function deleteRoom(code) {
    const count = profiles.filter(p => p.class_code === code).length
    const warn = count > 0
      ? `\n\n⚠️ ${count} aluno(s) serão removidos da sala e verão um aviso.`
      : ''
    if (!confirm(`Apagar sala "${code}"?${warn}`)) return
    const { error } = await supabase.from('rooms').delete().eq('class_code', code)
    if (error) { showFlash('Erro: ' + error.message); return }
    // Remove alunos da sala — eles verão "Sua sala foi removida" no próximo acesso
    if (count > 0) {
      await supabase.from('profiles').update({ class_code: null }).eq('class_code', code)
    }
    setRooms(prev => prev.filter(r => r.class_code !== code))
    showFlash(`Sala "${code}" apagada e ${count} aluno(s) removidos ✓`)
  }

  async function toggleRoomTasks(code) {
    if (expandedRoom === code) { setExpandedRoom(null); return }
    setExpandedRoom(code)
    if (roomTasks[code]) return  // já carregou
    const res = await fetch(`/api/admin/room-tasks?code=${code}`)
    const { tasks } = await res.json()
    setRoomTasks(prev => ({ ...prev, [code]: tasks ?? [] }))
  }

  async function clearKickFlag(p) {
    await supabase.from('profiles').update({ kick_requested: false }).eq('id', p.id)
    showFlash('Solicitação descartada')
    await loadProfiles()
  }

  async function changeClassCode(p) {
    const novo = prompt(`Novo código de sala para ${p.full_name}:`, p.class_code ?? '')
    if (!novo?.trim()) return
    const code = novo.trim().toUpperCase()
    // Busca a sala para também atualizar ano_turma/curso
    const { data: room } = await supabase.from('rooms').select('*').eq('class_code', code).maybeSingle()
    const updates = { class_code: code }
    if (room) {
      updates.ano_turma = room.ano_turma
      updates.curso = room.curso
      updates.campus = room.campus
    }
    await supabase.from('profiles').update(updates).eq('id', p.id)
    const label = room ? `→ ${room.ano_turma} ${room.curso}` : ''
    showFlash(`Sala de ${p.full_name} atualizada ${label}`)
    await loadProfiles()
  }

  const filtered = profiles.filter(p => {
    const q = search.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.campus?.toLowerCase().includes(q) ||
      p.class_code?.toLowerCase().includes(q)
    )
  })

  const byCampus = {}
  filtered.forEach(p => {
    const key = p.campus ?? 'Sem campus'
    if (!byCampus[key]) byCampus[key] = []
    byCampus[key].push(p)
  })

  function roomLabel(members) {
    const count = {}
    members.forEach(m => {
      const k = `${m.ano_turma ?? '?'} · ${m.curso ?? '?'}`
      count[k] = (count[k] ?? 0) + 1
    })
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  }

  function roleLabel(p) {
    if (p.is_admin) return { label: 'Admin', cls: 'role-admin' }
    if (p.is_moderator) return { label: 'Moderador', cls: 'role-mod' }
    return { label: 'Aluno', cls: 'role-student' }
  }

  const kickFlagged = profiles.filter(p => p.kick_requested)

  // ── Medição de atividade (7 / 14 dias) ──
  const now = Date.now()
  // Conjuntos de user_id distintos por janela. Fallback para o nome quando não há user_id.
  function distinctUsers(rows, nameKey, days) {
    const limit = now - days * 86400000
    const ids = new Set()
    const names = new Map()  // user_id -> nome (para exibir)
    rows.forEach(r => {
      if (new Date(r.created_at).getTime() < limit) return
      const key = r.user_id || ('name:' + (r[nameKey] ?? '?'))
      ids.add(key)
      if (!names.has(key)) names.set(key, r[nameKey] ?? '—')
    })
    return { ids, names }
  }
  const opened7  = distinctUsers(actLogins, 'full_name', 7)
  const opened14 = distinctUsers(actLogins, 'full_name', 14)
  const launched7  = distinctUsers(actTasks, 'user_name', 7)
  const launched14 = distinctUsers(actTasks, 'user_name', 14)
  // Quem sumiu: aluno (não-admin) que não abriu nos últimos 14 dias
  const vanished = profiles.filter(p => !p.is_admin && !opened14.ids.has(p.id))
  // Resolve a sala (class_code) de cada pessoa cruzando user_id com os perfis.
  const profById = Object.fromEntries(profiles.map(p => [p.id, p]))
  function buildList(win14, win7) {
    return [...win14.names.entries()]
      .map(([key, name]) => ({ key, name, sala: profById[key]?.class_code ?? null, recent: win7.ids.has(key) }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  }
  const openedList   = buildList(opened14, opened7)
  const launchedList = buildList(launched14, launched7)

  // ── Presença: derivados ──
  const ONLINE_MS = 120000   // sem ping há 2 min = saiu
  function isOnline(sess) {
    return !sess.ended_at && (agora - new Date(sess.last_seen_at).getTime()) < ONLINE_MS
  }
  function fmtHora(iso) {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  function fmtDia(iso) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }
  function fmtDuracao(ms) {
    if (!ms || ms < 0) return '—'
    const min = Math.round(ms / 60000)
    if (min < 1) return 'menos de 1 min'
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    return `${h}h${String(min % 60).padStart(2, '0')}`
  }
  function haQuantoTempo(iso) {
    const min = Math.round((agora - new Date(iso).getTime()) / 60000)
    if (min < 1) return 'agora mesmo'
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `há ${h}h`
    return `há ${Math.floor(h / 24)} d`
  }
  function nomeDaSessao(sess) {
    return sess.full_name || (sess.user_id ? 'Sem apelido' : 'Visitante (não logado)')
  }
  function localDaSessao(sess) {
    return [sess.city, sess.region].filter(Boolean).join(' · ') || '—'
  }
  function duracaoSessao(sess) {
    const fim = sess.ended_at ? new Date(sess.ended_at).getTime()
                              : new Date(sess.last_seen_at).getTime()
    return fim - new Date(sess.started_at).getTime()
  }

  const presFiltradas = presSessions.filter(sess => {
    const q = presSearch.trim().toLowerCase()
    if (!q) return true
    return [nomeDaSessao(sess), sess.ip, sess.city, sess.class_code, sess.device, sess.browser]
      .some(v => (v ?? '').toString().toLowerCase().includes(q))
  })

  const presOnline    = presFiltradas.filter(isOnline)
  const presPessoas   = new Set(presFiltradas.map(sess => sess.user_id ?? 'anon:' + sess.ip)).size
  const presVisitas   = presFiltradas.filter(sess => !sess.user_id).length
  const presDuracoes  = presFiltradas.map(duracaoSessao).filter(ms => ms > 0)
  const presMedia     = presDuracoes.length
    ? presDuracoes.reduce((a, b) => a + b, 0) / presDuracoes.length
    : 0

  // Resumo por pessoa dentro do período escolhido
  const presPorPessoa = Object.values(
    presFiltradas.reduce((acc, sess) => {
      const chave = sess.user_id ?? 'anon:' + sess.ip
      if (!acc[chave]) {
        acc[chave] = {
          chave,
          nome: nomeDaSessao(sess),
          sala: sess.class_code,
          papel: sess.role,
          sessoes: 0,
          tempo: 0,
          ultimo: sess.last_seen_at,
          online: false,
          dispositivos: new Set(),
          ips: new Set(),
        }
      }
      const item = acc[chave]
      item.sessoes += 1
      item.tempo   += Math.max(0, duracaoSessao(sess))
      item.online   = item.online || isOnline(sess)
      if (new Date(sess.last_seen_at) > new Date(item.ultimo)) item.ultimo = sess.last_seen_at
      if (sess.device) item.dispositivos.add(sess.device)
      if (sess.ip)     item.ips.add(sess.ip)
      return acc
    }, {})
  ).sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo))

  if (loading) return <div className="admin-loading">Carregando painel…</div>
  if (authError) return (
    <div className="admin-loading" style={{ flexDirection:'column', gap:12, padding:24, textAlign:'center' }}>
      <strong style={{ color:'#c0392b' }}>Erro de acesso</strong>
      <code style={{ fontSize:13, background:'var(--surface-secondary)', padding:'8px 12px', borderRadius:8, display:'block', wordBreak:'break-all' }}>{authError}</code>
      <button onClick={() => router.push('/')} style={{ marginTop:8, padding:'8px 20px', borderRadius:8, border:'1px solid #ccc', cursor:'pointer' }}>Voltar</button>
    </div>
  )

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-inner">
          <button className="admin-back" onClick={() => router.push('/')} aria-label="Voltar">
            <svg viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            Voltar
          </button>
          <h1 className="admin-title">Painel Admin</h1>
          <div className="header-right-group">
            <ThemeToggle className="btn-theme-mini" showLabel={false} />
            <span className="admin-count">{profiles.length} alunos</span>
          </div>
        </div>
      </header>

      {flash && <div className="admin-flash">{flash}</div>}

      {/* Abas */}
      <div style={{ display:'flex', gap:4, padding:'8px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        {[
          { id:'overview', label:'📊 Visão Geral' },
          { id:'atividade', label:'📈 Atividade' },
          { id:'feedback', label:`💬 Feedback${feedbacks.length ? ` (${feedbacks.length})` : ''}` },
          { id:'logs',     label:'📋 Registros' },
          { id:'subgroups',label:`🔵 Subgrupos${subgroups.length ? ` (${subgroups.length})` : ''}` },
          { id:'ips',      label:`🌐 IPs${loginLogs.length ? ` (${loginLogs.length})` : ''}` },
          ...(isOwner ? [{ id:'presenca', label:`👁 Presença${presOnline.length ? ` · ${presOnline.length} online` : ''}` }] : []),
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ whiteSpace:'nowrap', padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
              background: activeTab===t.id ? 'var(--green-primary)' : 'var(--bg)', color: activeTab===t.id ? '#fff' : 'var(--text-secondary)' }}>
            {t.label}
          </button>
        ))}
      </div>

      <main className="admin-main">
        {activeTab === 'overview' && (
          <>
            <button
              className="admin-btn"
              style={{ marginBottom: 12, width: '100%', padding: '10px', fontSize: 13, background: '#00843D', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              onClick={sendUpdateNotification}
            >
              📣 Enviar notificação de atualização (todas as salas)
            </button>
          </>
        )}

        {activeTab === 'overview' && <>
        {/* Visão geral de todas as salas cadastradas */}
        {rooms.length > 0 && (
          <section className="admin-campus-section" style={{ marginBottom: 16 }}>
            <h2 className="admin-campus-title">
              🏫 Salas cadastradas
              <span className="admin-campus-count">{rooms.length}</span>
            </h2>
            <div className="admin-turma">
              <table className="tabela-cartao" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', opacity: 0.6, fontWeight: 600 }}>Chave</th>
                    <th style={{ padding: '6px 8px', opacity: 0.6, fontWeight: 600 }}>Turma</th>
                    <th style={{ padding: '6px 8px', opacity: 0.6, fontWeight: 600 }}>Campus</th>
                    <th style={{ padding: '6px 8px', opacity: 0.6, fontWeight: 600 }}>Membros</th>
                    <th style={{ padding: '6px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map(r => {
                    const count = profiles.filter(p => p.class_code === r.class_code).length
                    return (
                      <tr key={r.class_code} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td data-rotulo="Chave" style={{ padding: '6px 8px' }}>
                          <code style={{ background: 'var(--surface-secondary)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                            {r.class_code}
                          </code>
                        </td>
                        <td data-rotulo="Turma" style={{ padding: '6px 8px' }}>{r.ano_turma} · {r.curso}</td>
                        <td data-rotulo="Campus" style={{ padding: '6px 8px', opacity: 0.7 }}>{r.campus?.replace('IFSP – ', '')}</td>
                        <td data-rotulo="Membros" style={{ padding: '6px 8px', textAlign: 'center' }}>{count}</td>
                        <td style={{ padding: '6px 8px', display: 'flex', gap: 4 }}>
                          <button
                            className="admin-btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => copyInvite(r.class_code)}
                          >
                            {copiedInvite === r.class_code ? '✓' : '🔗'}
                          </button>
                          <button
                            className="admin-btn admin-btn-active"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => pushRoom(r.class_code)}
                            title="Enviar push de teste para essa sala"
                          >
                            🔔
                          </button>
                          <button
                            className="admin-btn admin-btn-danger"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => deleteRoom(r.class_code)}
                            title="Apagar sala"
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <input
          className="admin-search"
          type="search"
          placeholder="Buscar por nome, campus ou código…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Solicitações de saída */}
        {kickFlagged.length > 0 && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title" style={{ color: '#c0392b' }}>
              ⚠ Solicitações de saída
              <span className="admin-campus-count">{kickFlagged.length}</span>
            </h2>
            <div className="admin-turma">
              <ul className="admin-student-list">
                {kickFlagged.map(p => (
                  <li key={p.id} className="admin-student-item">
                    <div className="asi-info">
                      <span className="asi-name">{p.full_name}</span>
                      <span className="asi-sub">{p.class_code} · {p.ano_turma} {p.curso}</span>
                    </div>
                    <div className="asi-actions">
                      <button className="admin-btn admin-btn-danger" onClick={() => kickUser(p)}>Banir</button>
                      <button className="admin-btn" onClick={() => clearKickFlag(p)}>Ignorar</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Sugestões de tarefas pendentes (todas as salas) */}
        {suggestions.length > 0 && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title" style={{ color: '#2980b9' }}>
              📋 Sugestões pendentes
              <span className="admin-campus-count">{suggestions.length}</span>
            </h2>
            {suggestions.map(sug => (
              <div key={sug.id} className="admin-turma" style={{ marginBottom: 8 }}>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className={`task-type-badge badge-${sug.type}`} style={{ fontSize: 11 }}>
                      {sug.type === 'prova' ? 'Prova' : 'Atividade'}
                    </span>
                    <strong style={{ fontSize: 14 }}>{sug.subject}</strong>
                    <span style={{ fontSize: 11, opacity: 0.5 }}>· {sug.class_code}</span>
                  </div>
                  {sug.description && <p style={{ margin: '4px 0', fontSize: 13, opacity: 0.8 }}>{sug.description}</p>}
                  <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.6 }}>
                    Por: {sug.suggested_by_name ?? 'Aluno'} · {sug.due_date ? new Date(sug.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'sem data'}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="admin-btn admin-btn-active" onClick={() => approveSuggestion(sug)}>Aprovar e criar</button>
                    <button className="admin-btn admin-btn-danger" onClick={() => rejectSuggestion(sug)}>Rejeitar</button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Salas por campus */}
        {Object.entries(byCampus).map(([campus, students]) => (
          <section key={campus} className="admin-campus-section">
            <h2 className="admin-campus-title">
              {campus}
              <span className="admin-campus-count">{students.length}</span>
            </h2>

            {Object.entries(
              students.reduce((acc, s) => {
                const k = s.class_code ?? '—'
                if (!acc[k]) acc[k] = []
                acc[k].push(s)
                return acc
              }, {})
            ).map(([code, members]) => (
              <div key={code} className="admin-turma">
                <div className="admin-turma-header" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className="admin-turma-code">{code}</span>
                  <span className="admin-turma-meta">{roomLabel(members)}</span>
                  <span className="admin-turma-count">{members.length} membros</span>
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <button
                      className="admin-btn"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={() => copyInvite(code)}
                    >
                      {copiedInvite === code ? '✓ Copiado' : '🔗 Convite'}
                    </button>
                    <button
                      className="admin-btn admin-btn-active"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={() => toggleRoomTasks(code)}
                    >
                      {expandedRoom === code ? '▲ Fechar' : '👁 Ver tarefas'}
                    </button>
                    <button
                      className="admin-btn"
                      style={{ fontSize: 11, padding: '3px 10px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                      onClick={() => pushRoom(code)}
                      title="Testar push nessa sala"
                    >
                      🔔 Push
                    </button>
                    <a
                      href={`/?room=${code}`}
                      className="admin-btn"
                      style={{ fontSize: 11, padding: '3px 10px', textDecoration: 'none' }}
                      target="_blank" rel="noopener noreferrer"
                    >
                      ↗ Entrar
                    </a>
                  </div>
                </div>
                {expandedRoom === code && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                    {!roomTasks[code] ? (
                      <p style={{ fontSize: 13, opacity: 0.5 }}>Carregando…</p>
                    ) : roomTasks[code].length === 0 ? (
                      <p style={{ fontSize: 13, opacity: 0.5 }}>Nenhuma tarefa nessa sala.</p>
                    ) : (
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {roomTasks[code].map(t => (
                          <li key={t.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span className={`task-type-badge badge-${t.type}`} style={{ fontSize: 10 }}>
                              {t.type === 'prova' ? 'Prova' : 'Ativ.'}
                            </span>
                            <strong>{t.subject}</strong>
                            <span style={{ opacity: 0.6 }}>{t.description}</span>
                            <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
                              {t.due_date ? new Date(t.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <ul className="admin-student-list">
                  {members.map(s => {
                    const role = roleLabel(s)
                    return (
                      <li key={s.id} className="admin-student-item">
                        <div className="asi-info">
                          <span className="asi-name">{s.full_name}</span>
                          <span className={`asi-role ${role.cls}`}>{role.label}</span>
                        </div>
                        {s.kick_requested && (
                          <span className="admin-badge-kick">⚠ saída solicitada</span>
                        )}
                        {!s.is_admin && (
                          <div className="asi-actions">
                            <button
                              className={`admin-btn ${s.is_moderator ? 'admin-btn-active' : ''}`}
                              onClick={() => toggleModerador(s)}
                            >
                              {s.is_moderator ? 'Mod ✓' : 'Tornar Mod'}
                            </button>
                            <button
                              className="admin-btn admin-btn-muted"
                              onClick={() => changeClassCode(s)}
                            >
                              Sala
                            </button>
                            <button
                              className="admin-btn admin-btn-danger"
                              onClick={() => kickUser(s)}
                            >
                              Banir
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}

        {filtered.length === 0 && (
          <p className="admin-empty">Nenhum resultado encontrado.</p>
        )}
        </>}

        {/* ── Aba: Atividade (medição 7/14 dias) ── */}
        {activeTab === 'atividade' && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">📈 Quem está ativo</h2>

            {/* Cartões de números */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
              {[
                { label:'Abriram (7 dias)',   value:opened7.ids.size,   color:'#00843D' },
                { label:'Abriram (14 dias)',  value:opened14.ids.size,  color:'#1f8a4c' },
                { label:'Lançaram atividade (7 dias)',  value:launched7.ids.size,  color:'#2980b9' },
                { label:'Lançaram atividade (14 dias)', value:launched14.ids.size, color:'#2471a3' },
                { label:'Sumiram (sem abrir há 14 dias)', value:vanished.length, color:'#c0392b' },
              ].map(c => (
                <div key={c.label} style={{ flex:'1 1 140px', minWidth:140, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px' }}>
                  <div style={{ fontSize:28, fontWeight:800, color:c.color, lineHeight:1 }}>{c.value}</div>
                  <div style={{ fontSize:12, opacity:0.65, marginTop:4 }}>{c.label}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize:11, opacity:0.5, marginTop:-8, marginBottom:16 }}>
              ⚠️ “Abriu” aqui conta só quem <strong>fez login de novo</strong> no período — quem já estava logado e só abriu o app não aparece,
              então esses números saem baixos de propósito. Para saber de verdade quem entrou, use a aba Presença.
              “Lançou atividade” = criou tarefa (turma ou subgrupo). Contagem por pessoa, sem repetição.
            </p>

            {/* Quem abriu */}
            <div className="admin-turma" style={{ marginBottom:12 }}>
              <div style={{ padding:'10px 14px' }}>
                <strong style={{ fontSize:14 }}>✅ Abriram nos últimos 14 dias <span style={{ opacity:0.5 }}>({openedList.length})</span></strong>
                {openedList.length === 0
                  ? <p style={{ fontSize:13, opacity:0.5, margin:'8px 0 0' }}>Ninguém abriu no período.</p>
                  : <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                      {openedList.map(u => (
                        <span key={u.key} className={u.recent ? 'chip-green' : 'chip-neutral'}
                          style={{ fontSize:12, padding:'3px 9px', borderRadius:999, fontWeight: u.recent ? 700 : 500 }}>
                          {u.name}{u.sala ? ` · ${u.sala}` : ''}{u.recent ? ' · 7d' : ''}
                        </span>
                      ))}
                    </div>
                }
                <p style={{ fontSize:11, opacity:0.5, margin:'8px 0 0' }}>Verde = abriu também nos últimos 7 dias.</p>
              </div>
            </div>

            {/* Quem lançou atividade */}
            <div className="admin-turma" style={{ marginBottom:12 }}>
              <div style={{ padding:'10px 14px' }}>
                <strong style={{ fontSize:14 }}>📝 Lançaram atividade nos últimos 14 dias <span style={{ opacity:0.5 }}>({launchedList.length})</span></strong>
                {launchedList.length === 0
                  ? <p style={{ fontSize:13, opacity:0.5, margin:'8px 0 0' }}>Ninguém lançou atividade no período.</p>
                  : <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                      {launchedList.map(u => (
                        <span key={u.key} className={u.recent ? 'chip-blue' : 'chip-neutral'}
                          style={{ fontSize:12, padding:'3px 9px', borderRadius:999, fontWeight: u.recent ? 700 : 500 }}>
                          {u.name}{u.sala ? ` · ${u.sala}` : ''}{u.recent ? ' · 7d' : ''}
                        </span>
                      ))}
                    </div>
                }
                <p style={{ fontSize:11, opacity:0.5, margin:'8px 0 0' }}>Azul = lançou também nos últimos 7 dias.</p>
              </div>
            </div>

            {/* Quem sumiu */}
            <div className="admin-turma">
              <div style={{ padding:'10px 14px' }}>
                <strong style={{ fontSize:14, color:'#c0392b' }}>💤 Sumiram — sem abrir há 14 dias <span style={{ opacity:0.5 }}>({vanished.length})</span></strong>
                {vanished.length === 0
                  ? <p style={{ fontSize:13, opacity:0.5, margin:'8px 0 0' }}>Todo mundo abriu nos últimos 14 dias 🎉</p>
                  : <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                      {vanished
                        .slice()
                        .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
                        .map(p => (
                          <span key={p.id} title={`${p.class_code ?? '—'} · ${p.ano_turma ?? ''} ${p.curso ?? ''}`}
                            className="chip-red" style={{ fontSize:12, padding:'3px 9px', borderRadius:999, fontWeight:500 }}>
                            {p.full_name ?? '—'}{p.class_code ? ` · ${p.class_code}` : ''}
                          </span>
                        ))}
                    </div>
                }
              </div>
            </div>
          </section>
        )}

        {/* ── Aba: Feedback ── */}
        {activeTab === 'feedback' && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">💬 Feedbacks dos alunos <span className="admin-campus-count">{feedbacks.length}</span></h2>
            {feedbacks.length === 0
              ? <p style={{ fontSize:13, color:'var(--text-muted)', padding:'16px 0' }}>Nenhum feedback ainda.</p>
              : feedbacks.map(fb => (
                  <div key={fb.id} className="admin-turma" style={{ marginBottom:8 }}>
                    <div style={{ padding:'10px 14px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <strong style={{ fontSize:14 }}>{fb.nome ?? 'Anônimo'}</strong>
                        <span style={{ fontSize:11, opacity:0.5 }}>{fb.turma} · {new Date(fb.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                      </div>
                      <p style={{ fontSize:13, margin:0, lineHeight:1.5 }}>{fb.message}</p>
                    </div>
                  </div>
                ))
            }
          </section>
        )}

        {/* ── Aba: Registros/Audit Logs ── */}
        {activeTab === 'logs' && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">📋 Registros de atividade <span className="admin-campus-count">{auditLogs.length}</span></h2>
            {auditLogs.length === 0
              ? <p style={{ fontSize:13, color:'var(--text-muted)', padding:'16px 0' }}>Nenhum registro ainda.</p>
              : <div className="admin-turma">
                  <table className="tabela-cartao" style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)', textAlign:'left', opacity:0.6 }}>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Quando</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Quem</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Ação</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(log => {
                        const actionLabels = {
                          task_created: '✅ Criou tarefa',
                          task_deleted: '🗑 Apagou tarefa',
                          task_edited: '✏️ Editou tarefa',
                          suggestion_sent: '📩 Enviou sugestão',
                          subgroup_created: '🔵 Criou subgrupo',
                          subgroup_task_created: '🔵 Criou tarefa no subgrupo',
                          name_changed: '✏️ Mudou nome',
                          user_banned: '🚫 Baniu usuário',
                          mod_granted: '⭐ Deu mod',
                          mod_revoked: '⭐ Removeu mod',
                        }
                        return (
                          <tr key={log.id} style={{ borderBottom:'1px solid var(--border)' }}>
                            <td data-rotulo="Quando" style={{ padding:'5px 8px', whiteSpace:'nowrap', opacity:0.6 }}>
                              {new Date(log.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })} {new Date(log.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                            </td>
                            <td data-rotulo="Quem" style={{ padding:'5px 8px', fontWeight:600 }}>{log.user_name ?? '—'}</td>
                            <td data-rotulo="Ação" style={{ padding:'5px 8px' }}>{actionLabels[log.action] ?? log.action}</td>
                            <td data-rotulo="Detalhes" style={{ padding:'5px 8px', opacity:0.7 }}>
                              {log.details?.subject && <span>"{log.details.subject}"</span>}
                              {log.details?.name && <span>"{log.details.name}"</span>}
                              {log.details?.subgroup && <span>subgrupo: {log.details.subgroup}</span>}
                              {log.class_code && <span style={{ marginLeft:6, fontSize:11, background:'var(--surface-secondary)', padding:'1px 5px', borderRadius:4 }}>{log.class_code}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </section>
        )}

        {/* ── Aba: Subgrupos ── */}
        {activeTab === 'subgroups' && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">🔵 Subgrupos <span className="admin-campus-count">{subgroups.length}</span></h2>
            {subgroups.length === 0
              ? <p style={{ fontSize:13, color:'var(--text-muted)', padding:'16px 0' }}>Nenhum subgrupo criado ainda.</p>
              : <div className="admin-turma">
                  <table className="tabela-cartao" style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)', textAlign:'left', opacity:0.6 }}>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Nome</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Sala</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Membros</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Código</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Criado em</th>
                        <th style={{ padding:'6px 8px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {subgroups.map(sg => (
                        <tr key={sg.id} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td data-rotulo="Nome" style={{ padding:'6px 8px', fontWeight:600 }}>{sg.name}</td>
                          <td data-rotulo="Sala" style={{ padding:'6px 8px' }}><code style={{ background:'var(--surface-secondary)', padding:'2px 5px', borderRadius:4 }}>{sg.class_code}</code></td>
                          <td data-rotulo="Membros" style={{ padding:'6px 8px', textAlign:'center' }}>{sg.subgroup_members?.[0]?.count ?? 0}</td>
                          <td data-rotulo="Código" style={{ padding:'6px 8px' }}><code style={{ fontWeight:700 }}>{sg.invite_code}</code></td>
                          <td data-rotulo="Criado em" style={{ padding:'6px 8px', opacity:0.6 }}>{new Date(sg.created_at).toLocaleDateString('pt-BR')}</td>
                          <td style={{ padding:'6px 8px' }}>
                            <button
                              className="admin-btn admin-btn-danger"
                              style={{ fontSize:11, padding:'2px 8px' }}
                              onClick={async () => {
                                if (!confirm(`Apagar subgrupo "${sg.name}"? Todas as tarefas do subgrupo serão removidas.`)) return
                                const { error } = await supabase.from('subgroups').delete().eq('id', sg.id)
                                if (error) { showFlash('Erro: ' + error.message); return }
                                showFlash(`Subgrupo "${sg.name}" apagado ✓`)
                                await loadProfiles()
                              }}
                            >
                              Apagar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </section>
        )}
        {/* ── Aba: IPs / Login Logs ── */}
        {activeTab === 'ips' && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">🌐 Logs de acesso (IP) <span className="admin-campus-count">{loginLogs.length}</span></h2>
            {loginLogs.length === 0
              ? <p style={{ fontSize:13, color:'var(--text-muted)', padding:'16px 0' }}>Nenhum login registrado ainda.</p>
              : <div className="admin-turma">
                  <table className="tabela-cartao" style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid var(--border)', textAlign:'left', opacity:0.6 }}>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Quando</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Usuário</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>IP</th>
                        <th style={{ padding:'6px 8px', fontWeight:600 }}>Dispositivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginLogs.map(log => (
                        <tr key={log.id} style={{ borderBottom:'1px solid var(--border)' }}>
                          <td data-rotulo="Quando" style={{ padding:'5px 8px', whiteSpace:'nowrap', opacity:0.6 }}>
                            {new Date(log.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })}{' '}
                            {new Date(log.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                          </td>
                          <td data-rotulo="Usuário" style={{ padding:'5px 8px', fontWeight:600 }}>{log.full_name ?? '—'}</td>
                          <td data-rotulo="IP" style={{ padding:'5px 8px' }}>
                            <code style={{ background:'var(--surface-secondary)', padding:'2px 6px', borderRadius:4 }}>{log.ip ?? '—'}</code>
                          </td>
                          <td data-rotulo="Aparelho" style={{ padding:'5px 8px', opacity:0.6, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {log.user_agent ? log.user_agent.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 60) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            }
          </section>
        )}
        {/* ── Aba: Presença — EXCLUSIVA DO DONO ── */}
        {activeTab === 'presenca' && isOwner && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">
              👁 Presença
              <span className="admin-campus-count">{presOnline.length} online</span>
            </h2>
            <p className="pres-note">
              Só você (dono) enxerga esta aba — a trava está no banco, então admin e moderador
              não conseguem ler estes dados nem por fora do painel. Atualiza sozinho a cada 20s.
            </p>

            {/* Período + busca */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
              {[
                { id:'hoje', label:'Hoje' },
                { id:'7d',   label:'7 dias' },
                { id:'30d',  label:'30 dias' },
              ].map(r => (
                <button key={r.id}
                  onClick={() => { setPresRange(r.id); loadPresence(r.id) }}
                  className={`admin-btn${presRange === r.id ? ' admin-btn-active' : ''}`}
                  style={{ fontSize:12, padding:'5px 12px' }}>
                  {r.label}
                </button>
              ))}
              <button className="admin-btn" style={{ fontSize:12, padding:'5px 12px' }}
                onClick={() => loadPresence()}>
                ↻ Atualizar
              </button>
              <input
                className="admin-search"
                type="search"
                placeholder="Filtrar por nome, IP, cidade, sala…"
                value={presSearch}
                onChange={e => setPresSearch(e.target.value)}
                style={{ flex:'1 1 200px', minWidth:180, margin:0 }}
              />
            </div>

            {/* Números */}
            <div className="pres-grid">
              {[
                { label:'Online agora',            value:presOnline.length,   color:'var(--ok-green)' },
                { label:'Aberturas no período',    value:presFiltradas.length, color:'var(--green-primary)' },
                { label:'Pessoas diferentes',      value:presPessoas,         color:'#2471a3' },
                { label:'Sem estar logado',        value:presVisitas,         color:'var(--orange)' },
                { label:'Tempo médio por acesso',  value:fmtDuracao(presMedia), color:'var(--text-primary)', pequeno:true },
              ].map(c => (
                <div key={c.label} className="pres-stat">
                  <div className="pres-stat-num" style={{ color:c.color, fontSize: c.pequeno ? 19 : undefined }}>{c.value}</div>
                  <div className="pres-stat-label">{c.label}</div>
                </div>
              ))}
            </div>

            {/* Online agora */}
            <div style={{ marginBottom:16 }}>
              <strong style={{ fontSize:14, display:'block', marginBottom:8 }}>
                🟢 Dentro do app agora <span style={{ opacity:0.5 }}>({presOnline.length})</span>
              </strong>
              {presOnline.length === 0
                ? <p style={{ fontSize:13, color:'var(--text-muted)' }}>Ninguém com o app aberto neste instante.</p>
                : <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {presOnline.map(sess => (
                      <div key={sess.id} className="pres-card">
                        <span className="pres-dot" />
                        <div style={{ minWidth:0, flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                            <span className="pres-name">{nomeDaSessao(sess)}</span>
                            <span className={`pres-tag ${sess.role ?? 'visitante'}`}>{sess.role ?? 'visitante'}</span>
                            {sess.class_code && <span className="pres-tag">{sess.class_code}</span>}
                            {sess.is_pwa && <span className="pres-tag">app instalado</span>}
                          </div>
                          <div className="pres-meta">
                            Entrou {fmtHora(sess.started_at)} · {fmtDuracao(agora - new Date(sess.started_at).getTime())} dentro
                            {' · '}{sess.device ?? '—'} / {sess.browser ?? '—'}
                            <br />
                            {localDaSessao(sess)} · <span className="pres-ip">{sess.ip ?? '—'}</span>
                            {sess.entry_path && sess.entry_path !== '/' ? ` · abriu em ${sess.entry_path}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>

            {/* Entradas e saídas */}
            <div style={{ marginBottom:16 }}>
              <strong style={{ fontSize:14, display:'block', marginBottom:8 }}>
                🚪 Entradas e saídas <span style={{ opacity:0.5 }}>({presFiltradas.length})</span>
              </strong>
              {presFiltradas.length === 0
                ? <p style={{ fontSize:13, color:'var(--text-muted)' }}>Nenhum acesso registrado no período.</p>
                : <div className="admin-turma pres-scroll">
                    <table className="pres-table">
                      <thead>
                        <tr>
                          <th>Quem</th>
                          <th>Entrou</th>
                          <th>Saiu</th>
                          <th>Ficou</th>
                          <th>Aparelho</th>
                          <th>Onde</th>
                          <th>IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {presFiltradas.slice(0, 300).map(sess => {
                          const online = isOnline(sess)
                          return (
                            <tr key={sess.id}>
                              <td>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <span className={`pres-dot${online ? '' : ' off'}`} style={{ marginTop:0 }} />
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ fontWeight:700 }}>{nomeDaSessao(sess)}</div>
                                    <div style={{ fontSize:10.5, color:'var(--text-muted)' }}>
                                      {sess.role ?? 'visitante'}{sess.class_code ? ` · ${sess.class_code}` : ''}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td data-rotulo="Entrou" style={{ whiteSpace:'nowrap' }}>
                                {presRange !== 'hoje' && <span style={{ opacity:0.55 }}>{fmtDia(sess.started_at)} </span>}
                                {fmtHora(sess.started_at)}
                              </td>
                              <td data-rotulo="Saiu" style={{ whiteSpace:'nowrap' }}>
                                {online
                                  ? <span style={{ color:'var(--ok-green)', fontWeight:700 }}>ainda dentro</span>
                                  : sess.ended_at
                                    ? <>
                                        {fmtHora(sess.ended_at)}
                                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>{sess.end_reason ?? ''}</div>
                                      </>
                                    : <>
                                        {fmtHora(sess.last_seen_at)}
                                        <div style={{ fontSize:10, color:'var(--text-muted)' }}>último sinal</div>
                                      </>
                                }
                              </td>
                              <td data-rotulo="Ficou" style={{ whiteSpace:'nowrap' }}>{fmtDuracao(duracaoSessao(sess))}</td>
                              <td data-rotulo="Aparelho">
                                {sess.device ?? '—'}
                                <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                  {[sess.os, sess.browser].filter(Boolean).join(' · ')}{sess.is_pwa ? ' · app' : ''}
                                </div>
                              </td>
                              <td data-rotulo="Onde">{localDaSessao(sess)}</td>
                              <td data-rotulo="IP"><span className="pres-ip">{sess.ip ?? '—'}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {presFiltradas.length > 300 && (
                      <p style={{ fontSize:11, color:'var(--text-muted)', padding:'8px 10px' }}>
                        Mostrando os 300 acessos mais recentes de {presFiltradas.length}.
                      </p>
                    )}
                  </div>
              }
            </div>

            {/* Resumo por pessoa */}
            <div>
              <strong style={{ fontSize:14, display:'block', marginBottom:8 }}>
                👤 Por pessoa no período <span style={{ opacity:0.5 }}>({presPorPessoa.length})</span>
              </strong>
              {presPorPessoa.length === 0
                ? <p style={{ fontSize:13, color:'var(--text-muted)' }}>Nada por aqui ainda.</p>
                : <div className="admin-turma pres-scroll">
                    <table className="pres-table">
                      <thead>
                        <tr>
                          <th>Quem</th>
                          <th>Aberturas</th>
                          <th>Tempo total</th>
                          <th>Último acesso</th>
                          <th>Aparelhos</th>
                          <th>IPs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {presPorPessoa.map(item => (
                          <tr key={item.chave}>
                            <td>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <span className={`pres-dot${item.online ? '' : ' off'}`} style={{ marginTop:0 }} />
                                <div>
                                  <div style={{ fontWeight:700 }}>{item.nome}</div>
                                  <div style={{ fontSize:10.5, color:'var(--text-muted)' }}>
                                    {item.papel ?? 'visitante'}{item.sala ? ` · ${item.sala}` : ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td data-rotulo="Aberturas">{item.sessoes}</td>
                            <td data-rotulo="Tempo total" style={{ whiteSpace:'nowrap' }}>{fmtDuracao(item.tempo)}</td>
                            <td data-rotulo="Último" style={{ whiteSpace:'nowrap' }}>{haQuantoTempo(item.ultimo)}</td>
                            <td data-rotulo="Aparelhos">{[...item.dispositivos].join(', ') || '—'}</td>
                            <td data-rotulo="IPs">
                              {[...item.ips].map(ip => (
                                <span key={ip} className="pres-ip" style={{ marginRight:4, display:'inline-block', marginBottom:2 }}>{ip}</span>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
