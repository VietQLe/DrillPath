'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function FavoriteButton({
  templateId,
  initialFavorited,
}: {
  templateId: string
  initialFavorited: boolean
}) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    if (favorited) {
      await supabase.from('workout_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('template_id', templateId)
      setFavorited(false)
    } else {
      await supabase.from('workout_favorites')
        .insert({ user_id: user.id, template_id: templateId })
      setFavorited(true)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
      className="text-2xl leading-none disabled:opacity-40 transition-opacity hover:scale-110 transition-transform"
    >
      {favorited ? '❤️' : '🤍'}
    </button>
  )
}
