'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

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
  // Grupos de ódio / termos ofensivos
  'nazista','nazi','nazismo','fascista','kkk','ku klux',
].map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))

const BLOCKED_PHRASES = [
  'bin laden','ku klux','adolf hitler','pol pot','idi amin',
].map(p => p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))

function hasProfanity(str) {
  const n = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  if (BLOCKED_PHRASES.some(p => n.includes(p))) return true
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

  // Reset de senha
  const [resetMode, setResetMode]         = useState(false)
  const [newPassword, setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetSaving, setResetSaving]     = useState(false)
  const [resetError, setResetError]       = useState('')
  const [resetSuccess, setResetSuccess]   = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/'); return }
      setUser(session.user)
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      setProfile(data)
      setName(data?.full_name ?? session.user.user_metadata?.full_name ?? '')
      setLoading(false)
    })

    // Detecta quando o Supabase processa o token de recuperação de senha
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setResetMode(true)
        setLoading(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleResetPassword(e) {
    e.preventDefault()
    setResetError('')
    if (newPassword.length < 6) { setResetError('A senha deve ter pelo menos 6 caracteres.'); return }
    if (newPassword !== confirmPassword) { setResetError('As senhas não coincidem.'); return }
    setResetSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setResetSaving(false)
    if (err) { setResetError(err.message); return }
    setResetSuccess(true)
    setTimeout(() => { setResetMode(false); setResetSuccess(false); setNewPassword(''); setConfirmPassword('') }, 3000)
  }

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
    supabase.from('audit_logs').insert({
      user_id: user.id,
      user_name: trimmed,
      action: 'name_changed',
      details: { name: trimmed },
      class_code: profile?.class_code ?? null,
    }).catch(() => {})
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

  if (resetMode) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F4F6F4', padding:'24px' }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'32px 28px', maxWidth:400, width:'100%', boxShadow:'0 2px 16px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:8 }}>🔐</div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700, color:'#111' }}>Nova senha</h1>
          <p style={{ margin:'8px 0 0', fontSize:14, color:'#777' }}>Digite sua nova senha abaixo.</p>
        </div>
        {resetSuccess ? (
          <div style={{ textAlign:'center', padding:'16px 0' }}>
            <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
            <p style={{ fontWeight:700, color:'#00843D', margin:0 }}>Senha atualizada com sucesso!</p>
            <p style={{ fontSize:13, color:'#777', marginTop:6 }}>Redirecionando…</p>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} noValidate>
            <div style={{ marginBottom:16 }}>
              <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#444', marginBottom:6 }}>Nova senha</label>
              <input
                type="password" placeholder="Mínimo 6 caracteres"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #ddd', borderRadius:10, fontSize:14, boxSizing:'border-box' }}
                autoFocus
              />
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#444', marginBottom:6 }}>Confirmar senha</label>
              <input
                type="password" placeholder="Repita a senha"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #ddd', borderRadius:10, fontSize:14, boxSizing:'border-box' }}
              />
            </div>
            {resetError && <p style={{ color:'#e74c3c', fontSize:13, margin:'0 0 12px' }}>{resetError}</p>}
            <button
              type="submit" disabled={resetSaving}
              style={{ width:'100%', background:'#00843D', color:'#fff', border:'none', borderRadius:10, padding:'13px', fontSize:15, fontWeight:700, cursor:'pointer' }}
            >
              {resetSaving ? 'Salvando…' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
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
