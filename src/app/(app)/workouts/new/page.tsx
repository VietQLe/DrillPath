import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import WorkoutBuilder from '@/components/workouts/WorkoutBuilder'
import type { Kid, Drill, TemplateDrill, WorkoutTemplate } from '@/types'

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; day?: string; template?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const [{ data: kids }, { data: drills }] = await Promise.all([
    supabase.from('kids').select('*').eq('parent_id', user.id).order('created_at'),
    supabase.from('drills').select('*').order('sport').order('difficulty').order('title'),
  ])

  if (!kids || kids.length === 0) redirect('/onboarding')

  let defaultName: string | undefined
  let defaultFocus: string | undefined
  let defaultSelectedDrills: Drill[] | undefined

  if (params.template) {
    const { data: template } = await supabase
      .from('workout_templates')
      .select('*, template_drills(*, drill:drills(*))')
      .eq('id', params.template)
      .single()

    if (template) {
      const t = template as WorkoutTemplate & {
        template_drills: (TemplateDrill & { drill: Drill })[]
      }
      defaultName = t.name
      defaultFocus = t.focus ?? undefined
      defaultSelectedDrills = [...(t.template_drills ?? [])]
        .sort((a, b) => a.display_order - b.display_order)
        .map(td => td.drill)
        .filter((d): d is Drill => !!d)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <WorkoutBuilder
        kids={kids as Kid[]}
        drills={(drills ?? []) as Drill[]}
        defaultKidId={params.kid}
        defaultDay={params.day !== undefined ? parseInt(params.day) : undefined}
        defaultName={defaultName}
        defaultFocus={defaultFocus}
        defaultSelectedDrills={defaultSelectedDrills}
        userId={user.id}
      />
    </div>
  )
}
