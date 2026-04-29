import { createClient } from '@supabase/supabase-js'

// Envia uma notificação push customizada para todos os alunos de todas as salas.
// Protegido por CRON_SECRET (mesma chave do cron de lembretes).
export async function POST(req) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Valida que é o admin logado
  const { data: { user } } = await admin.auth.getUser(token)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return Response.json({ error: 'Forbidden' }, { status: 403 })

  // Lê payload do body (title, body, url)
  const { title, body, url } = await req.json().catch(() => ({}))
  if (!title || !body) return Response.json({ error: 'title e body são obrigatórios' }, { status: 400 })

  // Busca todas as salas
  const { data: rooms } = await admin.from('rooms').select('class_code')
  if (!rooms?.length) return Response.json({ ok: true, sent: 0 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Envia para cada sala via edge function
  const results = await Promise.allSettled(
    rooms.map(r =>
      fetch(`${supabaseUrl}/functions/v1/notify-tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          type: 'announcement',
          class_code: r.class_code,
          title,
          body,
          url: url ?? 'https://anotaaif-next.vercel.app',
        }),
      }).then(r => r.json()).catch(e => ({ error: String(e) }))
    )
  )

  const successes = results.filter(r => r.status === 'fulfilled').length
  return Response.json({ ok: true, sent: successes, total: rooms.length })
}
