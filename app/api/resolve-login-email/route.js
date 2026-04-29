import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  const { fullName } = await req.json().catch(() => ({}))
  if (!fullName) return Response.json({ email: null })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data } = await admin
    .from('profiles')
    .select('contact_email')
    .ilike('full_name', fullName.trim())
    .single()

  return Response.json({ email: data?.contact_email ?? null })
}
