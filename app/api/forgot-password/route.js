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

// Mesma lógica do AuthScreen — email interno de contas antigas
function nameToEmail(fullName) {
  return (
    fullName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '.')
      .replace(/[^a-z.]/g, '') + '@anotaaif.app'
  )
}

export async function POST(req) {
  const body = await req.json().catch(() => null)
  const contactEmail = body?.email?.trim()
  if (!contactEmail) return Response.json({ error: 'Email obrigatório' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const origin = 'https://anotaaif-next.vercel.app'

  // Busca o perfil pelo email real (contact_email)
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, contact_email')
    .eq('contact_email', contactEmail)
    .maybeSingle()

  if (!profile) {
    // Email não encontrado — retorna ok sem revelar
    return Response.json({ ok: true })
  }

  // Tenta primeiro com o contact_email (contas novas usam email real no auth)
  // Se falhar, tenta com o email interno derivado do nome (contas antigas)
  let resetLink = null

  const tryGenerate = async (authEmail) => {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: authEmail,
      options: { redirectTo: `${origin}/perfil` },
    })
    if (!error && data?.properties?.action_link) return data.properties.action_link
    return null
  }

  resetLink = await tryGenerate(contactEmail)

  if (!resetLink && profile.full_name) {
    // Fallback: conta antiga com email interno (@anotaaif.app)
    resetLink = await tryGenerate(nameToEmail(profile.full_name))
  }

  if (!resetLink) return Response.json({ ok: true })

  const firstName = profile.full_name?.split(' ')[0] || 'estudante'

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif">
      <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

        <div style="background:#00843D;padding:24px 28px">
          <p style="margin:0;color:rgba(255,255,255,.7);font-size:13px;font-weight:600;letter-spacing:.5px">ANOTA AIF!</p>
          <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700">Redefinir senha 🔐</h1>
        </div>

        <div style="padding:28px">
          <p style="margin:0 0 16px;font-size:15px;color:#333">
            Oi, <strong>${firstName}</strong>! Recebemos um pedido para redefinir a senha da sua conta.
          </p>
          <p style="margin:0 0 24px;font-size:14px;color:#666">
            Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.
          </p>
          <div style="text-align:center;margin-bottom:24px">
            <a href="${resetLink}"
               style="display:inline-block;background:#00843D;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px">
              Redefinir minha senha →
            </a>
          </div>
          <p style="margin:0;font-size:12px;color:#999">
            Se você não solicitou isso, pode ignorar este e-mail. Sua senha não será alterada.
          </p>
        </div>

        <div style="padding:16px 28px;background:#f9f9f9;border-top:1px solid #eee">
          <p style="margin:0;font-size:11px;color:#bbb;text-align:center">
            Anota AIF! — Organização escolar do IF
          </p>
        </div>

      </div>
    </body>
    </html>
  `

  try {
    await transporter.sendMail({
      from: `"Anota AIF!" <${process.env.GMAIL_USER}>`,
      to: contactEmail,
      subject: '🔐 Redefinir senha — Anota AIF!',
      html,
    })
  } catch (e) {
    console.error('[forgot-password] sendMail error:', e)
  }

  return Response.json({ ok: true })
}
