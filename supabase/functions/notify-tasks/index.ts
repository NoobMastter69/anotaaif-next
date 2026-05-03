import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PRIVATE    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC     = 'BP68pPed7fc05A0rpVHStsZdJkxXdbVg-_dmjz4DDq6RB1PxLef6slZQ4ix_A_MGHYMB-LEUEq1IVciYn6ixjeg'
const APP_URL          = 'https://anotaaif-next.vercel.app'

webpush.setVapidDetails(`mailto:suporte@anotaaif.com`, VAPID_PUBLIC, VAPID_PRIVATE)

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
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'America/Sao_Paulo',
  })
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth_key: string }, payload: object) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      JSON.stringify(payload),
    )
  } catch (e: any) {
    // 410 Gone = subscription expirada, ignora
    if (e?.statusCode !== 410) console.error('Push error:', e?.message ?? e)
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}))
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── Cron: lembretes diários ──────────────────────────────
  if (!body.type) {
    const offsets = [1, 2, 4, 7]
    const today   = todayBrasilia()
    const dates   = offsets.map(n => addDays(today, n))

    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, type, subject, due_date, class_code, subgroup_id')
      .in('due_date', dates)
      .eq('done', false)

    if (!tasks?.length) return Response.json({ ok: true, sent: 0 })

    const { data: profiles }       = await supabase.from('profiles').select('id, class_code')
    const { data: allSubs }        = await supabase.from('push_subscriptions').select('*')

    const subgroupIds = [...new Set(tasks.filter(t => t.subgroup_id).map(t => t.subgroup_id))]
    let subgroupMembers: { user_id: string; subgroup_id: string }[] = []
    if (subgroupIds.length) {
      const { data } = await supabase.from('subgroup_members').select('user_id, subgroup_id').in('subgroup_id', subgroupIds)
      subgroupMembers = data ?? []
    }

    // Agrupa tarefas por usuário
    const userTasks: Record<string, any[]> = {}
    for (const task of tasks) {
      const daysLeft = offsets[dates.indexOf(task.due_date)] ?? 1
      const t = { ...task, daysLeft }

      if (task.subgroup_id) {
        subgroupMembers.filter(m => m.subgroup_id === task.subgroup_id).forEach(m => {
          ;(userTasks[m.user_id] ??= []).push(t)
        })
      } else if (task.class_code) {
        ;(profiles ?? []).filter(p => p.class_code === task.class_code).forEach(p => {
          ;(userTasks[p.id] ??= []).push(t)
        })
      }
    }

    // Agrupa subscriptions por usuário (múltiplos dispositivos)
    const subsByUser: Record<string, any[]> = {}
    for (const sub of (allSubs ?? [])) {
      ;(subsByUser[sub.user_id] ??= []).push(sub)
    }

    let sent = 0
    const pushes: Promise<void>[] = []

    for (const [userId, taskList] of Object.entries(userTasks)) {
      const subs = subsByUser[userId]
      if (!subs?.length) continue

      const first  = taskList[0]
      const emoji  = first.type === 'prova' ? '📝' : '📚'
      const dayStr = first.daysLeft === 1 ? 'amanhã' : `em ${first.daysLeft} dias`

      const title = taskList.length === 1
        ? `${emoji} ${first.subject} — ${dayStr}!`
        : `⏰ ${taskList.length} tarefas chegando!`

      const msgBody = taskList.length === 1
        ? `Prazo: ${formatDate(first.due_date)}`
        : taskList.map(t => `• ${t.subject} (${formatDate(t.due_date)})`).join('\n')

      for (const sub of subs) {
        pushes.push(sendPush(sub, { title, body: msgBody, url: APP_URL }))
      }
      sent++
    }

    await Promise.allSettled(pushes)
    return Response.json({ ok: true, sent })
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

    await Promise.allSettled(subs.map(sub => sendPush(sub, { title, body: msgBody, url: APP_URL })))
    return Response.json({ ok: true, sent: subs.length })
  }

  // ── Sugestão de aluno → notifica moderadores ─────────────
  if (body.type === 'suggestion') {
    const { data: mods } = await supabase
      .from('profiles')
      .select('id')
      .eq('class_code', body.class_code)
      .or('is_admin.eq.true,is_moderator.eq.true')

    const ids = (mods ?? []).map((m: any) => m.id)
    if (ids.length) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
      await Promise.allSettled((subs ?? []).map(sub => sendPush(sub, {
        title: '📋 Nova sugestão de atividade',
        body: `${body.subject} — sugerida por ${body.suggested_by_name}`,
        url: `${APP_URL}/moderador`,
      })))
    }
    return Response.json({ ok: true })
  }

  // ── Anúncio do admin ─────────────────────────────────────
  if (body.type === 'announcement') {
    const { data: profs } = await supabase.from('profiles').select('id').eq('class_code', body.class_code)
    const ids = (profs ?? []).map((p: any) => p.id)
    if (ids.length) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', ids)
      await Promise.allSettled((subs ?? []).map(sub => sendPush(sub, {
        title: body.title,
        body: body.body,
        url: body.url ?? APP_URL,
      })))
    }
    return Response.json({ ok: true })
  }

  return Response.json({ ok: true })
})
