import { createClient } from '@supabase/supabase-js'

export async function POST(req) {
  const body = await req.json().catch(() => null)
  if (!body?.id) return Response.json({ error: 'Missing user id' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { error } = await supabase.from('profiles').insert({
    id:            body.id,
    full_name:     body.full_name,
    contact_email: body.contact_email,
    campus:        body.campus,
    curso:         body.curso,
    ano_turma:     body.ano_turma,
    class_code:    body.class_code,
    is_moderator:  body.is_moderator ?? false,
    is_admin:      false,
  })

  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ ok: true })
}
