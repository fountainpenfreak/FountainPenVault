export default function manifest() {
  return {
    name: 'Fountain Pen Vault',
    short_name: 'Pen Vault',
    description: 'Private fountain pen, ink, nib and feed collection vault',
    id: '/app/',
    start_url: '/app/',
    scope: '/',
    display: 'standalone',
    background_color: '#06060b',
    theme_color: '#06060b',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  };
}
