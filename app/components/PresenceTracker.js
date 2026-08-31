'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '../lib/supabase'

// Registra entrada, permanência e saída de quem abre o app.
// Não renderiza nada e nunca interrompe o app se falhar.

const SID_KEY   = 'aaif_presence_sid'
const PING_MS   = 45000

export default function PresenceTracker() {
  const pathname = usePathname()
  const sidRef   = useRef(null)
  const tokenRef = useRef(null)

  useEffect(() => {
    let alive = true
    let timer = null

    const meta = () => ({
      path:     typeof window !== 'undefined' ? window.location.pathname : '/',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      screen:   typeof window !== 'undefined' ? `${window.screen?.width}x${window.screen?.height}` : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      language: typeof navigator !== 'undefined' ? navigator.language : null,
      isPwa:    typeof window !== 'undefined' &&
                (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true),
    })

    async function send(action, extra = {}) {
      try {
        const res = await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            action,
            sessionId: sidRef.current,
            token: tokenRef.current,
            meta: meta(),
            ...extra,
          }),
        })
        return await res.json()
      } catch {
        return null
      }
    }

    async function start() {
      const r = await send('start')
      if (!alive) return
      if (r?.id) {
        sidRef.current = r.id
        try { sessionStorage.setItem(SID_KEY, r.id) } catch { /* modo privado */ }
      }
    }

    async function ping() {
      if (!sidRef.current) { await start(); return }
      const r = await send('ping')
      // Sessão expirou no servidor (ficou muito tempo fechada) → abre outra.
      if (r?.stale) { sidRef.current = null; await start() }
    }

    async function boot() {
      const { data } = await supabase.auth.getSession()
      tokenRef.current = data?.session?.access_token ?? null
      if (!alive) return

      let saved = null
      try { saved = sessionStorage.getItem(SID_KEY) } catch { /* modo privado */ }

      if (saved) { sidRef.current = saved; await ping() }
      else       { await start() }

      timer = setInterval(() => {
        if (document.visibilityState === 'visible') ping()
      }, PING_MS)
    }

    boot()

    // Voltou pro app → marca presença na hora. Saiu da aba → registra o último "visto".
    function onVisibility() { ping() }

    // Fechou de vez: sendBeacon é o único jeito confiável no unload.
    function onLeave() {
      if (!sidRef.current) return
      const payload = JSON.stringify({
        action: 'end',
        sessionId: sidRef.current,
        token: tokenRef.current,
        meta: { reason: 'fechou' },
      })
      try {
        navigator.sendBeacon?.('/api/presence', new Blob([payload], { type: 'text/plain;charset=UTF-8' }))
      } catch { /* ignora */ }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onLeave)

    // Login/logout no meio do caminho: reidentifica a sessão.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      tokenRef.current = session?.access_token ?? null
      if (event === 'SIGNED_OUT') {
        await send('end', { meta: { reason: 'logout' } })
        sidRef.current = null
        try { sessionStorage.removeItem(SID_KEY) } catch { /* ignora */ }
        await start()
      } else if (session) {
        await ping()
      }
    })

    return () => {
      alive = false
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onLeave)
      subscription?.unsubscribe()
    }
  }, [])

  // Troca de página dentro do app conta como sinal de vida.
  useEffect(() => {
    if (!sidRef.current) return
    fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ping',
        sessionId: sidRef.current,
        token: tokenRef.current,
        meta: { path: pathname },
      }),
    }).catch(() => {})
  }, [pathname])

  return null
}
