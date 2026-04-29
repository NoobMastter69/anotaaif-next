import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Limpa dados relacionados antes de deletar o auth user
  await admin.from('completions').delete().eq('user_id', userId)
  await admin.from('push_subscriptions').delete().eq('user_id', userId)
  await admin.from('profiles').delete().eq('id', userId)

  // Muda o email para um aleatório ANTES de deletar — libera o email original imediatamente
  // (Supabase mantém emails de usuários deletados por um tempo, impedindo re-cadastro com o mesmo nome)
  const tempEmail = `banned_${userId}_${Date.now()}@anotaaif.app`
  await admin.auth.admin.updateUserById(userId, { email: tempEmail })

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
