import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PRIVATE    = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_PUBLIC     = 'BE-Fel3Zzx8s1vnTaoprnCPoWo9fxUkxj8YEIAEOaVvN8j7tZGccLe-C_OQOTtOHoyqlLhPGWdeFhLAnI0L9iCE'
const APP_URL          = 'https://anotaaif-next.vercel.app'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

if (VAPID_PRIVATE) {
  webpush.setVapidDetails(`mailto:suporte@anotaaif.com`, VAPID_PUBLIC, VAPID_PRIVATE)
}

// Retorna a data atual no fuso de Brasília (UTC-3)
function todayBrasilia(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + n)
  return date.toLocaleDateString('en-CA')
}

function formatDate(ymd: string): string {
  return new Date(ymd + 'T12:00:00Z').toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'America/Sao_Paulo',
  })
}

async function sendPush(
  sub: { id?: string; endpoint: string; p256dh: string; auth_key: string },
  payload: object,
  supabase: ReturnType<typeof createClient>,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      JSON.stringify(payload),
      { urgency: 'high', TTL: 86400 },
    )
    return true
  } catch (e: any) {
    if (e?.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    } else {
      console.error('Push error:', e?.statusCode, e?.message ?? e)
    }
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (!VAPID_PRIVATE) {
    console.error('VAPID_PRIVATE_KEY não configurado nos secrets do Supabase!')
    return Response.json(
      { ok: false, error: 'VAPID_PRIVATE_KEY não configurado. Acesse: Supabase Dashboard → Edge Functions → notify-tasks → Secrets e adicione VAPID_PRIVATE_KEY.' },
      { status: 500, headers: CORS },
    )
  }

  const body = await req.json().catch(() => ({}))
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Cron: lembretes diários ──────────────────────────────
  if (!body.type) {
    const offsets = [0, 1, 2, 4, 7]
    const today   = todayBrasilia()
    const dates   = offsets.map(n => addDays(today, n))

    // Tarefas cujo due_date principal bate com os offsets
    const { data: mainTasks } = await supabase
      .from('tasks')
      .select('id, type, subject, due_date, extra_dates, class_code, subgroup_id')
      .in('due_date', dates)
      .eq('done', false)

    // Tarefas cujo extra_dates contém uma das datas alvo (sem duplicar as do due_date)
    const extraFilter = dates.map(d => `extra_dates.cs.["${d}"]`).join(',')
    const { data: extraTasks } = await supabase
      .from('tasks')
      .select('id, type, subject, due_date, extra_dates, class_code, subgroup_id')
      .or(extraFilter)
      .eq('done', false)

    // Monta lista unificada com matchedDate e daysLeft
    const mainIds = new Set((mainTasks ?? []).map((t: any) => t.id))
    const tasks: any[] = []

    for (const t of (mainTasks ?? [])) {
      tasks.push({ ...t, matchedDate: t.due_date, daysLeft: offsets[dates.indexOf(t.due_date)] ?? 1 })
    }
    for (const t of (extraTasks ?? [])) {
      if (mainIds.has(t.id)) continue
      const matchedDate = dates.find(d => (t.extra_dates as string[] | null)?.includes(d))
      if (!matchedDate) continue
      tasks.push({ ...t, matchedDate, daysLeft: offsets[dates.indexOf(matchedDate)] ?? 1 })
    }

    if (!tasks.length) return Response.json({ ok: true, sent: 0 }, { headers: CORS })

    const { data: profiles }       = await supabase.from('profiles').select('id, class_code')
    const { data: allSubs }        = await supabase.from('push_subscriptions').select('*')

    const subgroupIds = [...new Set(tasks.filter((t: any) => t.subgroup_id).map((t: any) => t.subgroup_id))]
    let subgroupMembers: { user_id: string; subgroup_id: string }[] = []
    if (subgroupIds.length) {
      const { data } = await supabase.from('subgroup_members').select('user_id, subgroup_id').in('subgroup_id', subgroupIds)
      subgroupMembers = data ?? []
    }

    // Agrupa tarefas por usuário
    const userTasks: Record<string, any[]> = {}
    for (const task of tasks) {
      if (task.subgroup_id) {
        subgroupMembers.filter(m => m.subgroup_id === task.subgroup_id).forEach(m => {
          ;(userTasks[m.user_id] ??= []).push(task)
        })
      } else if (task.class_code) {
        ;(profiles ?? []).filter((p: any) => p.class_code === task.class_code).forEach((p: any) => {
          ;(userTasks[p.id] ??= []).push(task)
        })
      }
    }

    // Agrupa subscriptions por usuário (múltiplos dispositivos)
    const subsByUser: Record<string, any[]> = {}
    for (const sub of (allSubs ?? [])) {
      ;(subsByUser[sub.user_id] ??= []).push(sub)
    }

    let sent = 0
    const pushes: Promise<boolean>[] = []

    for (const [userId, taskList] of Object.entries(userTasks)) {
      const subs = subsByUser[userId]
      if (!subs?.length) continue

      const first  = taskList[0]
      const emoji  = first.type === 'prova' ? '📝' : '📚'
      const dayStr = first.daysLeft === 0 ? 'hoje' : first.daysLeft === 1 ? 'amanhã' : `em ${first.daysLeft} dias`

      const title = taskList.length === 1
        ? `${emoji} ${first.subject} — ${dayStr}!`
        : `⏰ ${taskList.length} tarefas chegando!`

      const msgBody = taskList.length === 1
        ? `Prazo: ${formatDate(first.matchedDate)}`
        : taskList.map((t: any) => `• ${t.subject} (${formatDate(t.matchedDate)})`).join('\n')

      for (const sub of subs) {
        pushes.push(sendPush(sub, { title, body: msgBody, url: APP_URL }, supabase))
      }
      sent++
    }

    const results = await Promise.allSettled(pushes)
    const delivered = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    return Response.json({ ok: true, sent, delivered }, { headers: CORS })
  }

  // ── Nova atividade / prova ───────────────────────────────
  if (body.type === 'room_task' || body.type === 'subgroup_task') {
    const emoji = body.task_type === 'prova' ? '📝' : '📚'
    const tipo  = body.task_type === 'prova' ? 'Nova prova adicionada!' : 'Nova atividade adicionada!'
    const by    = body.created_by_name ? `Adicionada por ${body.created_by_name}` : ''

    const title    = `${emoji} ${tipo}`
    const lines    = [body.subject ?? '']
    if (body.due_date) lines.push(`Prazo: ${formatDate(body.due_date)}`)
    if (by)            lines.push(by)
    const msgBody  = lines.join('\n')

    let subs: any[] = []

    if (body.type === 'subgroup_task' && body.subgroup_id) {
      const { data: members } = await supabase
        .from('subgroup_members')
        .select('user_id')
        .eq('subgroup_id', body.subgroup_id)
      const ids = (members ?? []).map((m: any) => m.user_id).filter((id: string) => id !== body.created_by_id)
      if (ids.length) {
        const { data } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
        subs = data ?? []
      }
    } else if (body.class_code) {
      const { data: profs } = await supabase.from('profiles').select('id').eq('class_code', body.class_code)
      const ids = (profs ?? []).map((p: any) => p.id)
      if (ids.length) {
        const { data } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
        subs = data ?? []
      }
    }

    const results = await Promise.allSettled(subs.map(sub => sendPush(sub, { title, body: msgBody, url: APP_URL }, supabase)))
    const delivered = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    return Response.json({ ok: true, sent: delivered, subscriptions: subs.length }, { headers: CORS })
  }

  // ── Sugestão de aluno → notifica moderadores ─────────────
  if (body.type === 'suggestion') {
    const { data: mods } = await supabase
      .from('profiles')
      .select('id')
      .eq('class_code', body.class_code)
      .or('is_admin.eq.true,is_moderator.eq.true')

    const ids = (mods ?? []).map((m: any) => m.id)
    let delivered = 0
    if (ids.length) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
      const results = await Promise.allSettled((subs ?? []).map(sub => sendPush(sub, {
        title: '📋 Nova sugestão de atividade',
        body: `${body.subject} — sugerida por ${body.suggested_by_name}`,
        url: `${APP_URL}/moderador`,
      }, supabase)))
      delivered = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    }
    return Response.json({ ok: true, sent: delivered }, { headers: CORS })
  }

  // ── Anúncio do admin ─────────────────────────────────────
  if (body.type === 'announcement') {
    const { data: profs } = await supabase.from('profiles').select('id').eq('class_code', body.class_code)
    const ids = (profs ?? []).map((p: any) => p.id)
    let delivered = 0
    let subsCount = 0
    if (ids.length) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
      subsCount = subs?.length ?? 0
      const results = await Promise.allSettled((subs ?? []).map(sub => sendPush(sub, {
        title: body.title,
        body: body.body,
        url: body.url ?? APP_URL,
      }, supabase)))
      delivered = results.filter(r => r.status === 'fulfilled' && r.value === true).length
    }
    return Response.json({ ok: true, sent: delivered, subscriptions: subsCount, members: ids.length }, { headers: CORS })
  }

  return Response.json({ ok: true }, { headers: CORS })
})
