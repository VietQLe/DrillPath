'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/workouts', label: 'Workouts', icon: '📋' },
  { href: '/drills', label: 'Drills', icon: '🔍' },
  { href: '/progress', label: 'Progress', icon: '📈' },
]

export default function NavBar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-10 bg-white border-b border-slate-200 h-14 flex items-center px-4">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xl">🏆</span>
          <span className="font-bold text-slate-900 text-lg">DrillPath</span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Sign out
        </button>
      </header>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 bg-white border-t border-slate-200">
        <div className="flex">
          {NAV_ITEMS.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors',
                  active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
