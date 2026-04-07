import { createClient } from '@supabase/supabase-js'

export async function GET(req) {
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin
    .from('tasks')
    .select('*')
    .eq('class_code', code)
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ tasks: data ?? [] })
}
