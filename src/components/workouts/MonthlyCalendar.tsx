'use client'

import { useState, useCallback } from 'react'
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
import type { Kid, TrainingPlan, PlanDrill, Drill } from '@/types'

type WorkoutWithDrills = TrainingPlan & { plan_drills: (PlanDrill & { drill: Drill })[] }
type MonthLog = { plan_id: string | null; drill_id: string; completed_at: string }

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function jsToCol(jsDay: number) { return jsDay === 0 ? 6 : jsDay - 1 }

function localDateStr(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- DraggableChip ----------
function DraggableChip({
  workout,
  dateStr,
  kidId,
  isDone,
  isPartial,
  isPast,
  overlay = false,
  onReschedule,
}: {
  workout: WorkoutWithDrills
  dateStr: string
  kidId: string
  isDone: boolean
  isPartial: boolean
  isPast: boolean
  overlay?: boolean
  onReschedule: (w: WorkoutWithDrills, dateStr: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `chip-${workout.id}-${dateStr}`,
    data: { workout, dateStr },
    disabled: isDone,
  })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  const chipCn = cn(
    'flex items-center gap-0.5 text-[10px] leading-tight px-1 py-0.5 rounded-sm font-medium',
    isDragging && !overlay ? 'opacity-40' : '',
    overlay ? 'shadow-lg ring-1 ring-blue-300' : '',
    isDone ? 'bg-green-100 text-green-800' :
    isPartial ? 'bg-yellow-100 text-yellow-800' :
    isPast ? 'bg-red-50 text-red-400' :
    'bg-blue-50 text-blue-700'
  )

  return (
    <div ref={overlay ? undefined : setNodeRef} style={overlay ? undefined : style} className={chipCn}>
      {!isDone && (
        <span
          {...(overlay ? {} : { ...listeners, ...attributes })}
          className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 leading-none opacity-40 hover:opacity-80"
          onClick={e => e.preventDefault()}
        >
          ⠿
        </span>
      )}
      <Link
        href={`/workouts/${workout.id}?kid=${kidId}&date=${dateStr}`}
        className="flex-1 truncate"
        onClick={e => e.stopPropagation()}
      >
        {workout.name}
      </Link>
      {!isDone && (
        <button
          onClick={e => { e.preventDefault(); onReschedule(workout, dateStr) }}
          className="opacity-40 hover:opacity-100 flex-shrink-0 leading-none pl-0.5"
          title="Reschedule"
        >
          ⟲
        </button>
      )}
    </div>
  )
}

// ---------- DroppableCell ----------
function DroppableCell({
  dateStr,
  date,
  isToday,
  children,
}: {
  dateStr: string
  date: number
  isToday: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `date-${dateStr}` })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[68px] p-1 transition-colors',
        isOver ? 'bg-blue-100 ring-1 ring-inset ring-blue-300' :
        isToday ? 'bg-blue-50' : 'bg-white'
      )}
    >
      <div className={cn(
        'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold mb-1 mx-auto',
        isToday ? 'bg-blue-600 text-white' : 'text-slate-500'
      )}>
        {date}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

