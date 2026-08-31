'use client'

import { useSyncExternalStore } from 'react'

export const THEME_KEY = 'aaif_theme'
const EVENT = 'aaif-theme-change'

export function applyTheme(theme) {
  const dark = theme === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#04361D' : '#00843D')
  window.dispatchEvent(new Event(EVENT))
}

// O tema real mora no <html data-theme>, escrito pelo script do layout antes
// da primeira pintura. Aqui só lemos de lá — sem efeito, sem piscada.
function subscribe(onChange) {
  window.addEventListener(EVENT, onChange)
  return () => window.removeEventListener(EVENT, onChange)
}
function getSnapshot() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
function getServerSnapshot() {
  return 'light'
}

export default function ThemeToggle({ className = '', showLabel = true }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const dark  = theme === 'dark'

  function toggle() {
    // Lê o tema atual do DOM, não da renderização: dois toques seguidos
    // antes do React re-renderizar usariam o mesmo valor antigo.
    const next = getSnapshot() === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* modo privado */ }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      title={dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      aria-label={dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      aria-pressed={dark}
    >
      {dark ? (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 1.6v2M10 16.4v2M1.6 10h2M16.4 10h2M4.1 4.1l1.4 1.4M14.5 14.5l1.4 1.4M15.9 4.1l-1.4 1.4M5.5 14.5l-1.4 1.4"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M16.5 12.4A7 7 0 017.6 3.5a7 7 0 108.9 8.9z"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {showLabel && <span>{dark ? 'Claro' : 'Escuro'}</span>}
    </button>
  )
}
