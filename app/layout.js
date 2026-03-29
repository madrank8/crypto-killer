import Link from 'next/link'
import './globals.css'

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
        <div className="min-h-screen flex flex-col">
          {/* Navigation */}
          <nav className="bg-dark-surface border-b border-gray-800 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <Link href="/" className="flex items-center space-x-2 group">
                  <div className="w-8 h-8 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center">
                    <span className="text-white font-bold text-lg">⚠️</span>
                  </div>
                  <span className="text-xl font-bold text-white group-hover:text-red-400 transition-colors">
                    Crypto Killer
                  </span>
                </Link>

                <div className="hidden sm:flex items-center space-x-8">
                  <Link
                    href="/"
                    className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
                  >
                    Home
                  </Link>
                  <Link
                    href="/scams"
                    className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
                  >
                    All Scams
                  </Link>
                  <Link
                    href="/dashboard"
                    className="text-gray-300 hover:text-white transition-colors text-sm font-medium"
                  >
                    Dashboard
                  </Link>
                </div>

                <div className="sm:hidden">
                  <Link
                    href="/scams"
                    className="text-gray-300 hover:text-white text-sm font-medium"
                  >
                    Menu
                  </Link>
                </div>
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="flex-grow">
            {children}
          </main>

          {/* Footer */}
          <footer className="bg-dark-surface border-t border-gray-800 mt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                <div>
                  <h3 className="text-white font-bold mb-4">Crypto Killer</h3>
                  <p className="text-gray-400 text-sm">
                    Powered by SpyOwl intelligence. Stop crypto scams before they start.
                  </p>
                </div>
                <div>
                  <h4 className="text-gray-300 font-semibold mb-4">Navigation</h4>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li>
                      <Link href="/" className="hover:text-white transition-colors">
                        Home
                      </Link>
                    </li>
                    <li>
                      <Link href="/scams" className="hover:text-white transition-colors">
                        Browse Scams
                      </Link>
                    </li>
                    <li>
                      <Link href="/dashboard" className="hover:text-white transition-colors">
                        Dashboard
                      </Link>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-gray-300 font-semibold mb-4">Resources</h4>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        Report a Scam
                      </a>
                    </li>
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        Education
                      </a>
                    </li>
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        API Docs
                      </a>
                    </li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-gray-300 font-semibold mb-4">Legal</h4>
                  <ul className="space-y-2 text-sm text-gray-400">
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        Privacy
                      </a>
                    </li>
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        Terms
                      </a>
                    </li>
                    <li>
                      <a href="#" className="hover:text-white transition-colors">
                        Disclaimer
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="border-t border-gray-700 pt-8 flex flex-col sm:flex-row justify-between items-center">
                <p className="text-gray-500 text-sm">
                  &copy; 2026 Crypto Killer. All rights reserved.
                </p>
                <p className="text-gray-500 text-sm mt-4 sm:mt-0">
                  Intelligence powered by SpyOwl
                </p>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
