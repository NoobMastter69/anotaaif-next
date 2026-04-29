import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  const { userId, fullName } = await req.json().catch(() => ({}))
  if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 })

  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'

  const userAgent = req.headers.get('user-agent') || ''

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await admin.from('login_logs').insert({ user_id: userId, full_name: fullName, ip, user_agent: userAgent })

  return Response.json({ ok: true })
}
