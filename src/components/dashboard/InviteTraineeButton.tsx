'use client'

import { useState } from 'react'

export default function InviteTraineeButton({ kidId }: { kidId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setState('loading')
    setError(null)

    const res = await fetch('/api/invite/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kid_id: kidId }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to generate invite')
      setState('error')
      return
    }

    const url = `${window.location.origin}/invite/${data.token}`
    setInviteUrl(url)
    setState('done')
  }

  async function copy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (state === 'done' && inviteUrl) {
    return (
      <div className="mt-3 space-y-2">
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
    <div className="mt-2">
      {error && (
        <p className="text-xs text-red-600 mb-1">{error}</p>
      )}
      <button
        onClick={generate}
        disabled={state === 'loading'}
        className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
      >
        {state === 'loading' ? 'Generating…' : '+ Invite trainee'}
      </button>
    </div>
  )
}
