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

export async function POST(req) {
  const body = await req.json().catch(() => null)
  if ((!body?.class_code && !body?.subgroup_id) || !body?.title) return Response.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Busca emails de todos da sala (ou subgrupo)
  let members
  if (body.subgroup_id) {
    const { data: memberRows } = await supabase
      .from('subgroup_members')
      .select('user_id')
      .eq('subgroup_id', body.subgroup_id)
    const ids = (memberRows ?? []).map(r => r.user_id)
    if (!ids.length) return Response.json({ ok: true, sent: 0 })
    const { data } = await supabase.from('profiles').select('full_name, contact_email').in('id', ids)
    members = data
  } else {
    const { data } = await supabase.from('profiles').select('full_name, contact_email').eq('class_code', body.class_code)
    members = data
  }
  if (!members?.length) return Response.json({ ok: true, sent: 0 })

  const isProva = body.type === 'prova'
  const emoji   = isProva ? '📝' : '📚'
  const tipo    = isProva ? 'Nova prova adicionada' : 'Nova atividade adicionada'
  const taskName = body.title ?? body.subject ?? ''
  const subText = taskName ? ` de ${taskName}` : ''

  const subject = `${emoji} ${tipo}${subText}`
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#1a56db;margin:0 0 8px">${emoji} ${tipo}</h2>
      <p style="font-size:18px;font-weight:600;margin:0 0 4px">${taskName}</p>
      ${body.due_date ? `<p style="color:#ef4444;font-weight:600;margin:0 0 16px">Prazo: ${new Date(body.due_date).toLocaleDateString('pt-BR')}</p>` : ''}
      ${body.description ? `<p style="color:#444;margin:0 0 16px">${body.description}</p>` : ''}
      <a href="https://anotaaif-next.vercel.app" style="display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">
        Ver no Anota AIF! →
      </a>
      <p style="color:#999;font-size:12px;margin-top:24px">Anota AIF! — Organização escolar do IF</p>
    </div>
  `

  const sends = members.map(m =>
    transporter.sendMail({
      from: `"Anota AIF!" <${process.env.GMAIL_USER}>`,
      to:   m.contact_email,
      subject,
      html,
    }).catch(() => null)
  )

  await Promise.allSettled(sends)
  return Response.json({ ok: true, sent: members.length })
}
