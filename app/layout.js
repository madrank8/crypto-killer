import './globals.css'
import PublicShell from '@/components/PublicShell'

export const metadata = {
  title: 'Crypto Killer - Stop Crypto Scams Before They Start',
  description: 'Powered by SpyOwl intelligence. Get detailed analysis of crypto scams, red flags, and verdicts.',
  openGraph: {
    title: 'Crypto Killer - Crypto Scam Detection Platform',
    description: 'Detect and analyze crypto scams with intelligence-driven insights.',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Crypto Killer',
              url: 'https://crypto-killer.com',
              description: 'Crypto scam detection and analysis platform',
              sameAs: [],
            }),
          }}
        />
      </head>
      <body className="bg-dark-bg text-gray-100">
        <PublicShell>{children}</PublicShell>
      </body>
    </html>
  )
}
