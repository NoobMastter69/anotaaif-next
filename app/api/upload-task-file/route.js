import { createClient } from '@supabase/supabase-js'

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Não autenticado' }, { status: 401 })

  // Valida sessão
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: { user }, error: authErr } = await anon.auth.getUser(token)
  if (authErr || !user) return Response.json({ error: 'Não autenticado' }, { status: 401 })

  let formData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Formato inválido' }, { status: 400 })
  }

  const file = formData.get('file')
  const classCode = formData.get('classCode') || 'geral'

  if (!file || typeof file === 'string') return Response.json({ error: 'Arquivo ausente' }, { status: 400 })
  if (file.size > MAX_SIZE) return Response.json({ error: 'Arquivo muito grande (máx. 10 MB)' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) return Response.json({ error: 'Tipo de arquivo não permitido' }, { status: 400 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const ext = originalName.split('.').pop()
  const safeName = originalName.replace(`.${ext}`, '')
  const path = `${classCode}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safeName}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const { data, error } = await admin.storage
    .from('task-files')
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = admin.storage.from('task-files').getPublicUrl(data.path)

  return Response.json({ url: publicUrl, filename: file.name })
}