type PendingDrag = { workout: WorkoutWithDrills; fromDateStr: string; newDay: number; toDateStr: string }
type RescheduleTarget = { workout: WorkoutWithDrills; dateStr: string }

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
  month: number
  workouts: WorkoutWithDrills[]
  sessionLogs: MonthLog[]
  selectedKid: Kid
  exceptions: Set<string>
  prevUrl: string
  nextUrl: string
}) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [dragging, setDragging] = useState<{ workout: WorkoutWithDrills; dateStr: string } | null>(null)
  const [pendingDrag, setPendingDrag] = useState<PendingDrag | null>(null)
  const [rescheduleTarget, setRescheduleTarget] = useState<RescheduleTarget | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } })
  )

  const today = new Date()
  const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate()
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const completedMap = new Map<string, Set<string>>()
  for (const log of sessionLogs) {
    if (!log.plan_id) continue
    const key = `${log.plan_id}:${localDateStr(log.completed_at)}`
    if (!completedMap.has(key)) completedMap.set(key, new Set())
    completedMap.get(key)!.add(log.drill_id)
  }

  const effectiveDay = useCallback(
    (w: WorkoutWithDrills): number | null | undefined =>
      overrides[w.id] !== undefined ? overrides[w.id] : w.scheduled_day,
    [overrides]
  )

  const firstJsDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startCol = jsToCol(firstJsDay)
  const cells: (number | null)[] = [
    ...Array(startCol).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function isActiveOnDate(workout: WorkoutWithDrills, dateStr: string): boolean {
    if (workout.start_date && dateStr < workout.start_date) return false
    if (workout.end_date && dateStr > workout.end_date) return false
    if (exceptions.has(`${workout.id}:${dateStr}`)) return false
    return true
  }

  const scheduledWorkouts = workouts.filter(w =>
    effectiveDay(w) !== null && effectiveDay(w) !== undefined
  )
  const unscheduled = workouts.filter(w =>
    effectiveDay(w) === null || effectiveDay(w) === undefined
  )

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { workout: WorkoutWithDrills; dateStr: string } | undefined
    setDragging(data ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const data = active.data.current as { workout: WorkoutWithDrills; dateStr: string } | undefined
    if (!data) return
    const { workout, dateStr: fromDateStr } = data

    const toDateStr = over.id.toString().replace('date-', '')
    const [ty, tm, td] = toDateStr.split('-').map(Number)
    const newDay = new Date(ty, tm - 1, td).getDay()

    const curDay = effectiveDay(workout)
    if (curDay === newDay) return

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
        <div className="flex items-center justify-between mb-4">
          <Link href={prevUrl} className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium">← Prev</Link>
          <span className="font-semibold text-slate-900">{monthName}</span>
          <Link href={nextUrl} className="px-3 py-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium">Next →</Link>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {DAY_HEADERS.map(h => (
            <div key={h} className="text-center text-[11px] font-semibold text-slate-400 py-1">{h}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
          {cells.map((date, i) => {
            if (date === null) return <div key={i} className="bg-slate-50 min-h-[68px]" />

            const isToday = date === todayD && month === todayM && year === todayY
            const cellDate = new Date(year, month, date)
            const isPast = cellDate < new Date(todayY, todayM, todayD)
            const jsDay = cellDate.getDay()
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`
            const dayWorkouts = scheduledWorkouts.filter(
              w => effectiveDay(w) === jsDay && isActiveOnDate(w, dateStr)
            )

            return (
              <DroppableCell key={i} dateStr={dateStr} date={date} isToday={isToday}>
                {dayWorkouts.map(workout => {
                  const completed = completedMap.get(`${workout.id}:${dateStr}`)?.size ?? 0
                  const total = workout.plan_drills?.length ?? 0
                  return (
                    <DraggableChip
                      key={workout.id}
                      workout={workout}
                      dateStr={dateStr}
                      kidId={selectedKid.id}
                      isDone={total > 0 && completed >= total}
                      isPartial={completed > 0 && completed < total}
                      isPast={isPast}
                      onReschedule={(w, ds) => setRescheduleTarget({ workout: w, dateStr: ds })}
                    />
                  )
                })}
              </DroppableCell>
            )
          })}
        </div>

        <div className="flex gap-4 mt-3 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-100 border border-green-300 flex-shrink-0" />Completed</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200 flex-shrink-0" />Upcoming</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-50 border border-red-200 flex-shrink-0" />Missed</span>
        </div>

        {unscheduled.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">Unscheduled</h2>
            <div className="space-y-2">
              {unscheduled.map(workout => {
                const total = workout.plan_drills?.length ?? 0
                return (
                  <div key={workout.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3">
                    <Link href={`/workouts/${workout.id}?kid=${selectedKid.id}`} className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm">{workout.name}</div>
                      {workout.focus && <div className="text-xs text-slate-500 mt-0.5">{workout.focus}</div>}
                      <div className="text-xs text-slate-400 mt-0.5">{total} drill{total !== 1 ? 's' : ''}</div>
                    </Link>
                    <button
                      onClick={() => setRescheduleTarget({ workout, dateStr: '' })}
                      className="text-slate-300 hover:text-blue-500 transition-colors p-1 rounded-lg hover:bg-blue-50 text-sm"
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
            <DraggableChip
              workout={dragging.workout}
              dateStr={dragging.dateStr}
              kidId={selectedKid.id}
              isDone={false}
              isPartial={false}
              isPast={false}
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
