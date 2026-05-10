'use client'

import { useRouter } from 'next/navigation'
import { SPORT_EMOJI } from '@/lib/utils'
import type { Kid } from '@/types'

export default function KidDropdown({
  kids,
  selectedKidId,
  view,
  monthStr,
}: {
  kids: Kid[]
  selectedKidId: string
  view: string
  monthStr: string
}) {
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const kidId = e.target.value
    const url = `/workouts?kid=${kidId}&view=${view}${view === 'month' ? `&month=${monthStr}` : ''}`
    router.push(url)
  }

  return (
    <select
      value={selectedKidId}
      onChange={handleChange}
      className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 focus:outline-none focus:border-blue-400 cursor-pointer"
    >
      {kids.map(kid => (
        <option key={kid.id} value={kid.id}>
          {SPORT_EMOJI[kid.sport]} {kid.name}
        </option>
      ))}
    </select>
  )
}
