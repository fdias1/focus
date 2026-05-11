import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111827'
}

export const metadata: Metadata = {
  title: 'Focus',
  description: 'Get notified when Focus Desktop detects activity.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Focus',
    statusBarStyle: 'black-translucent'
  },
  icons: {
    apple: '/icon-192.png'
  }
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return children
}
