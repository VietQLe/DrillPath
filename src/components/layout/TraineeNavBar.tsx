'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function TraineeNavBar() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
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
  )
}
