import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DrillForm from '@/components/drills/DrillForm'

export default async function NewDrillPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <div className="pt-2 flex items-center gap-3 mb-6">
        <Link href="/drills" className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</Link>
        <h1 className="text-2xl font-bold text-slate-900">Create Drill</h1>
      </div>
      <DrillForm userId={user.id} />
    </div>
  )
}
