import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import WorkoutBuilder from '@/components/workouts/WorkoutBuilder'
import type { Kid, Drill, TemplateDrill, WorkoutTemplate, TrainingPlan, PlanDrill } from '@/types'

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; day?: string; date?: string; template?: string; copy?: string }>
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

  if (params.copy) {
    const { data: plan } = await supabase
      .from('training_plans')
      .select('*, plan_drills(*, drill:drills(*))')
      .eq('id', params.copy)
      .single()

    if (plan) {
      const p = plan as TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }
      defaultName = p.name
      defaultFocus = p.focus ?? undefined
      defaultSelectedDrills = [...(p.plan_drills ?? [])]
        .sort((a, b) => a.display_order - b.display_order)
        .map(pd => pd.drill)
        .filter((d): d is Drill => !!d)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <WorkoutBuilder
        kids={kids as Kid[]}
        drills={(drills ?? []) as Drill[]}
        defaultKidId={params.kid}
        defaultDate={params.date}
        defaultDay={params.day !== undefined ? parseInt(params.day) : undefined}
        defaultName={defaultName}
        defaultFocus={defaultFocus}
        defaultSelectedDrills={defaultSelectedDrills}
        userId={user.id}
      />
    </div>
  )
}
