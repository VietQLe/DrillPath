import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }
type MonthLog = { plan_id: string | null; drill_id: string; completed_at: string }

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// JS day 0=Sun → calendar col 6, 1=Mon → col 0, etc.
function jsToCol(jsDay: number) {
  return jsDay === 0 ? 6 : jsDay - 1
}

function localDateStr(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MonthlyCalendar({
  year,
  month,
  workouts,
  sessionLogs,
  selectedKid,
  exceptions,
  prevUrl,
  nextUrl,
}: {
  year: number
  month: number // 0-indexed
  workouts: WorkoutWithDrills[]
  sessionLogs: MonthLog[]
  selectedKid: Kid
  exceptions: Set<string> // "plan_id:YYYY-MM-DD"
  prevUrl: string
  nextUrl: string
}) {
  const today = new Date()
  const todayY = today.getFullYear()
  const todayM = today.getMonth()
  const todayD = today.getDate()

  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  // Build completion map: "plan_id:YYYY-MM-DD" → Set<drill_id>
  const completedMap = new Map<string, Set<string>>()
  for (const log of sessionLogs) {
    if (!log.plan_id) continue
    const key = `${log.plan_id}:${localDateStr(log.completed_at)}`
    if (!completedMap.has(key)) completedMap.set(key, new Set())
    completedMap.get(key)!.add(log.drill_id)
  }

  // Build grid: pad start with nulls so col 0 = Monday
  const firstJsDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startCol = jsToCol(firstJsDay)

  const cells: (number | null)[] = [
    ...Array(startCol).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const scheduledWorkouts = workouts.filter(
    w => w.scheduled_day !== null && w.scheduled_day !== undefined
  )
  const unscheduled = workouts.filter(
    w => w.scheduled_day === null || w.scheduled_day === undefined
  )

  function isActiveOnDate(workout: WorkoutWithDrills, dateStr: string): boolean {
    if (workout.start_date && dateStr < workout.start_date) return false
    if (workout.end_date && dateStr > workout.end_date) return false
    if (exceptions.has(`${workout.id}:${dateStr}`)) return false
    return true
  }

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Link
          href={prevUrl}
          className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
        >
          ← Prev
        </Link>
        <span className="font-semibold text-slate-900">{monthName}</span>
        <Link
          href={nextUrl}
          className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
        >
          Next →
        </Link>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(h => (
          <div key={h} className="text-center text-[11px] font-semibold text-slate-400 py-1">
            {h}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
        {cells.map((date, i) => {
          if (date === null) {
            return <div key={i} className="bg-slate-50 min-h-[68px]" />
          }

          const isToday = date === todayD && month === todayM && year === todayY
          const cellDate = new Date(year, month, date)
          const isPast = cellDate < new Date(todayY, todayM, todayD)
          const jsDay = cellDate.getDay()
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
          const dayWorkouts = scheduledWorkouts.filter(
            w => w.scheduled_day === jsDay && isActiveOnDate(w, dateStr)
          )

          return (
            <div
              key={i}
              className={cn('min-h-[68px] p-1', isToday ? 'bg-blue-50' : 'bg-white')}
            >
              <div
                className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold mb-1 mx-auto',
                  isToday ? 'bg-blue-600 text-white' : 'text-slate-500'
                )}
              >
                {date}
              </div>

              <div className="space-y-0.5">
                {dayWorkouts.map(workout => {
                  const completed = completedMap.get(`${workout.id}:${dateStr}`)?.size ?? 0
                  const total = workout.plan_drills?.length ?? 0
                  const isDone = total > 0 && completed >= total
                  const isPartial = completed > 0 && !isDone

                  return (
                    <Link
                      key={workout.id}
                      href={`/workouts/${workout.id}?kid=${selectedKid.id}&date=${dateStr}`}
                      className={cn(
                        'block text-[10px] leading-tight px-1 py-0.5 rounded-sm font-medium truncate',
                        isDone
                          ? 'bg-green-100 text-green-800'
                          : isPartial
                          ? 'bg-yellow-100 text-yellow-800'
                          : isPast
                          ? 'bg-red-50 text-red-400'
                          : 'bg-blue-50 text-blue-700'
                      )}
                    >
                      {workout.name}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-100 border border-green-300 flex-shrink-0" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200 flex-shrink-0" />
          Upcoming
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-50 border border-red-200 flex-shrink-0" />
          Missed
        </span>
      </div>

      {/* Unscheduled workouts */}
      {unscheduled.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Unscheduled
          </h2>
          <div className="space-y-2">
            {unscheduled.map(workout => {
              const total = workout.plan_drills?.length ?? 0
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}?kid=${selectedKid.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-blue-300 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                    {workout.focus && (
                      <div className="text-xs text-slate-500 mt-0.5">{workout.focus}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-0.5">
                      {total} drill{total !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
