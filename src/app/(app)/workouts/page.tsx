import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import MonthlyCalendar from '@/components/workouts/MonthlyCalendar'
import WeeklyCalendar from '@/components/workouts/WeeklyCalendar'
import KidDropdown from '@/components/workouts/KidDropdown'
import { cn } from '@/lib/utils'
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDateStr(iso: string): string {
  return toDateStr(new Date(iso))
}

export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; view?: string; month?: string; week?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('parent_id', user.id)
    .order('created_at')

  if (!kids || kids.length === 0) redirect('/onboarding')

  const kidList = kids as Kid[]
  const selectedKid = kidList.find(k => k.id === params.kid) ?? kidList[0]

  const { data: plans } = await supabase
    .from('training_plans')
    .select('*, plan_drills(*, drill:drills(*))')
    .eq('kid_id', selectedKid.id)
    .order('created_at')

  const workouts = (plans ?? []) as WorkoutWithDrills[]

  const view = params.view === 'month' ? 'month' : 'week'

  const now = new Date()
  const todayStr = toDateStr(now)
  const todayDay = now.getDay()

  // --- Week navigation ---
  const weekOffset = parseInt(params.week ?? '0') || 0
  // Monday of the current real week
  const daysFromMonday = todayDay === 0 ? -6 : 1 - todayDay
  const weekMonday = new Date(now)
  weekMonday.setHours(0, 0, 0, 0)
  weekMonday.setDate(now.getDate() + daysFromMonday + weekOffset * 7)
  const weekSunday = new Date(weekMonday)
  weekSunday.setDate(weekMonday.getDate() + 6)
  weekSunday.setHours(23, 59, 59, 999)
  const weekMondayStr = toDateStr(weekMonday)

  // Week label e.g. "May 5 – 11" or "Apr 28 – May 4"
  const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekLabel = weekMonday.getMonth() === weekSunday.getMonth()
    ? `${fmtShort(weekMonday)} – ${weekSunday.getDate()}`
    : `${fmtShort(weekMonday)} – ${fmtShort(weekSunday)}`

  const prevWeekUrl = `/workouts?kid=${selectedKid.id}&view=week&week=${weekOffset - 1}`
  const nextWeekUrl = `/workouts?kid=${selectedKid.id}&view=week&week=${weekOffset + 1}`

  // --- Month navigation ---
  let calYear = now.getFullYear()
  let calMonth = now.getMonth()

  if (params.month) {
    const [y, m] = params.month.split('-').map(Number)
    if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
      calYear = y
      calMonth = m - 1
    }
  }

  const monthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`
  const kidParam = `kid=${selectedKid.id}`

  const prevMonthDate = new Date(calYear, calMonth - 1, 1)
  const nextMonthDate = new Date(calYear, calMonth + 1, 1)
  const prevUrl = `/workouts?${kidParam}&view=month&month=${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
  const nextUrl = `/workouts?${kidParam}&view=month&month=${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`

  // --- Fetch session logs ---
  type LogRow = { plan_id: string | null; drill_id: string; completed_at: string }
  let sessionLogs: LogRow[] = []
  let exceptions = new Set<string>()

  if (view === 'week') {
    const { data } = await supabase
      .from('session_logs')
      .select('plan_id, drill_id, completed_at')
      .eq('kid_id', selectedKid.id)
      .not('plan_id', 'is', null)
      .gte('completed_at', weekMonday.toISOString())
      .lte('completed_at', weekSunday.toISOString())
    sessionLogs = data ?? []
  } else {
    const monthStart = new Date(calYear, calMonth, 1)
    const monthEnd = new Date(calYear, calMonth + 1, 0, 23, 59, 59, 999)
    const planIds = workouts.map(w => w.id)

    const [{ data: logs }, { data: exRows }] = await Promise.all([
      supabase
        .from('session_logs')
        .select('plan_id, drill_id, completed_at')
        .eq('kid_id', selectedKid.id)
        .not('plan_id', 'is', null)
        .gte('completed_at', monthStart.toISOString())
        .lte('completed_at', monthEnd.toISOString()),
      planIds.length > 0
        ? supabase.from('plan_exceptions').select('plan_id, exception_date').in('plan_id', planIds)
        : Promise.resolve({ data: [] }),
    ])

    sessionLogs = logs ?? []
    exceptions = new Set((exRows ?? []).map(e => `${e.plan_id}:${e.exception_date}`))
  }

  // Per-date completion map serialized for client component
  const completedByDate: Record<string, string[]> = {}
  for (const log of sessionLogs) {
    if (!log.plan_id) continue
    const key = localDateStr(log.completed_at)
    if (!completedByDate[key]) completedByDate[key] = []
    completedByDate[key].push(`${log.plan_id}:${log.drill_id}`)
  }

  const isCurrentWeek = weekOffset === 0

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-5">
      <div className="pt-2 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workouts</h1>
          <p className="text-slate-500 text-sm">
            {view === 'week' ? 'Weekly training plan' : 'Monthly overview'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/workouts/library?${kidParam}`}
            className="px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            📚 Library
          </Link>
          <Link
            href={`/workouts/new?${kidParam}`}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            + New
          </Link>
        </div>
      </div>

      {/* View toggle + kid selector row */}
      <div className="flex items-center justify-between gap-3">
        {/* View toggle */}
        <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
          <Link
            href={`/workouts?${kidParam}&view=week`}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              view === 'week'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Week
          </Link>
          <Link
            href={`/workouts?${kidParam}&view=month&month=${monthStr}`}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              view === 'month'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            Month
          </Link>
        </div>

        {/* Kid selector */}
        {kidList.length > 1 && (
          <KidDropdown
            kids={kidList}
            selectedKidId={selectedKid.id}
            view={view}
            monthStr={monthStr}
          />
        )}
      </div>

      {workouts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">No workouts yet</h2>
          <p className="text-slate-500 text-sm mb-6">
            Build {selectedKid.name}&apos;s first training plan
          </p>
          <Link
            href={`/workouts/new?${kidParam}`}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Create first workout
          </Link>
        </div>
      ) : view === 'month' ? (
        <MonthlyCalendar
          year={calYear}
          month={calMonth}
          workouts={workouts}
          sessionLogs={sessionLogs}
          selectedKid={selectedKid}
          exceptions={exceptions}
          prevUrl={prevUrl}
          nextUrl={nextUrl}
        />
      ) : (
        <WeeklyCalendar
          workouts={workouts}
          kidId={selectedKid.id}
          todayStr={todayStr}
          weekOffset={weekOffset}
          weekLabel={weekLabel}
          weekMondayStr={weekMondayStr}
          prevWeekUrl={prevWeekUrl}
          nextWeekUrl={nextWeekUrl}
          completedByDate={completedByDate}
          isCurrentWeek={isCurrentWeek}
          todayJsDay={todayDay}
        />
      )}
    </div>
  )
}
