'use client'

import { useState, useEffect } from 'react'
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

  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [newRoomCode, setNewRoomCode] = useState('')

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

  // Quando usuário digita um código, verifica se sala existe
  useEffect(() => {
    if (!classCode.trim() || classCode.trim().length < 4) { setJoiningRoom(null); return }
    const code = classCode.trim().toUpperCase()
    supabase.from('rooms').select('ano_turma, curso, campus').eq('class_code', code).maybeSingle()
      .then(({ data }) => setJoiningRoom(data ?? null))
  }, [classCode])

  function switchMode(m) {
    setMode(m)
    setError('')
    setPassword('')
    setConfirmPassword('')
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
    }
    return true
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!validate()) return

    setLoading(true)
    const email = nameToEmail(name.trim())

    // Resolve o código da sala
    let code = ''
    let isNewRoom = false

    if (classCode.trim()) {
      // Usuário informou um código — verifica se existe
      code = classCode.trim().toUpperCase()
      const { data: existingRoom } = await supabase.from('rooms').select('class_code').eq('class_code', code).maybeSingle()
      if (!existingRoom) {
        setError('Código de sala não encontrado. Verifique com quem te convidou.')
        setLoading(false)
        return
      }
    } else {
      // Sem código: tenta encontrar sala existente para (campus, curso, ano_turma)
      const { data: existingRoom } = await supabase.from('rooms')
        .select('class_code')
        .eq('campus', campus)
        .eq('curso', curso)
        .eq('ano_turma', anoTurma)
        .maybeSingle()

      if (existingRoom) {
        // Sala já existe — entra nela
        code = existingRoom.class_code
        isNewRoom = false
      } else {
        // Cria nova sala — o aluno vira admin da sala
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
        const { error: roomErr } = await supabase.from('rooms').insert({ class_code: code, campus, curso, ano_turma: anoTurma })
        if (roomErr) {
          // Race condition: outra pessoa criou agora — busca novamente
          const { data: raceRoom } = await supabase.from('rooms').select('class_code').eq('campus', campus).eq('curso', curso).eq('ano_turma', anoTurma).maybeSingle()
          code = raceRoom?.class_code ?? code
        }
        isNewRoom = true
      }
    }

    try {
      if (mode === 'register') {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (err) throw err

        let activeUser = data.user
        if (!data.session) {
          const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
          if (signInErr) throw signInErr
          activeUser = signInData.user
        }

        const { error: profileErr } = await supabase.from('profiles').insert({
          id:            activeUser.id,
          full_name:     name.trim(),
          contact_email: contactEmail.trim() || null,
          campus,
          curso,
          ano_turma:     anoTurma,
          class_code:    code,
          is_admin:      isNewRoom,
        })
        if (profileErr) throw profileErr

        if (isNewRoom) {
          setNewRoomCode(code)
          setLoading(false)
          return
        }

        const displayName = activeUser?.user_metadata?.full_name ?? name.trim()
        onAuth(activeUser, displayName)
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        const displayName = data.user?.user_metadata?.full_name ?? name.trim()
        onAuth(data.user, displayName)
      }
    } catch (err) {
      console.error('Auth error:', err)
      const msg = err.message ?? ''
      if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) {
        setError('Nome ou senha incorretos.')
      } else if (msg.includes('already registered') || msg.includes('already been registered')) {
        setError('Esse nome já está cadastrado. Clique em "Entrar".')
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
            <label htmlFor="auth-name">Nome completo</label>
            <input
              id="auth-name" type="text"
              placeholder="Ex: Ed Carlos Xavier"
              value={name} onChange={e => setName(e.target.value)}
              autoComplete="name" autoFocus disabled={loading}
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
                <span className="auth-hint">Usado para cadastrar(futuramente notificações de tarefas)</span>
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
              <p className="auth-new-room-hint">Compartilhe com sua turma. Você é o admin da sala.</p>
              <button
                type="button"
                className="auth-submit"
                onClick={() => {
                  const email = nameToEmail(name.trim())
                  supabase.auth.signInWithPassword({ email, password }).then(({ data }) => {
                    if (data?.user) {
                      const displayName = data.user?.user_metadata?.full_name ?? name.trim()
                      onAuth(data.user, displayName)
                    }
                  })
                }}
              >
                Entrar no App →
              </button>
            </div>
          ) : (
            <button 
              type="submit" 
              className="auth-submit" 
              disabled={loading}
              style={{ whiteSpace: 'nowrap', minHeight: '48px', marginTop: '15px' }}
            >
              {loading ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          )}
        </form>
        </div>
      </div>

      <p className="auth-footer auth-footer-mobile" style={{ paddingBottom: '30px' }}>Feito para a galera do IF gente boa 👍</p>
    </div>
  )
}