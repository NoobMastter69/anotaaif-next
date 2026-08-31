import { Outfit, DM_Sans } from 'next/font/google'
import './globals.css'
import PresenceTracker from './components/PresenceTracker'

// Outfit: fonte display (títulos, badges, tabs)
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-display',   // injeta var(--font-display) no <body>
  display: 'swap',
})

// DM Sans: fonte corpo (descrições, inputs)
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-body',      // injeta var(--font-body) no <body>
  display: 'swap',
})

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata = {
  title: 'Anota AIF!',
  description: 'Centralize suas provas e atividades do Instituto Federal',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/logo-header.png', type: 'image/png' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/icons/logo-header.png',
    apple: '/icons/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Anota AIF!',
  },
  other: {
    'theme-color': '#00843D',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <body>
        {/* Aplica o tema antes da primeira pintura, pra não piscar branco no modo escuro */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var t = localStorage.getItem('aaif_theme');
              if (t !== 'dark' && t !== 'light') {
                t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              }
              document.documentElement.dataset.theme = t;
              var m = document.querySelector('meta[name="theme-color"]');
              if (m) m.setAttribute('content', t === 'dark' ? '#0F1511' : '#00843D');
            } catch (e) {
              document.documentElement.dataset.theme = 'light';
            }
          })();
        `}} />
        <PresenceTracker />
        <div id="app">
          {children}
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
          // Banner de instalação do app
          (function() {
            var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
            if (standalone) return;
            var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
            var dismissed = sessionStorage.getItem('install_dismissed');
            if (dismissed) return;

            function showBanner(isIos, prompt) {
              var b = document.createElement('div');
              b.id = 'install-banner';
              b.innerHTML = '<img src="/icons/anotaAIF.jpg" style="width:40px;height:40px;border-radius:10px;flex-shrink:0">'
                + '<div style="flex:1;min-width:0"><strong style="display:block;font-size:14px">Anota AIF!</strong>'
                + '<span style="font-size:12px;opacity:0.85">'+(isIos?'Toque em ⬆️ e "Adicionar à Tela Início"':'Instale o app para usar offline e receber as notificações!')+'</span></div>'
                + '<button id="install-btn" style="background:white;color:#00843D;border:none;border-radius:20px;padding:7px 16px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0">'+(isIos?'Ver como':'Instalar')+'</button>'
                + '<button id="install-close" style="background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:0 4px;flex-shrink:0">×</button>';
              b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#00843D;color:white;display:flex;align-items:center;gap:12px;padding:12px 16px;font-family:sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,0.2);animation:slideUp .3s ease';
              document.head.insertAdjacentHTML('beforeend','<style>@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>');
              document.body.appendChild(b);
              document.getElementById('install-close').onclick = function(){ b.remove(); sessionStorage.setItem('install_dismissed','1'); };
              document.getElementById('install-btn').onclick = function(){
                if(prompt){ prompt.prompt(); prompt.userChoice.then(function(){ b.remove(); }); }
                else { b.remove(); }
              };
            }

            if (ios) {
              showBanner(true, null);
            } else {
              window.addEventListener('beforeinstallprompt', function(e) {
                e.preventDefault();
                showBanner(false, e);
              });
            }
          })();
        `}} />
      </body>
    </html>
  )
}
