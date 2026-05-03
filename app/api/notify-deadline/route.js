import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
})

function toYMD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function buildEmailHtml(name, tasks) {
  const rows = tasks.map(t => {
    const isProva  = t.type === 'prova'
    const emoji    = isProva ? '📝' : '📚'
    const tagColor = isProva ? '#EF4444' : '#3B82F6'
    const tag      = isProva ? 'PROVA' : 'ATIVIDADE'
    const daysLeft = t.daysLeft
    const urgency  = daysLeft === 1 ? '🟠 Amanhã' : `🟡 Em ${daysLeft} dias`

    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f0f0f0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="background:${tagColor};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.5px">${tag}</span>
            <span style="font-size:12px;color:#888">${urgency}</span>
          </div>
          <p style="margin:0;font-size:15px;font-weight:600;color:#111">${emoji} ${t.subject ?? ''}${t.description ? ` — ${t.description}` : ''}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#888">Prazo: ${formatDate(t.due_date)}</p>
        </td>
      </tr>
    `
  }).join('')

  const firstName = (name ?? 'estudante').split(' ')[0]

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif">
      <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

        <!-- Header -->
        <div style="background:#00843D;padding:24px 28px">
          <p style="margin:0;color:rgba(255,255,255,.7);font-size:13px;font-weight:600;letter-spacing:.5px">ANOTA AIF!</p>
          <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700">Lembrete de prazos ⏰</h1>
        </div>

        <!-- Body -->
        <div style="padding:24px 28px">
          <p style="margin:0 0 20px;font-size:15px;color:#333">
            Oi, <strong>${firstName}</strong>! Você tem ${tasks.length === 1 ? '1 tarefa chegando' : `${tasks.length} tarefas chegando`}. Não deixa pra última hora 😉
          </p>

          <table style="width:100%;border-collapse:collapse">
            ${rows}
          </table>

          <div style="margin-top:24px;text-align:center">
            <a href="https://anotaaif-next.vercel.app"
               style="display:inline-block;background:#00843D;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:15px">
              Ver minhas tarefas →
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee">
          <p style="margin:0;font-size:11px;color:#bbb;text-align:center">
            Anota AIF! — Organização escolar do IF · Você está recebendo este e-mail porque está cadastrado na plataforma.
          </p>
        </div>

      </div>
    </body>
    </html>
  `
}

// GET /api/notify-deadline — chamado pelo Vercel Cron
export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Datas alvo: 1, 2, 4 e 7 dias antes do prazo
  const offsets = [1, 2, 4, 7]
  const now     = new Date()
  const dates   = offsets.map(n => {
    const d = new Date(now)
    d.setDate(d.getDate() + n)
    return toYMD(d)
  })

  // Busca tarefas não concluídas com prazo nos próximos dias
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, type, subject, description, due_date, class_code, subgroup_id, done')
    .in('due_date', dates)
    .eq('done', false)

  if (error) {
    console.error('[notify-deadline] tasks query error:', error)
    return Response.json({ error: String(error) }, { status: 500 })
  }

  if (!tasks?.length) return Response.json({ ok: true, sent: 0 })

  // Busca todos os perfis com email
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, contact_email, class_code')
    .not('contact_email', 'is', null)

  if (!profiles?.length) return Response.json({ ok: true, sent: 0 })

  // Busca membros de subgrupos envolvidos
  const subgroupIds = [...new Set(tasks.filter(t => t.subgroup_id).map(t => t.subgroup_id))]
  let subgroupMembers = []
  if (subgroupIds.length) {
    const { data } = await supabase
      .from('subgroup_members')
      .select('user_id, subgroup_id')
      .in('subgroup_id', subgroupIds)
    subgroupMembers = data ?? []
  }

  // Mapeia user → tarefas relevantes
  const userTasks = {}

  for (const task of tasks) {
    const daysLeft = offsets[dates.indexOf(task.due_date)] ?? 1
    const taskWithDays = { ...task, daysLeft }

    if (task.subgroup_id) {
      // Tarefa de subgrupo: notifica membros do subgrupo
      const members = subgroupMembers.filter(m => m.subgroup_id === task.subgroup_id)
      for (const m of members) {
        if (!userTasks[m.user_id]) userTasks[m.user_id] = []
        userTasks[m.user_id].push(taskWithDays)
      }
    } else if (task.class_code) {
      // Tarefa da turma: notifica todos da sala
      const classProfiles = profiles.filter(p => p.class_code === task.class_code)
      for (const p of classProfiles) {
        if (!userTasks[p.id]) userTasks[p.id] = []
        userTasks[p.id].push(taskWithDays)
      }
    }
  }

  // Envia emails
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  let sent = 0

  const sends = Object.entries(userTasks).map(async ([userId, userTaskList]) => {
    const profile = profileMap[userId]
    if (!profile?.contact_email) return

    const taskCount = userTaskList.length
    const subjectLine = taskCount === 1
      ? `⏰ Lembrete: 1 tarefa chegando — Anota AIF!`
      : `⏰ Lembrete: ${taskCount} tarefas chegando — Anota AIF!`

    try {
      await transporter.sendMail({
        from: `"Anota AIF!" <${process.env.GMAIL_USER}>`,
        to: profile.contact_email,
        subject: subjectLine,
        html: buildEmailHtml(profile.full_name, userTaskList),
      })
      sent++
    } catch (e) {
      console.error('[notify-deadline] sendMail error:', e)
    }
  })

  await Promise.allSettled(sends)
  return Response.json({ ok: true, sent })
}
