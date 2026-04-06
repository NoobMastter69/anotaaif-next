'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function AdminPage() {
  const router = useRouter()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/'); return }

      // Verifica se é admin
      const { data: me } = await supabase
        .from('profiles').select('is_admin').eq('id', session.user.id).single()
      if (!me?.is_admin) { router.push('/'); return }

      // Carrega todos os perfis (admin vê tudo via policy futura — por ora usa service role via RLS relaxada)
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, campus, curso, ano_turma, class_code, is_admin, created_at')
        .order('campus')
      setProfiles(data ?? [])
      setLoading(false)
    })
  }, [])

  const filtered = profiles.filter(p => {
    const q = search.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.campus?.toLowerCase().includes(q) ||
      p.class_code?.toLowerCase().includes(q)
    )
  })

  // Agrupa por campus
  const byCampus = {}
  filtered.forEach(p => {
    const key = p.campus ?? 'Sem campus'
    if (!byCampus[key]) byCampus[key] = []
    byCampus[key].push(p)
  })

  if (loading) return (
    <div className="admin-loading">Carregando painel…</div>
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

      <main className="admin-main">
        <input
          className="admin-search"
          type="search"
          placeholder="Buscar por nome, campus ou código…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {Object.entries(byCampus).map(([campus, students]) => (
          <section key={campus} className="admin-campus-section">
            <h2 className="admin-campus-title">
              {campus}
              <span className="admin-campus-count">{students.length}</span>
            </h2>

            {/* Agrupa por código/turma dentro do campus */}
            {Object.entries(
              students.reduce((acc, s) => {
                const k = s.class_code ?? '—'
                if (!acc[k]) acc[k] = []
                acc[k].push(s)
                return acc
              }, {})
            ).map(([code, members]) => (
              <div key={code} className="admin-turma">
                <div className="admin-turma-header">
                  <span className="admin-turma-code">{code}</span>
                  <span className="admin-turma-meta">
                    {members[0]?.ano_turma} · {members[0]?.curso}
                  </span>
                  <span className="admin-turma-count">{members.length} membros</span>
                </div>
                <ul className="admin-student-list">
                  {members.map(s => (
                    <li key={s.id} className="admin-student-item">
                      <span className="admin-student-name">{s.full_name}</span>
                      {s.is_admin && <span className="admin-badge-admin">admin</span>}
                      <span className="admin-student-date">
                        {new Date(s.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}

        {filtered.length === 0 && (
          <p className="admin-empty">Nenhum resultado encontrado.</p>
        )}
      </main>
    </div>
  )
}
