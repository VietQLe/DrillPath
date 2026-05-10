'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SPORT_EMOJI, LEVEL_LABELS, LEVEL_COLORS, AVATAR_COLORS, cn } from '@/lib/utils'
import type { Kid, Sport, SkillLevel } from '@/types'

function InviteSection({ kidId, linked }: { kidId: string; linked: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function generate() {
    setState('loading')
    setErr(null)
    const res = await fetch('/api/invite/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kid_id: kidId }),
    })
    const data = await res.json()
    if (!res.ok) { setErr(data.error ?? 'Failed to generate invite'); setState('error'); return }
    setInviteUrl(`${window.location.origin}/invite/${data.token}`)
    setState('done')
  }

  async function copy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (linked) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span className="text-sm text-slate-600">Trainee account linked</span>
      </div>
    )
  }

  if (state === 'done' && inviteUrl) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-500">Share this link with your trainee (expires in 7 days):</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={inviteUrl}
            className="flex-1 text-xs px-2 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 truncate"
          />
          <button
            onClick={copy}
            className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
      <button
        onClick={generate}
        disabled={state === 'loading'}
        className="w-full py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
      >
        {state === 'loading' ? 'Generating…' : '+ Invite trainee'}
      </button>
    </div>
  )
}

const SPORTS: Sport[] = ['basketball', 'baseball', 'gymnastics']
const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced']

function heightDisplay(inches: number | null): string {
  if (inches === null) return '—'
  const ft = Math.floor(inches / 12)
  const rem = Math.round(inches % 12)
  return `${ft}'${rem}"`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  )
}

export default function KidProfileClient({
  kid: initialKid,
  role,
}: {
  kid: Kid
  role: 'trainer' | 'trainee'
}) {
  const [kid, setKid] = useState(initialKid)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: initialKid.name,
    age: initialKid.age.toString(),
    weight: initialKid.weight?.toString() ?? '',
    height: initialKid.height?.toString() ?? '',
    sport: initialKid.sport,
    skill_level: initialKid.skill_level,
    avatar_color: initialKid.avatar_color,
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  const backHref = role === 'trainer' ? '/dashboard' : '/trainee'

  async function handlePhotoUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    setImgFailed(false)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${kid.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('kid-avatars')
        .upload(path, file, { upsert: false })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage
        .from('kid-avatars')
        .getPublicUrl(path)

      const res = await fetch('/api/kids/avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kid_id: kid.id, avatar_url: publicUrl }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save avatar')
      }

      setKid(k => ({ ...k, avatar_url: publicUrl }))
      setCacheBust(n => n + 1)
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updates: Record<string, unknown> = {
        weight: form.weight ? parseFloat(form.weight) : null,
        height: form.height ? parseFloat(form.height) : null,
      }
      if (role === 'trainer') {
        updates.name = form.name.trim()
        updates.age = parseInt(form.age)
        updates.sport = form.sport
        updates.skill_level = form.skill_level
        updates.avatar_color = form.avatar_color
      }

      const { error: err } = await supabase
        .from('kids')
        .update(updates)
        .eq('id', kid.id)
      if (err) throw err

      setKid(k => ({ ...k, ...updates } as Kid))
      setEditing(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setError(null)
    setForm({
      name: kid.name,
      age: kid.age.toString(),
      weight: kid.weight?.toString() ?? '',
      height: kid.height?.toString() ?? '',
      sport: kid.sport,
      skill_level: kid.skill_level,
      avatar_color: kid.avatar_color,
    })
  }

  const avatarSrc = kid.avatar_url ? `${kid.avatar_url}?v=${cacheBust}` : null

  return (
    <div className="max-w-2xl mx-auto p-4 pb-8">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        ← Back
      </Link>

      {/* Avatar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-4 flex flex-col items-center gap-3">
        <div className="relative">
          {avatarSrc && !imgFailed ? (
            <img
              src={avatarSrc}
              alt={kid.name}
              className="w-24 h-24 rounded-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className={cn(
              'w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold',
              kid.avatar_color
            )}>
              {kid.name[0].toUpperCase()}
            </div>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute bottom-0 right-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-blue-700 transition-colors text-base leading-none disabled:opacity-60"
            title="Upload photo"
          >
            {uploading ? '…' : '📷'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handlePhotoUpload(file)
            e.target.value = ''
          }}
        />
        {uploadError && (
          <p className="text-xs text-red-500 text-center">{uploadError}</p>
        )}
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">{kid.name}</h1>
          <div className="flex items-center justify-center gap-2 mt-1">
            <span>{SPORT_EMOJI[kid.sport]}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_COLORS[kid.skill_level])}>
              {LEVEL_LABELS[kid.skill_level]}
            </span>
          </div>
        </div>
      </div>

      {/* Profile fields */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900">Profile</h2>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-4">
            {role === 'trainer' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Age</label>
                  <input
                    type="number"
                    min={4}
                    max={18}
                    value={form.age}
                    onChange={e => setForm(f => ({ ...f, age: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Weight (lbs)</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.weight}
                  onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                  placeholder="—"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Height (in)</label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={form.height}
                  onChange={e => setForm(f => ({ ...f, height: e.target.value }))}
                  placeholder="—"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>

            {role === 'trainer' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sport</label>
                  <div className="flex gap-2">
                    {SPORTS.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, sport: s }))}
                        className={cn(
                          'flex-1 py-2 rounded-xl border text-sm font-medium capitalize transition-colors',
                          form.sport === s
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        )}
                      >
                        {SPORT_EMOJI[s]}
                        <span className="ml-1 hidden sm:inline">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Skill Level</label>
                  <div className="flex gap-2">
                    {SKILL_LEVELS.map(sl => (
                      <button
                        key={sl}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, skill_level: sl }))}
                        className={cn(
                          'flex-1 py-2 rounded-xl border text-sm font-medium capitalize transition-colors',
                          form.skill_level === sl
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        )}
                      >
                        {sl}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Avatar Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {AVATAR_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, avatar_color: color }))}
                        className={cn(
                          'w-9 h-9 rounded-full transition-transform',
                          color,
                          form.avatar_color === color ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''
                        )}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={handleCancel}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            {role === 'trainer' && (
              <>
                <Row label="Name" value={kid.name} />
                <Row label="Age" value={`${kid.age} yrs`} />
              </>
            )}
            <Row label="Weight" value={kid.weight ? `${kid.weight} lbs` : '—'} />
            <Row label="Height" value={heightDisplay(kid.height)} />
            {role === 'trainer' && (
              <>
                <Row label="Sport" value={`${SPORT_EMOJI[kid.sport]} ${kid.sport}`} />
                <Row label="Skill Level" value={LEVEL_LABELS[kid.skill_level]} />
              </>
            )}
          </div>
        )}
      </div>

      {role === 'trainer' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mt-4">
          <h2 className="font-semibold text-slate-900 mb-4">Trainee</h2>
          <InviteSection kidId={kid.id} linked={!!kid.trainee_user_id} />
        </div>
      )}
    </div>
  )
}
