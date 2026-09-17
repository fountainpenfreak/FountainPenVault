import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const file = path.join(process.cwd(), 'public', 'index.html');
  let html = await readFile(file, 'utf8');

  const pwaHead = `
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
  <link rel="shortcut icon" type="image/png" href="/icon-192.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta name="theme-color" content="#06060b" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Pen Vault" />
  <style>
    .mobileNavButton,.mobileNavBackdrop{display:none}
    @media (max-width:760px){
      .app{padding:12px;width:100%;max-width:none}
      .layout,
      body.tableMode .layout{
        display:grid!important;
        grid-template-columns:minmax(0,1fr)!important;
        width:100%!important;
        max-width:none!important;
      }
      .midCol,
      .rightCol,
      body.tableMode .midCol,
      body.tableMode .rightCol{
        grid-column:1 / -1!important;
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
      }
      .rightCol #view,
      .rightCol #view > *{
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
      }
      .rightCol .card{
        max-width:none!important;
      }
      .mobileNavButton{
        display:flex;position:fixed;left:12px;bottom:14px;z-index:10002;
        width:52px;height:52px;border-radius:16px;align-items:center;justify-content:center;
        border:1px solid rgba(159,103,255,.5);color:#e9e9ff;font-size:24px;cursor:pointer;
        background:linear-gradient(180deg,rgba(159,103,255,.42),rgba(124,58,237,.28));
        box-shadow:0 12px 30px rgba(0,0,0,.65)
      }
      .navCol{
        position:fixed!important;z-index:10001;left:10px;top:10px;bottom:78px;
        width:min(300px,calc(100vw - 32px));max-height:calc(100vh - 88px);overflow:auto;
        transform:translateX(calc(-100% - 24px));transition:transform .2s ease;
        box-shadow:0 24px 60px rgba(0,0,0,.8)!important
      }
      body.mobileNavOpen .navCol{transform:translateX(0)}
      .mobileNavBackdrop{
        position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.58);backdrop-filter:blur(2px)
      }
      body.mobileNavOpen .mobileNavBackdrop{display:block}
      body.mobileNavOpen{overflow:hidden}
      .navCol .nav{gap:7px;padding:8px}
      .navCol .navItem{padding:10px 11px;border-radius:12px}
      .navCol .panelHeader{padding:10px 12px}
    }
  </style>`;

  html = html.replace('</head>', `${pwaHead}\n</head>`);
  html = html.replace('src="./ui-finance.js"', 'src="/ui-finance.js"');
  html = html.replace('<div class="layout">', `<button class="mobileNavButton" id="mobileNavButton" type="button" aria-label="Navigation öffnen" aria-expanded="false">☰</button>\n    <div class="mobileNavBackdrop" id="mobileNavBackdrop"></div>\n    <div class="layout">`);
  html = html.replace('</body>', `  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error));
    }
    (() => {
      const button = document.getElementById('mobileNavButton');
      const backdrop = document.getElementById('mobileNavBackdrop');
      const nav = document.querySelector('.navCol');
      if (!button || !nav) return;
      const closeNav = () => {
        document.body.classList.remove('mobileNavOpen');
        button.textContent = '☰';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'Navigation öffnen');
      };
      const openNav = () => {
        document.body.classList.add('mobileNavOpen');
        button.textContent = '×';
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-label', 'Navigation schließen');
      };
      button.addEventListener('click', () => document.body.classList.contains('mobileNavOpen') ? closeNav() : openNav());
      backdrop?.addEventListener('click', closeNav);
      nav.querySelectorAll('.navItem[data-entity]').forEach(item => item.addEventListener('click', closeNav));
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
      window.addEventListener('resize', () => { if (window.innerWidth > 760) closeNav(); });
    })();
  </script>\n</body>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
