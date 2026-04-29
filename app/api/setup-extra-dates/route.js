import { createClient } from '@supabase/supabase-js'

// Rota one-shot: adiciona coluna extra_dates na tabela tasks se não existir.
// Chamada automaticamente pelo app quando detecta que a coluna não existe.
export async function POST(req) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: { user } } = await anon.auth.getUser(token)
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Verifica se já existe
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { error: checkErr } = await admin.from('tasks').select('extra_dates').limit(1)
  if (!checkErr) return Response.json({ ok: true, already: true })

  // Não existe — instrui o usuário (não temos acesso DDL via REST)
  return Response.json({
    ok: false,
    message: 'Execute no Supabase Dashboard > SQL Editor: ALTER TABLE tasks ADD COLUMN IF NOT EXISTS extra_dates JSONB DEFAULT NULL;',
  }, { status: 503 })
}
