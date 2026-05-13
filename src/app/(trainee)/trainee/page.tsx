import { redirect } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SPORT_EMOJI, LEVEL_LABELS, LEVEL_COLORS, cn } from '@/lib/utils'
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

// Rendered client-only so new Date() uses browser local timezone, not server UTC.
const TraineeTodayWorkouts = dynamic(() => import('./TraineeTodayWorkoutsClient'), { ssr: false })

export default async function TraineeDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Verify trainee identity — admin client so this works before RLS policies are applied
  const admin = createAdminClient()
  const { data: kid } = await admin
    .from('kids')
    .select('*')
    .eq('trainee_user_id', user.id)
    .single()

  if (!kid) redirect('/auth/login')

  // Fetch from yesterday UTC midnight so the client component can filter by
  // local midnight regardless of timezone offset (covers UTC-12 … UTC+14).
  const fetchFrom = new Date()
  fetchFrom.setDate(fetchFrom.getDate() - 1)
  fetchFrom.setHours(0, 0, 0, 0)

  // Fetch plans and session logs via admin client — bypasses RLS so trainee
  // data is always visible even if the trainee policies haven't been applied yet.
  // No scheduled_day filter here — the client component applies the local-timezone day.
  const [{ data: plans }, { data: logs }] = await Promise.all([
    admin
      .from('training_plans')
      .select('*, plan_drills(*, drill:drills(*))')
      .eq('kid_id', kid.id)
      .order('created_at'),
    admin
      .from('session_logs')
      .select('plan_id, drill_id, completed_at')
      .eq('kid_id', kid.id)
      .gte('completed_at', fetchFrom.toISOString()),
  ])

  const typedKid = kid as Kid
  const typedPlans = (plans ?? []) as (TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] })[]
  const typedLogs = (logs ?? []) as { plan_id: string; drill_id: string; completed_at: string }[]

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="pt-2 flex items-center gap-4">
        <Link href="/trainee/profile" className="flex-shrink-0">
          {typedKid.avatar_url ? (
            <img src={typedKid.avatar_url} alt={typedKid.name} className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <div className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold',
              typedKid.avatar_color
            )}>
              {typedKid.name[0].toUpperCase()}
            </div>
          )}
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hey, {typedKid.name}!</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-slate-500 text-sm">{SPORT_EMOJI[typedKid.sport]}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[typedKid.skill_level])}>
              {LEVEL_LABELS[typedKid.skill_level]}
            </span>
          </div>
        </div>
      </div>

      <TraineeTodayWorkouts plans={typedPlans} logs={typedLogs} />
    </div>
  )
}
