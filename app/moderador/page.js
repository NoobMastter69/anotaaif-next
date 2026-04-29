'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function ModeradorPage() {
  const router = useRouter()
  const [profile, setProfile]         = useState(null)
  const [members, setMembers]         = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [flash, setFlash]             = useState('')
  const [copiedCode, setCopiedCode]   = useState(false)

  function showFlash(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  async function load(me) {
    const [{ data: mem }, { data: sug }] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, ano_turma, curso, kick_requested')
        .eq('class_code', me.class_code)
        .order('full_name'),
      supabase.from('task_suggestions')
        .select('*')
        .eq('class_code', me.class_code)
        .eq('status', 'pending')
        .order('created_at'),
    ])
    setMembers(mem ?? [])
    setSuggestions(sug ?? [])
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/'); return }
      const { data: me } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (!me?.is_moderator && !me?.is_admin) { router.push('/'); return }
      setProfile(me)
      await load(me)
      setLoading(false)
    })
  }, [])

  async function requestKick(member) {
    if (!confirm(`Solicitar saída de ${member.full_name}? O admin será notificado.`)) return
    await supabase.from('profiles').update({ kick_requested: true }).eq('id', member.id)
    showFlash(`Solicitação enviada para ${member.full_name}`)
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notify-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'kick', target_name: member.full_name, requested_by: profile.full_name }),
    }).catch(() => {})
    await load(profile)
  }

  async function cancelKick(member) {
    await supabase.from('profiles').update({ kick_requested: false }).eq('id', member.id)
    showFlash('Solicitação cancelada')
    await load(profile)
  }

  async function approveSuggestion(sug) {
    // Cria a tarefa de verdade
    const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    await supabase.from('tasks').insert({
      id,
      type: sug.type,
      subject: sug.subject,
      description: sug.description ?? '',
      due_date: sug.due_date,
      done: false,
      class_code: sug.class_code,
      created_by: profile.id,
    })
    await supabase.from('task_suggestions').update({ status: 'approved' }).eq('id', sug.id)
    showFlash(`Tarefa "${sug.subject}" criada!`)
    await load(profile)
  }

  async function rejectSuggestion(sug) {
    await supabase.from('task_suggestions').update({ status: 'rejected' }).eq('id', sug.id)
    showFlash('Sugestão rejeitada')
    await load(profile)
  }

  function copyCode() {
    navigator.clipboard.writeText(profile.class_code).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    })
  }

  if (loading) return <div className="admin-loading">Carregando…</div>

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-inner">
          <button className="admin-back" onClick={() => router.push('/')} aria-label="Voltar">
            <svg viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            Voltar
          </button>
          <h1 className="admin-title">Moderador</h1>
          <span className="admin-count">{members.length} alunos</span>
        </div>
      </header>

      {flash && <div className="admin-flash">{flash}</div>}

      <main className="admin-main">

        {/* Código da sala (só leitura) */}
        <section className="admin-campus-section">
          <h2 className="admin-campus-title">Código da sala</h2>
          <div className="admin-turma">
            <div className="admin-turma-header" style={{ gap: 12 }}>
              <span className="admin-turma-code" style={{ fontSize: 22 }}>{profile.class_code}</span>
              <button className="admin-btn admin-btn-active" onClick={copyCode}>
                {copiedCode ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>
            <p style={{ margin: '8px 12px', fontSize: 13, opacity: 0.7 }}>
              Compartilhe esse código com os alunos da sua sala para eles entrarem.
            </p>
          </div>
        </section>

        {/* Sugestões pendentes */}
        {suggestions.length > 0 && (
          <section className="admin-campus-section">
            <h2 className="admin-campus-title">
              Sugestões de tarefas
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
                  </div>
                  {sug.description && <p style={{ margin: '4px 0', fontSize: 13, opacity: 0.8 }}>{sug.description}</p>}
                  <p style={{ margin: '4px 0', fontSize: 12, opacity: 0.6 }}>
                    Solicitado por: {sug.suggested_by_name ?? 'Aluno'} · {sug.due_date ? new Date(sug.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'sem data'}
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

        {/* Membros da sala */}
        <section className="admin-campus-section">
          <h2 className="admin-campus-title">
            Membros — {profile.ano_turma} · {profile.curso}
          </h2>
          <div className="admin-turma">
            <ul className="admin-student-list">
              {members.map(m => (
                <li key={m.id} className="admin-student-item">
                  <span className="admin-student-name">{m.full_name}</span>
                  <div className="admin-student-badges">
                    {m.kick_requested && <span className="admin-badge-kick">⚠ saída solicitada</span>}
                  </div>
                  {m.id !== profile.id && (
                    <div className="admin-student-actions">
                      {m.kick_requested
                        ? <button className="admin-btn" onClick={() => cancelKick(m)}>Cancelar</button>
                        : <button className="admin-btn admin-btn-danger" onClick={() => requestKick(m)}>Solicitar saída</button>
                      }
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

      </main>
    </div>
  )
}
