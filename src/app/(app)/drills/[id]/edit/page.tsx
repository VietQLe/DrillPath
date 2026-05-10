import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DrillForm from '@/components/drills/DrillForm'
import type { Drill } from '@/types'

export default async function EditDrillPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: drill } = await supabase
    .from('drills')
    .select('*')
    .eq('id', id)
    .single()

  if (!drill) notFound()

  // Only the creator can edit
  if ((drill as Drill).created_by !== user.id) redirect(`/drills/${id}`)

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <div className="pt-2 flex items-center gap-3 mb-6">
        <Link href={`/drills/${id}`} className="text-slate-400 hover:text-slate-600 text-xl leading-none">←</Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Drill</h1>
      </div>
      <DrillForm drill={drill as Drill} userId={user.id} />
    </div>
  )
}
