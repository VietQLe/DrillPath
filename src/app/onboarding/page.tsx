'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SPORT_EMOJI, SPORT_LABELS, AVATAR_COLORS, cn } from '@/lib/utils'
import type { Sport, SkillLevel } from '@/types'

const SPORTS: Sport[] = ['basketball', 'baseball', 'gymnastics', 'volleyball', 'jiujitsu']
const LEVELS: { value: SkillLevel; label: string; description: string }[] = [
  { value: 'beginner', label: 'Just Starting', description: 'Little to no experience' },
  { value: 'intermediate', label: 'Some Experience', description: 'Played 1–2 seasons' },
  { value: 'advanced', label: 'Competitive', description: 'Playing at a league level' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [sport, setSport] = useState<Sport | null>(null)
  const [level, setLevel] = useState<SkillLevel | null>(null)
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleFinish() {
    if (!sport || !level) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/auth/login')
      return
    }

    const { error } = await supabase.from('kids').insert({
      parent_id: user.id,
      name,
      age: parseInt(age),
      sport,
      skill_level: level,
      avatar_color: avatarColor,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🏆</div>
          <h1 className="text-3xl font-bold text-slate-900">AssistantCoach</h1>
          <p className="text-slate-400 text-sm mt-1">Step {step} of 3</p>
          <div className="flex gap-1.5 justify-center mt-3">
            {[1, 2, 3].map(s => (
              <div key={s} className={cn('h-1.5 rounded-full transition-all', s <= step ? 'w-8 bg-blue-600' : 'w-4 bg-slate-200')} />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {step === 1 && (
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Tell us about your athlete</h2>
              <p className="text-slate-500 text-sm mb-6">We'll personalize drills based on age and name.</p>

              <div className="mb-5">
                <p className="text-sm font-medium text-slate-700 mb-3">Pick an avatar color</p>
                <div className="flex gap-3">
                  {AVATAR_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => setAvatarColor(color)}
                      className={cn('w-10 h-10 rounded-full', color, avatarColor === color && 'ring-2 ring-offset-2 ring-blue-600')}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kid's name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Jordan"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Age</label>
                  <input
                    type="number"
                    value={age}
                    onChange={e => setAge(e.target.value)}
                    min={4}
                    max={18}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 10"
                  />
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!name || !age}
                className="mt-6 w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Pick a sport</h2>
              <p className="text-slate-500 text-sm mb-6">You can add more kids with different sports later.</p>

              <div className="space-y-3">
                {SPORTS.map(s => (
                  <button
                    key={s}
                    onClick={() => setSport(s)}
                    className={cn(
                      'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                      sport === s ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <span className="text-3xl">{SPORT_EMOJI[s]}</span>
                    <span className="font-medium text-slate-900">{SPORT_LABELS[s]}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(1)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors">
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!sport}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">What's {name}'s level?</h2>
              <p className="text-slate-500 text-sm mb-6">This helps us pick the right drills.</p>

              <div className="space-y-3">
                {LEVELS.map(l => (
                  <button
                    key={l.value}
                    onClick={() => setLevel(l.value)}
                    className={cn(
                      'w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left',
                      level === l.value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                    )}
                  >
                    <div>
                      <div className="font-medium text-slate-900">{l.label}</div>
                      <div className="text-sm text-slate-500">{l.description}</div>
                    </div>
                    {level === l.value && <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs">✓</div>}
                  </button>
                ))}
              </div>

              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 mt-6">
                <button onClick={() => setStep(2)} className="flex-1 py-2.5 border border-slate-300 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-colors">
                  Back
                </button>
                <button
                  onClick={handleFinish}
                  disabled={!level || loading}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors"
                >
                  {loading ? 'Saving...' : "Let's go!"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
