export const metadata = {
  title: 'Fountain Pen Vault',
  description: 'Private fountain pen, ink, nib and feed collection vault',
  applicationName: 'Fountain Pen Vault',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    shortcut: '/icon-192.png',
    apple: '/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    title: 'Pen Vault',
    statusBarStyle: 'black-translucent'
  },
  other: {
    'mobile-web-app-capable': 'yes'
  }
};

export const viewport = {
  themeColor: '#06060b',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
