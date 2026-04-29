// Proxy para a edge function do Supabase — usada pelo admin para disparar testes
export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  const res = await fetch(`${supabaseUrl}/functions/v1/notify-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(serviceKey ? { 'Authorization': `Bearer ${serviceKey}` } : {}),
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({ ok: false }))
  return Response.json(data)
}
