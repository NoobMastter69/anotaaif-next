'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

const BLOCKED = [
  'porra','caralho','puta','viado','buceta','cu','merda','foda','fodase',
  'cuzão','arrombado','arrombada','otário','otaria','vagabundo','vagabunda',
  'piranha','cacete','desgraça','desgraçado','filhadaputa','fdp','vsf',
  'vtnc','tnc','pnc','corno','corna','babaca','idiota','imbecil','retardado',
  'fuck','shit','ass','bitch','nigga','faggot','dick','pussy','cunt',
].map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))

function hasProfanity(str) {
  const n = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  return BLOCKED.some(w => new RegExp(`\\b${w}\\b`).test(n))
}

export default function PerfilPage() {
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [user, setUser]       = useState(null)
  const [name, setName]       = useState('')
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [copied, setCopied]   = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/'); return }
      setUser(session.user)
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(data)
      setName(data?.full_name ?? session.user.user_metadata?.full_name ?? '')
      setLoading(false)
    })
  }, [])

  async function handleSave() {
    const trimmed = name.trim()
    if (trimmed.length < 2) { setError('Mínimo 2 caracteres.'); return }
    if (trimmed.length > 40) { setError('Máximo 40 caracteres.'); return }
    if (hasProfanity(trimmed)) { setError('Nome contém palavras não permitidas.'); return }

    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('profiles').update({ full_name: trimmed }).eq('id', user.id)
    if (err) { setError('Erro ao salvar. Tente novamente.'); setSaving(false); return }
    await supabase.auth.updateUser({ data: { full_name: trimmed } })
    setSaving(false)
    setSuccess('Nome atualizado! ✓')
    setTimeout(() => setSuccess(''), 3000)
  }

  async function copyCode() {
    if (!profile?.class_code) return
    await navigator.clipboard.writeText(profile.class_code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const initial = (profile?.full_name ?? name ?? '?')[0]?.toUpperCase()

  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F4F6F4' }}>
      <p style={{ color:'#9AAA98' }}>Carregando…</p>
    </div>
  )

  return (
    <div className="perfil-page">
      {/* Header */}
      <header className="perfil-header">
        <button className="perfil-back" onClick={() => router.push('/')} aria-label="Voltar">
          <svg viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
          Voltar
        </button>
        <h1 className="perfil-title">Meu Perfil</h1>
        <span />
      </header>

      <main className="perfil-main">
        {/* Avatar */}
        <div className="perfil-avatar">{initial}</div>

        {/* Card: Apelido */}
        <section className="perfil-card">
          <h2 className="perfil-card-title">Apelido</h2>
          <p className="perfil-card-hint">Esse é o nome que aparece para seus colegas de turma.</p>
          <input
            className="perfil-input"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); setSuccess('') }}
            maxLength={40}
            placeholder="Seu apelido"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:6 }}>
            <span style={{ fontSize:12, color: error ? '#e74c3c' : success ? '#00843D' : '#9AAA98' }}>
              {error || success || `${name.length}/40`}
            </span>
          </div>
          <button
            className="perfil-save-btn"
            onClick={handleSave}
            disabled={saving || name.trim() === (profile?.full_name ?? '')}
          >
            {saving ? 'Salvando…' : 'Salvar nome'}
          </button>
        </section>

        {/* Card: Turma */}
        <section className="perfil-card">
          <h2 className="perfil-card-title">Turma</h2>
          <div className="perfil-info-row">
            <span className="perfil-info-label">Campus</span>
            <span className="perfil-info-value">{profile?.campus ?? '—'}</span>
          </div>
          <div className="perfil-info-row">
            <span className="perfil-info-label">Curso</span>
            <span className="perfil-info-value">{profile?.curso ?? '—'}</span>
          </div>
          <div className="perfil-info-row">
            <span className="perfil-info-label">Ano</span>
            <span className="perfil-info-value">{profile?.ano_turma ?? '—'}</span>
          </div>
          <div className="perfil-info-row" style={{ marginTop: 8 }}>
            <span className="perfil-info-label">Código da sala</span>
            <button className="perfil-code-btn" onClick={copyCode}>
              <code>{profile?.class_code ?? '—'}</code>
              <span>{copied ? '✓' : '📋'}</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
