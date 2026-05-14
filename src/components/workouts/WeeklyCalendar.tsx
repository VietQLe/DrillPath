'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import RescheduleModal from './RescheduleModal'
import DragScopeModal from './DragScopeModal'
import type { TrainingPlan, PlanDrill, Drill } from '@/types'

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function dayDateStr(jsDay: number, weekMondayStr: string): string {
  const [y, m, d] = weekMondayStr.split('-').map(Number)
  const monday = new Date(y, m - 1, d)
  const offset = jsDay === 0 ? 6 : jsDay - 1
  const dt = new Date(monday)
  dt.setDate(monday.getDate() + offset)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// ---------- DraggableWorkoutCard ----------
function DraggableWorkoutCard({
  workout,
  kidId,
  dateStr,
  doneCount,
  total,
  allDone,
  overlay = false,
  onReschedule,
}: {
  workout: WorkoutWithDrills
  kidId: string
  dateStr: string
  doneCount: number
  total: number
  allDone: boolean
  overlay?: boolean
  onReschedule: (workout: WorkoutWithDrills, dateStr: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `plan-${workout.id}`,
    data: { workout },
    disabled: allDone,
  })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      className={cn(
        'flex items-center gap-3 px-4 py-3 bg-white transition-all select-none',
        isDragging && !overlay && 'opacity-40',
        overlay && 'rounded-xl border border-blue-300 shadow-lg bg-blue-50'
      )}
    >
      {!allDone && (
        <button
          {...(overlay ? {} : { ...listeners, ...attributes })}
          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none flex-shrink-0 flex flex-col gap-0.5 py-1"
          aria-label="Drag to reschedule"
          onClick={e => e.preventDefault()}
        >
          {[0, 1, 2].map(i => (
            <span key={i} className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-current" />
              <span className="w-1 h-1 rounded-full bg-current" />
            </span>
          ))}
        </button>
      )}

      <Link
        href={`/workouts/${workout.id}?kid=${kidId}&date=${dateStr}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
          allDone ? 'bg-green-500 text-white' : doneCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
        )}>
          {allDone ? '✓' : total > 0 ? `${doneCount}/${total}` : '—'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
          {workout.focus && <div className="text-xs text-slate-500 truncate mt-0.5">{workout.focus}</div>}
          <div className="text-xs text-slate-400 mt-0.5">{total} drill{total !== 1 ? 's' : ''}</div>
        </div>
      </Link>

      {!allDone && (
        <button
          onClick={() => onReschedule(workout, dateStr)}
          className="text-slate-300 hover:text-blue-500 flex-shrink-0 transition-colors p-1 rounded-lg hover:bg-blue-50"
          title="Reschedule"
        >
          ⟲
        </button>
      )}
    </div>
  )
}

// ---------- DroppableDayRow ----------
function DroppableDayRow({
  jsDay,
  dateStr,
  isToday,
  children,
}: {
  jsDay: number
  dateStr: string
  isToday: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${jsDay}` })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-2xl border overflow-hidden transition-all',
        isOver ? 'border-blue-400 ring-2 ring-blue-200' : isToday ? 'border-blue-300 shadow-sm' : 'border-slate-200'
      )}
    >
      <div className={cn('px-4 py-2.5 flex items-center gap-2', isToday ? 'bg-blue-50' : isOver ? 'bg-blue-50' : 'bg-slate-50')}>
        <span className={cn('text-sm font-semibold', isToday ? 'text-blue-700' : 'text-slate-600')}>
          {DAYS_FULL[jsDay]}
        </span>
        <span className={cn('text-xs', isToday ? 'text-blue-500' : 'text-slate-400')}>
          {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        {isToday && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Today</span>}
        {isOver && <span className="ml-auto text-xs text-blue-600 font-medium">Drop here</span>}
      </div>
      <div className="bg-white divide-y divide-slate-100">{children}</div>
    </div>
  )
}

// ---------- WeeklyCalendar ----------
export type WeeklyCalendarProps = {
  workouts: WorkoutWithDrills[]
  kidId: string
  todayStr: string
  weekOffset: number
  weekLabel: string
  weekMondayStr: string
  prevWeekUrl: string
  nextWeekUrl: string
  completedByDate: Record<string, string[]>
  isCurrentWeek: boolean
  todayJsDay: number
  exceptions: string[]
}

type PendingDrag = { workout: WorkoutWithDrills; fromDateStr: string; newDay: number; toDateStr: string }
type RescheduleTarget = { workout: WorkoutWithDrills; dateStr: string }

function localDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function WeeklyCalendar({
  workouts,
  kidId,
  todayStr: serverTodayStr,
  weekOffset,
  weekLabel,
  weekMondayStr,
  prevWeekUrl,
  nextWeekUrl,
  completedByDate,
  isCurrentWeek,
  todayJsDay: serverTodayJsDay,
  exceptions,
}: WeeklyCalendarProps) {
  const exceptionSet = new Set(exceptions)
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [dragging, setDragging] = useState<WorkoutWithDrills | null>(null)
  const [pendingDrag, setPendingDrag] = useState<PendingDrag | null>(null)
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null)
  // Override server-computed "today" with browser local date to fix UTC timezone mismatch
  const [todayStr, setTodayStr] = useState(serverTodayStr)
  const [todayJsDay, setTodayJsDay] = useState(serverTodayJsDay)
  useEffect(() => {
    const local = localDateStr()
    setTodayStr(local)
    setTodayJsDay(new Date().getDay())
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } })
  )

  const effectiveDay = useCallback(
    (w: WorkoutWithDrills) => (overrides[w.id] !== undefined ? overrides[w.id] : w.scheduled_day),
    [overrides]
  )

  const completedSet = useCallback(
    (dateStr: string) => new Set(completedByDate[dateStr] ?? []),
    [completedByDate]
  )

  const weekMondayDate = new Date(weekMondayStr + 'T00:00:00')
  const weekSundayDate = new Date(weekMondayDate)
  weekSundayDate.setDate(weekMondayDate.getDate() + 6)
  const weekMondayIso = weekMondayStr
  const weekSundayIso = `${weekSundayDate.getFullYear()}-${String(weekSundayDate.getMonth() + 1).padStart(2, '0')}-${String(weekSundayDate.getDate()).padStart(2, '0')}`

  const activeWorkouts = workouts.filter(w => {
    if (w.start_date > weekSundayIso) return false
    if (w.end_date && w.end_date < weekMondayIso) return false
    return true
  })

  const byDay: Record<number, WorkoutWithDrills[]> = {}
  activeWorkouts.forEach(w => {
    const day = effectiveDay(w)
    if (day !== null && day !== undefined) {
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(w)
    }
  })

  const unscheduled = activeWorkouts.filter(w => {
    const day = effectiveDay(w)
    return day === null || day === undefined
  })

  const completedToday = isCurrentWeek ? completedSet(todayStr) : new Set<string>()
  const completedOtherDay = isCurrentWeek ? activeWorkouts.filter(w => {
    const day = effectiveDay(w)
    if (day === todayJsDay || day === null || day === undefined) return false
    const drills = w.plan_drills ?? []
    return drills.length > 0 && drills.every(pd => completedToday.has(`${w.id}:${pd.drill_id}`))
  }) : []

  function handleDragStart(event: DragStartEvent) {
    const w = (event.active.data.current as { workout: WorkoutWithDrills } | undefined)?.workout
    setDragging(w ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const planId = active.id.toString().replace('plan-', '')
    const newDay = parseInt(over.id.toString().replace('day-', ''))
    if (isNaN(newDay)) return

    const workout = workouts.find(w => w.id === planId)
    if (!workout) return
    const curDay = effectiveDay(workout)
    if (curDay === newDay || curDay === null || curDay === undefined) return

    const fromDateStr = dayDateStr(curDay, weekMondayStr)
    const toDateStr = dayDateStr(newDay, weekMondayStr)
    setPendingDrag({ workout, fromDateStr, newDay, toDateStr })
  }

  async function applyDrag(scope: 'this' | 'all') {
    if (!pendingDrag) return
    const { workout, fromDateStr, newDay, toDateStr } = pendingDrag
    setPendingDrag(null)

    const supabase = createClient()

    if (scope === 'all') {
      setOverrides(prev => ({ ...prev, [workout.id]: newDay }))
      await supabase.from('training_plans').update({ scheduled_day: newDay }).eq('id', workout.id)
      router.refresh()
      setTimeout(() => setOverrides(prev => { const n = { ...prev }; delete n[workout.id]; return n }), 1000)
    } else {
      await supabase.from('plan_exceptions').insert({ plan_id: workout.id, exception_date: fromDateStr })
      const { data: newPlan } = await supabase.from('training_plans').insert({
        kid_id: workout.kid_id,
        name: workout.name,
        focus: workout.focus,
        scheduled_day: newDay,
        start_date: toDateStr,
        end_date: toDateStr,
      }).select('id').single()
      if (newPlan && workout.plan_drills?.length) {
        await supabase.from('plan_drills').insert(
          workout.plan_drills.map(pd => ({ plan_id: newPlan.id, drill_id: pd.drill_id, display_order: pd.display_order }))
        )
      }
      router.refresh()
    }
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex items-center justify-between">
          <Link href={prevWeekUrl} className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium">← Prev</Link>
          <span className="font-semibold text-slate-900 text-sm">{weekLabel}</span>
          <Link href={nextWeekUrl} className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium">Next →</Link>
        </div>

        <div className="space-y-3">
          {WEEK_ORDER.map(jsDay => {
            const dateStr = dayDateStr(jsDay, weekMondayStr)
            const dayWorkouts = (byDay[jsDay] ?? []).filter(w => !exceptionSet.has(`${w.id}:${dateStr}`))
            const isToday = dateStr === todayStr
            const done = completedSet(dateStr)

            return (
              <DroppableDayRow key={jsDay} jsDay={jsDay} dateStr={dateStr} isToday={isToday}>
                {dayWorkouts.map(workout => {
                  const drills = [...(workout.plan_drills ?? [])].sort((a, b) => a.display_order - b.display_order)
                  const doneCount = drills.filter(pd => done.has(`${workout.id}:${pd.drill_id}`)).length
                  const total = drills.length
                  return (
                    <DraggableWorkoutCard
                      key={workout.id}
                      workout={workout}
                      kidId={kidId}
                      dateStr={dateStr}
                      doneCount={doneCount}
                      total={total}
                      allDone={total > 0 && doneCount === total}
                      onReschedule={(w, ds) => setRescheduleTarget({ workout: w, dateStr: ds })}
                    />
                  )
                })}

                {isToday && completedOtherDay.map(workout => {
                  const total = workout.plan_drills?.length ?? 0
                  return (
                    <Link
                      key={`other-${workout.id}`}
                      href={`/workouts/${workout.id}?kid=${kidId}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold bg-green-500 text-white">✓</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                        <div className="text-xs text-green-600 mt-0.5">Completed · from {DAYS_FULL[effectiveDay(workout) as number]}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{total} drill{total !== 1 ? 's' : ''}</div>
                      </div>
                      <span className="text-slate-300 text-xl flex-shrink-0">→</span>
                    </Link>
                  )
                })}

                {dateStr >= todayStr && (
                  <Link
                    href={`/workouts/new?kid=${kidId}&date=${dateStr}`}
                    className="flex items-center gap-2 px-4 py-3 text-sm text-slate-400 hover:text-blue-600 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-base leading-none">+</span> Add workout
                  </Link>
                )}
              </DroppableDayRow>
            )
          })}
        </div>

        {unscheduled.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Unscheduled</h2>
            <div className="space-y-2">
              {unscheduled.map(workout => {
                const total = workout.plan_drills?.length ?? 0
                return (
                  <div key={workout.id} className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-4 py-3">
                    <Link href={`/workouts/${workout.id}?kid=${kidId}`} className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                      {workout.focus && <div className="text-xs text-slate-500 mt-0.5">{workout.focus}</div>}
                      <div className="text-xs text-slate-400 mt-0.5">{total} drill{total !== 1 ? 's' : ''}</div>
                    </Link>
                    <button
                      onClick={() => setRescheduleTarget({ workout, dateStr: '' })}
                      className="text-slate-300 hover:text-blue-500 flex-shrink-0 transition-colors p-1 rounded-lg hover:bg-blue-50 text-sm"
                      title="Schedule this workout"
                    >
                      ⟲
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {dragging && (
            <DraggableWorkoutCard
              workout={dragging}
              kidId={kidId}
              dateStr=""
              doneCount={0}
              total={dragging.plan_drills?.length ?? 0}
              allDone={false}
              overlay
              onReschedule={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>

      {pendingDrag && (
        <DragScopeModal
          workoutName={pendingDrag.workout.name}
          fromDateStr={pendingDrag.fromDateStr}
          toDateStr={pendingDrag.toDateStr}
          onConfirm={applyDrag}
          onCancel={() => setPendingDrag(null)}
        />
      )}

      {rescheduleTarget && (
        <RescheduleModal
          planId={rescheduleTarget.workout.id}
          planName={rescheduleTarget.workout.name}
          currentDay={rescheduleTarget.workout.scheduled_day}
          onClose={() => setRescheduleTarget(null)}
          originalDate={rescheduleTarget.dateStr || undefined}
          kidId={rescheduleTarget.workout.kid_id}
          planDrills={rescheduleTarget.workout.plan_drills?.map(pd => ({ drill_id: pd.drill_id, display_order: pd.display_order }))}
        />
      )}
    </>
  )
}
