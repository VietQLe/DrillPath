'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type TraineeTodayWorkoutsClient from './TraineeTodayWorkoutsClient'

const TraineeTodayWorkouts = dynamic(() => import('./TraineeTodayWorkoutsClient'), { ssr: false })

export default function TraineeTodayWorkoutsNoSSR(
  props: ComponentProps<typeof TraineeTodayWorkoutsClient>
) {
  return <TraineeTodayWorkouts {...props} />
}
