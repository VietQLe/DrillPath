import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Sport, SkillLevel, AgeRange } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const SPORT_LABELS: Record<Sport, string> = {
  basketball: 'Basketball',
  baseball: 'Baseball / Softball',
  gymnastics: 'Gymnastics',
  volleyball: 'Volleyball',
  jiujitsu: 'Jiu-Jitsu',
}

export const SPORT_EMOJI: Record<Sport, string> = {
  basketball: '🏀',
  baseball: '⚾',
  gymnastics: '🤸',
  volleyball: '🏐',
  jiujitsu: '🥋',
}

export const LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export const LEVEL_COLORS: Record<SkillLevel, string> = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  advanced: 'bg-red-100 text-red-800',
}

export const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  '5-8': 'Ages 5–8',
  '9-12': 'Ages 9–12',
  '13+': 'Ages 13+',
}

export const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-green-500',
  'bg-teal-500',
]

export function getAgeRange(age: number): AgeRange {
  if (age <= 8) return '5-8'
  if (age <= 12) return '9-12'
  return '13+'
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
