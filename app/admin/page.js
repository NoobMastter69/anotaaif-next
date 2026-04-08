'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

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
  const [activeTab, setActiveTab]     = useState('overview')  // 'overview' | 'feedback' | 'logs' | 'subgroups'
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [flash, setFlash]             = useState('')
  const [authError, setAuthError]     = useState('')

  async function loadProfiles() {
    const [{ data, error }, { data: sug }, { data: rms }, { data: fbs }, { data: logs }, { data: sgs }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, campus, curso, ano_turma, class_code, is_admin, is_moderator, kick_requested, created_at').order('campus'),
      supabase.from('task_suggestions').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('rooms').select('*').order('campus'),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('subgroups').select('*, subgroup_members(count)').order('created_at', { ascending: false }),
    ])
    if (error) setAuthError('Erro ao carregar perfis: ' + error.message)
    setProfiles(data ?? [])
    setSuggestions(sug ?? [])
    setRooms(rms ?? [])
    setFeedbacks(fbs ?? [])
    setAuditLogs(logs ?? [])
    setSubgroups(sgs ?? [])
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
      await loadProfiles()
      setLoading(false)
    })
  }, [])

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

  async function testPush() {
    showFlash('Enviando notificação de teste…')
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test', class_code: 'A8Y9Z6PW' }),
    })
    const data = await res.json()
    showFlash(data.log?.[0] ?? 'Enviado! Verifique o celular.')
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

  if (loading) return <div className="admin-loading">Carregando painel…</div>
  if (authError) return (
    <div className="admin-loading" style={{ flexDirection:'column', gap:12, padding:24, textAlign:'center' }}>
      <strong style={{ color:'#c0392b' }}>Erro de acesso</strong>
      <code style={{ fontSize:13, background:'#f5f5f5', padding:'8px 12px', borderRadius:8, display:'block', wordBreak:'break-all' }}>{authError}</code>
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
          <span className="admin-count">{profiles.length} alunos</span>
        </div>
      </header>

      {flash && <div className="admin-flash">{flash}</div>}

      {/* Abas */}
      <div style={{ display:'flex', gap:4, padding:'8px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        {[
          { id:'overview', label:'📊 Visão Geral' },
          { id:'feedback', label:`💬 Feedback${feedbacks.length ? ` (${feedbacks.length})` : ''}` },
          { id:'logs',     label:'📋 Registros' },
          { id:'subgroups',label:`🔵 Subgrupos${subgroups.length ? ` (${subgroups.length})` : ''}` },
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
        <button
          className="admin-btn admin-btn-active"
          style={{ marginBottom: 12, width: '100%', padding: '10px', fontSize: 13 }}
          onClick={testPush}
        >
          🔔 Testar notificação push (sala A8Y9Z6PW)
        </button>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
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
                      <tr key={r.class_code} style={{ borderBottom: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                            {r.class_code}
                          </code>
                        </td>
                        <td style={{ padding: '6px 8px' }}>{r.ano_turma} · {r.curso}</td>
                        <td style={{ padding: '6px 8px', opacity: 0.7 }}>{r.campus?.replace('IFSP – ', '')}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>{count}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <button
                            className="admin-btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => copyInvite(r.class_code)}
                          >
                            {copiedInvite === r.class_code ? '✓' : '🔗'}
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
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
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
                  <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f0' }}>
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
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid #eee', textAlign:'left', opacity:0.6 }}>
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
                          <tr key={log.id} style={{ borderBottom:'1px solid #f5f5f5' }}>
                            <td style={{ padding:'5px 8px', whiteSpace:'nowrap', opacity:0.6 }}>
                              {new Date(log.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })} {new Date(log.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                            </td>
                            <td style={{ padding:'5px 8px', fontWeight:600 }}>{log.user_name ?? '—'}</td>
                            <td style={{ padding:'5px 8px' }}>{actionLabels[log.action] ?? log.action}</td>
                            <td style={{ padding:'5px 8px', opacity:0.7 }}>
                              {log.details?.subject && <span>"{log.details.subject}"</span>}
                              {log.details?.name && <span>"{log.details.name}"</span>}
                              {log.details?.subgroup && <span>subgrupo: {log.details.subgroup}</span>}
                              {log.class_code && <span style={{ marginLeft:6, fontSize:11, background:'#f0f0f0', padding:'1px 5px', borderRadius:4 }}>{log.class_code}</span>}
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
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid #eee', textAlign:'left', opacity:0.6 }}>
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
                        <tr key={sg.id} style={{ borderBottom:'1px solid #f5f5f5' }}>
                          <td style={{ padding:'6px 8px', fontWeight:600 }}>{sg.name}</td>
                          <td style={{ padding:'6px 8px' }}><code style={{ background:'#f0f0f0', padding:'2px 5px', borderRadius:4 }}>{sg.class_code}</code></td>
                          <td style={{ padding:'6px 8px', textAlign:'center' }}>{sg.subgroup_members?.[0]?.count ?? 0}</td>
                          <td style={{ padding:'6px 8px' }}><code style={{ fontWeight:700 }}>{sg.invite_code}</code></td>
                          <td style={{ padding:'6px 8px', opacity:0.6 }}>{new Date(sg.created_at).toLocaleDateString('pt-BR')}</td>
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
      </main>
    </div>
  )
}
