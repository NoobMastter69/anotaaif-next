// Rota chamada pelo Vercel Cron todo dia às 11h UTC (8h Brasília)
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[notify] Unauthorized cron attempt')
    return new Response('Unauthorized', { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('[notify] Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return Response.json({ error: 'Missing env vars' }, { status: 500 })
  }

  try {
    console.log('[notify] Triggering notify-tasks edge function')
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const data = await res.json()
    console.log('[notify] Result:', JSON.stringify(data))
    return Response.json({ ok: true, ...data })
  } catch (err) {
    console.error('[notify] Error calling edge function:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
