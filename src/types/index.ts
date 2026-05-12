export type Sport = 'basketball' | 'baseball' | 'gymnastics' | 'volleyball' | 'jiujitsu'
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced'
export type SkillFocus = 'speed' | 'agility' | 'strength' | 'technique' | 'endurance' | 'flexibility'
export type AgeRange = '5-8' | '9-12' | '13+'

export interface Kid {
  id: string
  parent_id: string
  name: string
  age: number
  sport: Sport
  skill_level: SkillLevel
  avatar_color: string
  trainee_user_id: string | null
  weight: number | null
  height: number | null
  avatar_url: string | null
  created_at: string
}

export interface TraineeInvite {
  id: string
  kid_id: string
  token: string
  created_by: string
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
}

export interface Drill {
  id: string
  title: string
  description: string
  sport: Sport
  skill_focus: SkillFocus
  difficulty: SkillLevel
  age_range: AgeRange
  duration_minutes: number
  equipment: string[]
  video_url: string | null
  thumbnail_url: string | null
  instructions: string[]
  created_by: string | null
  created_at: string
}

export interface SessionLog {
  id: string
  kid_id: string
  drill_id: string
  plan_id: string | null
  completed_at: string
  rating: 1 | 2 | 3 | null
  notes: string | null
  drill?: Drill
}

export interface TrainingPlan {
  id: string
  kid_id: string
  name: string
  focus: string | null
  scheduled_day: number | null
  start_date: string      // YYYY-MM-DD, first date active
  end_date: string | null // YYYY-MM-DD, null = ongoing
  created_at: string
  plan_drills?: PlanDrill[]
}

export interface PlanDrill {
  id: string
  plan_id: string
  drill_id: string
  display_order: number
  drill?: Drill
}

export interface WorkoutTemplate {
  id: string
  name: string
  focus: string | null
  sport: Sport
  difficulty: SkillLevel
  created_by: string | null
  created_at: string
  template_drills?: (TemplateDrill & { drill: Drill })[]
}

export interface TemplateDrill {
  id: string
  template_id: string
  drill_id: string
  display_order: number
  drill?: Drill
}

export interface DrillRecording {
  id: string
  kid_id: string
  drill_id: string
  plan_id: string | null
  video_url: string  // storage path: {kid_id}/{drill_id}/{uuid}.webm|mp4
  recorded_at: string
}
