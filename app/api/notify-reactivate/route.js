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

const html = (firstName) => `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

    <div style="background:#00843D;padding:24px 28px">
      <p style="margin:0;color:rgba(255,255,255,.7);font-size:13px;font-weight:600;letter-spacing:.5px">ANOTA AIF!</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700">Reative suas notificações 🔔</h1>
    </div>

    <div style="padding:24px 28px">
      <p style="margin:0 0 16px;font-size:15px;color:#333">
        Oi, <strong>${firstName}</strong>!
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#333">
        Precisamos atualizar nossa chave de notificações — por isso as notificações push pararam de funcionar para todo mundo. Pedimos desculpas especialmente a quem já tinha ativado e vai ter que repetir o processo 😔
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#333">
        Para continuar recebendo lembretes de provas e atividades no celular, basta entrar no app e clicar em <strong>"Reativar"</strong> no aviso que vai aparecer na tela.
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#333">
        É rápido — um clique só 👇
      </p>

      <div style="text-align:center">
        <a href="https://anotaaif-next.vercel.app"
           style="display:inline-block;background:#00843D;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:15px">
          Abrir o Anota AIF! →
        </a>
      </div>
    </div>

    <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee">
      <p style="margin:0;font-size:11px;color:#bbb;text-align:center">
        Anota AIF! — Organização escolar do IF · Você está recebendo este e-mail porque está cadastrado na plataforma.
      </p>
    </div>

  </div>
</body>
</html>
`

export async function GET(req) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('full_name, contact_email')
    .not('contact_email', 'is', null)
    .neq('contact_email', '')

  if (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }

  let sent = 0
  let failed = 0

  for (const p of (profiles ?? [])) {
    const firstName = (p.full_name ?? 'estudante').split(' ')[0]
    try {
      await transporter.sendMail({
        from: `"Anota AIF!" <${process.env.GMAIL_USER}>`,
        to: p.contact_email,
        subject: '🔔 Reative suas notificações — Anota AIF!',
        html: html(firstName),
      })
      sent++
    } catch (e) {
      console.error('[notify-reactivate] sendMail error:', p.contact_email, e?.message)
      failed++
    }
  }

  return Response.json({ ok: true, sent, failed, total: profiles?.length ?? 0 })
}
