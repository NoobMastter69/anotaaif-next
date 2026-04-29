'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Gerador de e-mail interno (usado pelo Supabase Auth)
export function nameToEmail(fullName) {
  return (
    fullName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '.')
      .replace(/[^a-z.]/g, '') + '@anotaaif.app'
  )
}

// ── Opções dos dropdowns ──────────────────────────────
const CAMPUS_OPTIONS = [
  'IFSP – Itapetininga',
]

const CURSO_OPTIONS = [
  'Informática',
  'Edificações',
  'Eletromecânica',
]

const ANO_TURMA_OPTIONS = [
  '1º Ano',
  '2º Ano',
  '3º Ano',
  '4º Ano',
  'Outro',
]

async function logSignIn(userId, fullName) {
  try {
    await fetch('/api/log-signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, fullName }),
    })
  } catch {}
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login')

  // Campos comuns
  const [name, setName]         = useState('')
  const [password, setPassword] = useState('')

  // Campos só do cadastro
  const [confirmPassword, setConfirmPassword] = useState('')
  const [contactEmail, setContactEmail]       = useState('')
  const [campus, setCampus]                   = useState('')
  const [curso, setCurso]                     = useState('')
  const [anoTurma, setAnoTurma]               = useState('')
  const [classCode, setClassCode]             = useState('')
  const [joiningRoom, setJoiningRoom]         = useState(null) // { ano_turma, curso } da sala encontrada

  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [newRoomCode, setNewRoomCode]                   = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [resetEmail, setResetEmail]                     = useState('')
  const [resetSent, setResetSent]                       = useState(false)
  const resetInFlight = useRef(false)

  // Lê ?join=CODE da URL e pré-preenche o código de sala
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const join = params.get('join')
    if (join) {
      setClassCode(join.toUpperCase())
      setMode('register')
    }
  }, [])

  // Quando usuário digita um código, verifica se sala existe (via API server-side)
  useEffect(() => {
    if (!classCode.trim() || classCode.trim().length < 4) { setJoiningRoom(null); return }
    const code = classCode.trim().toUpperCase()
    fetch(`/api/check-room?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(({ room }) => setJoiningRoom(room ?? null))
      .catch(() => setJoiningRoom(null))
  }, [classCode])

  function switchMode(m) {
    setMode(m)
    setError('')
    setPassword('')
    setConfirmPassword('')
    setForgotMode(false)
    setResetSent(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (resetInFlight.current) return
    const email = resetEmail.trim()
    if (!email) return
    resetInFlight.current = true
    setLoading(true)
    try {
      await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          origin: typeof window !== 'undefined' ? window.location.origin : 'https://anotaaif-next.vercel.app',
        }),
      })
      setResetSent(true)
    } catch {
      setError('Não foi possível enviar o e-mail. Tente novamente.')
      resetInFlight.current = false
    } finally {
      setLoading(false)
    }
  }

  // ── Validações ────────────────────────────────────────
  function validate() {
    if (name.trim().length < 3) {
      setError('Digite seu nome completo (mín. 3 caracteres).')
      return false
    }
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return false
    }
    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('As senhas não coincidem.')
        return false
      }
      if (!campus) {
        setError('Selecione o campus.')
        return false
      }
      if (!curso) {
        setError('Selecione o curso.')
        return false
      }
      if (!anoTurma) {
        setError('Selecione o ano/turma.')
        return false
      }
      // código é opcional — se vazio, vai ser gerado automaticamente
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(contactEmail.trim())) {
        setError('Digite um e-mail válido para receber notificações.')
        return false
      }
      const disposableDomains = ['mailinator.com','guerrillamail.com','tempmail.com','temp-mail.org','throwam.com','sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info','guerrillamail.biz','guerrillamail.de','guerrillamail.net','guerrillamail.org','spam4.me','yopmail.com','yopmail.fr','cool.fr.nf','jetable.fr.nf','nospam.ze.tc','nomail.xl.cx','mega.zik.dj','speed.1s.fr','courriel.fr.nf','moncourrier.fr.nf','monemail.fr.nf','monmail.fr.nf','trashmail.at','trashmail.com','trashmail.io','trashmail.me','trashmail.net','discard.email','discardmail.com','discardmail.de','spamgourmet.com','spamgourmet.net','spamgourmet.org','mailnull.com','spamcorptastic.com','spamday.com','spamdecoy.net','spamfree24.de','spamfree24.eu','spamfree24.info','spamfree24.net','spamfree24.org','spamgoes.in','spamhereplease.com','spamhole.com','spamify.com','spaminator.de','spamoff.de','maildrop.cc','mailnesia.com','mailnull.com','spamfighter.cf','spamfighter.ga','spamfighter.gq','spamfighter.ml','spamfighter.tk','10minutemail.com','10minutemail.net','10minemail.com','20minutemail.com','mohmal.com','mintemail.com','nyspring.com','sharklasers.com','getairmail.com','filzmail.com','throwam.com','fakemail.net','fakeinbox.com','fakeinbox.org','spambox.us','mailexpire.com','dispostable.com','crapmail.org']
      const emailDomain = contactEmail.trim().split('@')[1]?.toLowerCase()
      if (disposableDomains.includes(emailDomain)) {
        setError('Use um e-mail real (Gmail, Hotmail, escolar, etc.). Emails temporários não são permitidos.')
        return false
      }
    }
    return true
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!validate()) return

    setLoading(true)

    // Login: aceita nome OU email real (compatibilidade com contas antigas)
    // Cadastro: usa o email real digitado
    const authEmail = mode === 'register'
      ? contactEmail.trim()
      : (name.trim().includes('@') ? name.trim() : nameToEmail(name.trim()))

    // Resolve o código da sala via API server-side (evita 401 por RLS anon)
    let code = ''
    let isNewRoom = false

    try {
      const res = await fetch('/api/check-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          classCode.trim()
            ? { class_code: classCode.trim().toUpperCase() }
            : { campus, curso, ano_turma: anoTurma }
        ),
      })
      const result = await res.json()

      if (classCode.trim()) {
        if (!result.room) {
          setError('Código de sala não encontrado. Verifique com quem te convidou.')
          setLoading(false)
          return
        }
        code = result.room.class_code
      } else {
        code = result.room?.class_code ?? ''
        isNewRoom = !!result.isNew
      }
    } catch {
      setError('Erro ao verificar sala. Tente novamente.')
      setLoading(false)
      return
    }

    try {
      if (mode === 'register') {
        const { data, error: err } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (err) throw err

        let activeUser = data.user
        if (!data.session) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email: authEmail, password })
          if (signInErr) throw signInErr
          activeUser = signInData.user
        }

        const { error: profileErr } = await supabase.from('profiles').insert({
          id:            activeUser.id,
          full_name:     name.trim(),
          contact_email: authEmail,
          campus,
          curso,
          ano_turma:     anoTurma,
          class_code:    code,
          is_moderator:  isNewRoom,
          is_admin:      false,
        })
        if (profileErr) throw profileErr

        if (isNewRoom) {
          setNewRoomCode(code)
          setLoading(false)
          return
        }

        const displayName = activeUser?.user_metadata?.full_name ?? name.trim()
        await logSignIn(activeUser.id, displayName)
        onAuth(activeUser, displayName)
      } else {
        // Tenta login com nameToEmail primeiro; se falhar, busca o email real do perfil
        let loginData = null
        const { data: d1, error: e1 } = await supabase.auth.signInWithPassword({ email: authEmail, password })
        if (e1 && !name.trim().includes('@')) {
          // Fallback: busca o contact_email real pelo nome (suporta emails institucionais)
          try {
            const res = await fetch('/api/resolve-login-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fullName: name.trim() }),
            })
            const { email: realEmail } = await res.json()
            if (realEmail && realEmail !== authEmail) {
              const { data: d2, error: e2 } = await supabase.auth.signInWithPassword({ email: realEmail, password })
              if (e2) throw e2
              loginData = d2
            } else {
              throw e1
            }
          } catch (lookupErr) {
            throw lookupErr?.message ? lookupErr : e1
          }
        } else {
          if (e1) throw e1
          loginData = d1
        }
        const displayName = loginData.user?.user_metadata?.full_name ?? name.trim()
        await logSignIn(loginData.user.id, displayName)
        onAuth(loginData.user, displayName)
      }
    } catch (err) {
      console.error('Auth error:', err)
      const msg = err.message ?? ''
      if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) {
        setError('E-mail/nome ou senha incorretos.')
      } else if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
        setError('Este e-mail já está cadastrado. Clique em "Entrar".')
      } else if (msg.includes('not confirmed') || msg.includes('Email not confirmed')) {
        setError('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.')
      } else {
        setError(msg || 'Algo deu errado. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    // Destrancando a altura da tela principal
    <div className="auth-screen" style={{ minHeight: '100vh', height: 'auto', overflowY: 'auto' }}>
      
      <div className="auth-bg" aria-hidden="true" style={{ position: 'fixed' }}>
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
      </div>

      {/* Destrancando a altura do Card branco */}
      <div className="auth-card" style={{ margin: '20px auto', height: 'auto', maxHeight: 'none' }}>

        <div className="auth-panel-left" aria-hidden="true">
          <div className="auth-panel-logo-wrap">
            <img src="/icons/anotaAIF.jpg" alt="Anota AIF!" className="auth-panel-logo-img" />
          </div>
          <h2 className="auth-panel-title">Anota AIF!</h2>
          <p className="auth-panel-sub">Organização escolar do IF</p>
          <ul className="auth-panel-features">
            <li>Provas e atividades da turma</li>
            <li>Calendário acadêmico do IF</li>
            <li>Alertas de prazo em tempo real</li>
          </ul>
          <p className="auth-panel-footer">Feito para a galera do IF gente boa 👍</p>
        </div>

        {/* OPÇÃO NUCLEAR: Forçando a rolagem apenas dentro do formulário e dando espaço no final */}
        <div className="auth-panel-right" style={{ maxHeight: '90vh', overflowY: 'auto', paddingBottom: '80px', WebkitOverflowScrolling: 'touch' }}>
        
        <div className="auth-logo-wrap auth-logo-mobile" aria-hidden="true">
          <div className="auth-logo-icon-wrap">
            <img src="/icons/anotaAIF.jpg" alt="Anota AIF!" className="auth-logo-img-real" />
          </div>
          <div>
            <h1 className="auth-app-name">Anota AIF!</h1>
            <p className="auth-app-sub">Organização escolar do IF</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            role="tab" aria-selected={mode === 'login'}
            onClick={() => switchMode('login')} type="button"
            style={{ flex: 1, whiteSpace: 'nowrap' }}
          >
            Entrar
          </button>
          <button
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            role="tab" aria-selected={mode === 'register'}
            onClick={() => switchMode('register')} type="button"
            style={{ flex: 1, whiteSpace: 'nowrap' }}
          >
            Criar conta
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>

          <div className="auth-field">
            <label htmlFor="auth-name">
              {mode === 'login' ? 'Nome completo ou E-mail' : 'Nome completo'}
            </label>
            <input
              id="auth-name" type="text"
              placeholder={mode === 'login' ? 'Ex: Ed Carlos Xavier ou ed@gmail.com' : 'Ex: Ed Carlos Xavier'}
              value={name} onChange={e => setName(e.target.value)}
              autoComplete={mode === 'login' ? 'username email' : 'name'} autoFocus disabled={loading}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Senha</label>
            <input
              id="auth-password" type="password"
              placeholder="Mínimo 6 caracteres"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              disabled={loading}
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="auth-field">
                <label htmlFor="auth-confirm">Confirmar senha</label>
                <input
                  id="auth-confirm" type="password"
                  placeholder="Repita a senha"
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password" disabled={loading}
                />
              </div>

              <div className="auth-field">
                <label htmlFor="auth-email">
                  E-mail <span className="auth-required">*</span>
                </label>
                <input
                  id="auth-email" type="email"
                  placeholder="Ex: joao@email.com"
                  value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                  autoComplete="email" disabled={loading}
                />
                <span className="auth-hint">Usado para confirmar sua conta e receber notificações</span>
              </div>

              <div className="auth-row-2">
                <div className="auth-field">
                  <label htmlFor="auth-campus">Campus</label>
                  <select
                    id="auth-campus"
                    className={`auth-select${!campus && error ? ' error' : ''}`}
                    value={campus} onChange={e => setCampus(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Selecione…</option>
                    {CAMPUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    <option disabled>— Outros campus: talvez mais pra frente :)</option>
                  </select>
                </div>

                <div className="auth-field">
                  <label htmlFor="auth-curso">Curso</label>
                  <select
                    id="auth-curso"
                    className={`auth-select${!curso && error ? ' error' : ''}`}
                    value={curso} onChange={e => setCurso(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Selecione…</option>
                    {CURSO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              <div className="auth-row-2">
                <div className="auth-field">
                  <label htmlFor="auth-ano">Ano / Turma</label>
                  <select
                    id="auth-ano"
                    className={`auth-select${!anoTurma && error ? ' error' : ''}`}
                    value={anoTurma} onChange={e => setAnoTurma(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Selecione…</option>
                    {ANO_TURMA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                <div className="auth-field">
                  <label htmlFor="auth-classcode">Código da Turma</label>
                  <input
                    id="auth-classcode" type="text"
                    placeholder="Deixe vazio para criar sala nova"
                    value={classCode}
                    onChange={e => setClassCode(e.target.value.toUpperCase())}
                    maxLength={20}
                    autoComplete="off" disabled={loading}
                  />
                  {joiningRoom ? (
                    <span className="auth-hint" style={{ color: '#00843D', fontWeight: 600 }}>
                      ✓ Sala encontrada: {joiningRoom.ano_turma} · {joiningRoom.curso}
                    </span>
                  ) : classCode.trim() ? (
                    <span className="auth-hint" style={{ color: '#e67e22' }}>Verificando código…</span>
                  ) : (
                    <span className="auth-hint">Se sua sala ainda não tem ninguém, a chave será gerada quando você se cadastrar</span>
                  )}
                </div>
              </div>
            </>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          {newRoomCode ? (
            <div className="auth-new-room">
              <p className="auth-new-room-title">✓ Conta criada! Sua sala foi gerada.</p>
              <p className="auth-new-room-label">Código da turma:</p>
              <div className="auth-new-room-code">{newRoomCode}</div>
              <p className="auth-new-room-hint">Compartilhe com sua turma. Você é o moderador da sala.</p>
              <button
                type="button"
                className="auth-submit"
                onClick={() => {
                  supabase.auth.signInWithPassword({ email: contactEmail.trim(), password }).then(async ({ data }) => {
                    if (data?.user) {
                      const displayName = data.user?.user_metadata?.full_name ?? name.trim()
                      await logSignIn(data.user.id, displayName)
                      onAuth(data.user, displayName)
                    }
                  })
                }}
              >
                Entrar no App →
              </button>
            </div>
          ) : forgotMode ? (
            /* ── Tela de esqueci a senha ── */
            <div>
              {resetSent ? (
                <div className="auth-new-room">
                  <p className="auth-new-room-title">📧 Link enviado!</p>
                  <p className="auth-new-room-hint">Verifique sua caixa de entrada (e o spam). Clique no link para redefinir a senha.</p>
                  <button type="button" className="auth-submit" onClick={() => { setForgotMode(false); setResetSent(false) }}>
                    Voltar ao login →
                  </button>
                </div>
              ) : (
                <>
                  <div className="auth-field" style={{ marginTop: 8 }}>
                    <label htmlFor="reset-email">Seu e-mail cadastrado</label>
                    <input
                      id="reset-email" type="email"
                      placeholder="Ex: joao@gmail.com"
                      value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                      autoComplete="email" autoFocus disabled={loading}
                    />
                  </div>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button
                    type="button"
                    className="auth-submit"
                    disabled={loading || !resetEmail.trim()}
                    style={{ minHeight: 48, marginTop: 12 }}
                    onClick={handleForgotPassword}
                  >
                    {loading ? 'Enviando…' : 'Enviar link de redefinição'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setForgotMode(false); setError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 8, width: '100%' }}
                  >
                    ← Voltar
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <button
                type="submit"
                className="auth-submit"
                disabled={loading}
                style={{ whiteSpace: 'nowrap', minHeight: '48px', marginTop: '15px' }}
              >
                {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setError(''); setResetEmail('') }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginTop: 10, width: '100%' }}
                >
                  Esqueceu sua senha?
                </button>
              )}
            </>
          )}
        </form>
        </div>
      </div>

      <p className="auth-footer auth-footer-mobile" style={{ paddingBottom: '30px' }}>Feito para a galera do IF gente boa 👍</p>
    </div>
  )
}