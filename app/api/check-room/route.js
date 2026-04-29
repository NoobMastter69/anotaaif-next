import { createClient } from '@supabase/supabase-js'

export async function GET(req) {
  const code = new URL(req.url).searchParams.get('code')
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await supabase
    .from('rooms')
    .select('ano_turma, curso, campus, class_code')
    .eq('class_code', code.toUpperCase())
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ room: data ?? null })
}

export async function POST(req) {
  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Resolve sala: procura por campus+curso+ano_turma, cria se não existir
  const { campus, curso, ano_turma, class_code } = body

  if (class_code) {
    const { data } = await supabase
      .from('rooms')
      .select('class_code, ano_turma, curso, campus')
      .eq('class_code', class_code.toUpperCase())
      .maybeSingle()
    return Response.json({ room: data ?? null })
  }

  if (!campus || !curso || !ano_turma) {
    return Response.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Busca sala existente
  const { data: existing } = await supabase
    .from('rooms')
    .select('class_code')
    .eq('campus', campus)
    .eq('curso', curso)
    .eq('ano_turma', ano_turma)
    .maybeSingle()

  if (existing) return Response.json({ room: existing, isNew: false })

  // Cria nova sala
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

  const { error: insertErr } = await supabase
    .from('rooms')
    .insert({ class_code: code, campus, curso, ano_turma })

  if (insertErr) {
    // Race condition: outra pessoa criou ao mesmo tempo
    const { data: race } = await supabase
      .from('rooms')
      .select('class_code')
      .eq('campus', campus).eq('curso', curso).eq('ano_turma', ano_turma)
      .maybeSingle()
    return Response.json({ room: race ?? { class_code: code }, isNew: true })
  }

  return Response.json({ room: { class_code: code }, isNew: true })
}
