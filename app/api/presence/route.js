import { createClient } from '@supabase/supabase-js'

// Rota de presença: registra quem abre o app, mantém a sessão viva e marca
// a saída. Grava sempre via service role — a tabela access_sessions só tem
// policy de SELECT (para o dono), então nenhum cliente escreve direto nela.

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function parseUA(ua = '') {
  const s = ua || ''
  let os = 'Desconhecido', device = 'Desconhecido', browser = 'Desconhecido'

  if (/iPhone/i.test(s))            { os = 'iOS';      device = 'iPhone' }
  else if (/iPad/i.test(s))         { os = 'iPadOS';   device = 'iPad' }
  else if (/Android/i.test(s))      { os = 'Android';  device = /Mobile/i.test(s) ? 'Celular Android' : 'Tablet Android' }
  else if (/Windows NT/i.test(s))   { os = 'Windows';  device = 'PC' }
  else if (/Mac OS X/i.test(s))     { os = 'macOS';    device = 'Mac' }
  else if (/CrOS/i.test(s))         { os = 'ChromeOS'; device = 'Chromebook' }
  else if (/Linux/i.test(s))        { os = 'Linux';    device = 'PC' }

  if (/Edg\//i.test(s))                             browser = 'Edge'
  else if (/OPR\/|Opera/i.test(s))                  browser = 'Opera'
  else if (/SamsungBrowser/i.test(s))               browser = 'Samsung Internet'
  else if (/FxiOS|Firefox/i.test(s))                browser = 'Firefox'
  else if (/CriOS/i.test(s))                        browser = 'Chrome'
  else if (/Chrome\//i.test(s))                     browser = 'Chrome'
  else if (/Safari\//i.test(s))                     browser = 'Safari'

  return { os, device, browser }
}

function geoFrom(req) {
  const dec = v => { try { return v ? decodeURIComponent(v) : null } catch { return v } }
  return {
    city:    dec(req.headers.get('x-vercel-ip-city')),
    region:  dec(req.headers.get('x-vercel-ip-country-region')),
    country: dec(req.headers.get('x-vercel-ip-country')),
  }
}

function ipFrom(req) {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'desconhecido'
  )
}

// Lê o corpo tolerando sendBeacon (que manda text/plain ou Blob).
async function readBody(req) {
  try { return JSON.parse(await req.text()) } catch { return {} }
}

// Resolve o usuário a partir do access_token do Supabase (header ou corpo,
// porque sendBeacon não permite headers).
async function resolveUser(db, req, token) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const jwt = token || bearer
  if (!jwt) return null
  const { data, error } = await db.auth.getUser(jwt)
  if (error || !data?.user) return null

  const { data: prof } = await db
    .from('profiles')
    .select('full_name, class_code, is_admin, is_moderator, is_owner')
    .eq('id', data.user.id)
    .maybeSingle()

  const role = prof?.is_owner     ? 'dono'
             : prof?.is_admin     ? 'admin'
             : prof?.is_moderator ? 'moderador'
             : 'aluno'

  return {
    user_id:    data.user.id,
    full_name:  prof?.full_name ?? data.user.user_metadata?.full_name ?? null,
    class_code: prof?.class_code ?? null,
    role,
  }
}

// Fecha sessões abandonadas, no máximo uma vez por minuto por instância.
let lastCleanup = 0
async function maybeCleanup(db) {
  if (Date.now() - lastCleanup < 60000) return
  lastCleanup = Date.now()
  try { await db.rpc('cleanup_access_sessions') } catch { /* ignora */ }
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'sem service role' })
  }

  const body = await readBody(req)
  const { action = 'start', sessionId, token, meta = {} } = body
  const db = admin()

  try {
    const who = await resolveUser(db, req, token)

    if (action === 'end') {
      if (!sessionId) return Response.json({ ok: true })
      await db.from('access_sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: meta.reason ?? 'fechou' })
        .eq('id', sessionId)
        .is('ended_at', null)
      return Response.json({ ok: true })
    }

    if (action === 'ping' && sessionId) {
      const patch = { last_seen_at: new Date().toISOString() }
      // Se a pessoa logou no meio da sessão, a identidade é anexada agora.
      if (who) Object.assign(patch, who)
      const { data, error } = await db.from('access_sessions')
        .update(patch).eq('id', sessionId).is('ended_at', null).select('id').maybeSingle()
      // Sessão já fechada/expirada no banco → cliente abre uma nova.
      if (error || !data) return Response.json({ ok: true, stale: true })
      await maybeCleanup(db)
      return Response.json({ ok: true })
    }

    // action === 'start'
    const ua = req.headers.get('user-agent') ?? ''
    const { os, device, browser } = parseUA(ua)
    const row = {
      user_id:    who?.user_id    ?? null,
      full_name:  who?.full_name  ?? null,
      class_code: who?.class_code ?? null,
      role:       who?.role       ?? 'visitante',
      ip:         ipFrom(req),
      ...geoFrom(req),
      user_agent: ua.slice(0, 400),
      device, os, browser,
      is_pwa:     !!meta.isPwa,
      screen:     meta.screen   ?? null,
      timezone:   meta.timezone ?? null,
      language:   meta.language ?? null,
      entry_path: (meta.path ?? '/').slice(0, 200),
      referrer:   (meta.referrer ?? '').slice(0, 300) || null,
    }

    const { data, error } = await db.from('access_sessions').insert(row).select('id').single()
    if (error) return Response.json({ ok: false, error: error.message })

    await maybeCleanup(db)
    return Response.json({ ok: true, id: data.id })
  } catch (e) {
    // Presença nunca pode quebrar o app.
    return Response.json({ ok: false, error: String(e?.message ?? e) })
  }
}
