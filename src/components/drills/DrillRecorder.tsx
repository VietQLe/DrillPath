'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { createShotTracker, type ShotCounts, type Box } from '@/lib/shotTracker'
import type { DrillRecording } from '@/types'

type RecordState = 'idle' | 'context' | 'setup' | 'recording' | 'review' | 'uploading'

type CourtType = 'indoor_gym' | 'outdoor_driveway' | 'outdoor_court'
const COURT_TYPES: { id: CourtType; icon: string; label: string }[] = [
  { id: 'indoor_gym',        icon: '🏫', label: 'Indoor Gym'    },
  { id: 'outdoor_driveway',  icon: '🏠', label: 'Driveway'      },
  { id: 'outdoor_court',     icon: '⛹️', label: 'Outdoor Court' },
]

type CoachInsights = {
  overall: string
  strengths: string[]
  improvements: string[]
  keyFocus: string
}

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

type DrillContext = {
  title: string
  description?: string
  instructions?: string[]
  sport?: string
  skillLevel?: string
}

function ShotCounter({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-white/60 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(value - 1)}
          disabled={value <= 0}
          className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white font-bold text-lg leading-none transition-colors"
        >−</button>
        <span className="w-8 text-center text-xl font-bold text-white">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={max !== undefined && value >= max}
          className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white font-bold text-lg leading-none transition-colors"
        >+</button>
      </div>
    </div>
  )
}

export default function DrillRecorder({
  drillId,
  planId,
  kidId,
  initialRecordings,
  drillContext,
}: {
  drillId: string
  planId: string | null
  kidId: string | null
  initialRecordings: DrillRecording[]
  drillContext?: DrillContext
}) {
  const [recordings, setRecordings] = useState(initialRecordings)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [insights, setInsights] = useState<Record<string, CoachInsights>>({})
  const [insightsLoading, setInsightsLoading] = useState<Record<string, boolean>>({})
  const [insightsError, setInsightsError] = useState<Record<string, string>>({})

  // Shot counting state
  const [liveShots, setLiveShots] = useState<ShotCounts>({ attempts: 0, ballDetected: false, ballBox: null, hoopBox: null })
  const [reviewAttempts, setReviewAttempts] = useState(0)
  const [reviewMakes, setReviewMakes] = useState(0)
  const [courtType, setCourtType] = useState<CourtType | null>(null)
  const [isLandscape, setIsLandscape] = useState(false)

  useEffect(() => {
    const check = () => setIsLandscape(window.innerWidth > window.innerHeight)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const reviewVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef = useRef<number | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const trackerRef = useRef(createShotTracker())

  const isBasketball = drillContext?.sport === 'basketball'

  useEffect(() => {
    if (recordings.length === 0) return
    const supabase = createClient()
    Promise.all(
      recordings.map(async (rec) => {
        const { data } = await supabase.storage
          .from('drill-recordings')
          .createSignedUrl(rec.video_url, 3600)
        return data ? [rec.id, data.signedUrl] as const : null
      })
    ).then((results) => {
      const urls: Record<string, string> = {}
      for (const r of results) { if (r) urls[r[0]] = r[1] }
      setSignedUrls(urls)
    })
  }, [recordings])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const revokeBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [])

  function drawOverlay(ballBox: Box | null, hoopBox: Box | null) {
    const canvas = overlayCanvasRef.current
    const video = liveVideoRef.current
    if (!canvas || !video || video.videoWidth === 0) return

    const rect = video.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const cw = Math.round(rect.width * dpr)
    const ch = Math.round(rect.height * dpr)

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Use DPR-aware transform so coordinates are in CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Map from processed-frame coords (320px wide) to display coords (object-cover)
    const procW = 320
    const procH = Math.round(320 * video.videoHeight / video.videoWidth)
    const scale = Math.max(rect.width / procW, rect.height / procH)
    const offX = (procW * scale - rect.width) / 2
    const offY = (procH * scale - rect.height) / 2

    const px = (x: number) => x * scale - offX
    const py = (y: number) => y * scale - offY
    const ps = (n: number) => n * scale

    function drawBox(box: Box, color: string, label: string) {
      const c = ctx! // non-null: checked above before drawBox is called
      const bx = px(box.x), by = py(box.y), bw = ps(box.w), bh = ps(box.h)
      c.strokeStyle = color
      c.lineWidth = 2
      c.setLineDash([5, 3])
      c.strokeRect(bx, by, bw, bh)
      c.setLineDash([])

      // Label pill above the box
      c.font = 'bold 10px system-ui, sans-serif'
      const tw = c.measureText(label).width
      const lx = bx, ly = by - 16
      c.fillStyle = 'rgba(0,0,0,0.55)'
      c.beginPath()
      c.roundRect(lx, ly, tw + 8, 14, 4)
      c.fill()
      c.fillStyle = color
      c.fillText(label, lx + 4, ly + 10)
    }

    if (hoopBox) drawBox(hoopBox, '#4ade80', 'HOOP')  // green
    if (ballBox) drawBox(ballBox, '#fb923c', 'BALL')   // orange
  }

  function clearOverlay() {
    const canvas = overlayCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function stopTracking() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    clearOverlay()
  }

  function startTracking() {
    trackerRef.current.reset()
    setLiveShots({ attempts: 0, ballDetected: false, ballBox: null, hoopBox: null })

    function loop() {
      const video = liveVideoRef.current
      if (video && video.readyState >= 2) {
        const counts = trackerRef.current.processFrame(video)
        setLiveShots(counts)
        drawOverlay(counts.ballBox, counts.hoopBox)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  async function openCamera(facing: 'environment' | 'user' = facingMode) {
    stopStream()
    setError(null)
    setRecordState('setup')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      streamRef.current = stream
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream
        liveVideoRef.current.play()
      }
    } catch {
      setError('Camera access denied. Please allow camera permissions.')
      setRecordState('idle')
    }
  }

  async function flipCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    await openCamera(next)
  }

  function startRecording() {
    if (!streamRef.current) return
    chunksRef.current = []

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : 'video/mp4'

    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      stopTracking()
      const finalCounts = trackerRef.current.getCounts()

      const mimeBase = mimeType.split(';')[0]
      const blob = new Blob(chunksRef.current, { type: mimeBase })
      blobRef.current = blob
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      stopStream()

      if (isBasketball) {
        setReviewAttempts(finalCounts.attempts)
        setReviewMakes(0)
      }

      setRecordState('review')
      requestAnimationFrame(() => {
        if (reviewVideoRef.current) reviewVideoRef.current.src = url
      })
    }
    recorder.start(100)
    recorderRef.current = recorder
    setElapsed(0)
    setRecordState('recording')
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    if (isBasketball) startTracking()
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
  }

  function retake() {
    blobRef.current = null
    revokeBlobUrl()
    setReviewAttempts(0)
    setReviewMakes(0)
    setLiveShots({ attempts: 0, ballDetected: false, ballBox: null, hoopBox: null })
    openCamera()
  }

  function close() {
    if (timerRef.current) clearInterval(timerRef.current)
    stopTracking()
    stopStream()
    revokeBlobUrl()
    blobRef.current = null
    setRecordState('idle')
    setElapsed(0)
    setError(null)
    setReviewAttempts(0)
    setReviewMakes(0)
    setLiveShots({ attempts: 0, ballDetected: false, ballBox: null, hoopBox: null })
    setCourtType(null)
  }

  async function save() {
    if (!blobRef.current || !planId || !kidId) return
    setRecordState('uploading')
    const supabase = createClient()
    const blob = blobRef.current
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
    const path = `${kidId}/${drillId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('drill-recordings')
      .upload(path, blob, { contentType: blob.type })

    if (uploadErr) {
      setError('Upload failed. Please try again.')
      setRecordState('review')
      return
    }

    const { data: row, error: insertErr } = await supabase
      .from('drill_recordings')
      .insert({ kid_id: kidId, drill_id: drillId, plan_id: planId, video_url: path })
      .select()
      .single()

    if (insertErr) {
      setError('Failed to save recording. Please try again.')
      setRecordState('review')
      return
    }

    // Basketball + shots tracked: also mark drill complete in session_logs
    if (isBasketball && reviewAttempts > 0) {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: existing } = await supabase
        .from('session_logs')
        .select('id')
        .eq('plan_id', planId)
        .eq('kid_id', kidId)
        .eq('drill_id', drillId)
        .gte('completed_at', todayStart.toISOString())
        .maybeSingle()
      if (existing) {
        await supabase
          .from('session_logs')
          .update({ shot_attempts: reviewAttempts, shot_makes: reviewMakes })
          .eq('id', existing.id)
      } else {
        await supabase.from('session_logs').insert({
          kid_id: kidId,
          drill_id: drillId,
          plan_id: planId,
          shot_attempts: reviewAttempts,
          shot_makes: reviewMakes,
        })
      }
    }

    if (row) {
      const { data: signed } = await supabase.storage
        .from('drill-recordings')
        .createSignedUrl(path, 3600)
      const newRec = row as DrillRecording
      setRecordings((prev) => [newRec, ...prev])
      if (signed) setSignedUrls((prev) => ({ ...prev, [newRec.id]: signed.signedUrl }))
    }

    close()
  }

  async function deleteRecording(id: string, videoUrl: string) {
    setPendingDeleteId(null)
    setRecordings((prev) => prev.filter((r) => r.id !== id))
    setSignedUrls((prev) => { const next = { ...prev }; delete next[id]; return next })
    const supabase = createClient()
    await Promise.all([
      supabase.storage.from('drill-recordings').remove([videoUrl]),
      supabase.from('drill_recordings').delete().eq('id', id),
    ])
  }

  async function extractFrames(videoSrc: string): Promise<string[]> {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.muted = true
      video.preload = 'auto'
      let settled = false
      const done = (frames: string[]) => { if (!settled) { settled = true; resolve(frames) } }
      const timeout = setTimeout(() => done([]), 15000)
      video.addEventListener('error', () => { clearTimeout(timeout); done([]) })
      video.addEventListener('loadedmetadata', () => {
        const duration = video.duration
        if (!isFinite(duration) || duration <= 0) { clearTimeout(timeout); done([]); return }
        const MAX = 480
        const vw = video.videoWidth || 640
        const vh = video.videoHeight || 360
        const scale = Math.min(MAX / vw, MAX / vh, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(vw * scale)
        canvas.height = Math.round(vh * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) { clearTimeout(timeout); done([]); return }
        const count = Math.min(6, Math.max(2, Math.round(duration / 5)))
        const timestamps = Array.from({ length: count }, (_, i) => (duration * (i + 1)) / (count + 1))
        const frames: string[] = []
        let idx = 0
        video.addEventListener('seeked', function onSeeked() {
          try {
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            frames.push(canvas.toDataURL('image/jpeg', 0.65).split(',')[1])
          } catch { /* canvas tainted */ }
          idx++
          if (idx < timestamps.length) {
            video.currentTime = timestamps[idx]
          } else {
            video.removeEventListener('seeked', onSeeked)
            clearTimeout(timeout)
            done(frames)
          }
        })
        video.currentTime = timestamps[0]
      })
      video.src = videoSrc
      video.load()
    })
  }

  async function getInsights(recId: string) {
    const signedUrl = signedUrls[recId]
    if (!signedUrl || insightsLoading[recId] || insights[recId]) return
    setInsightsLoading(prev => ({ ...prev, [recId]: true }))
    setInsightsError(prev => { const n = { ...prev }; delete n[recId]; return n })
    try {
      const frames = await extractFrames(signedUrl)
      const res = await fetch('/api/coach-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          drillTitle: drillContext?.title,
          drillDescription: drillContext?.description,
          drillInstructions: drillContext?.instructions,
          sport: drillContext?.sport,
          level: drillContext?.skillLevel,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as CoachInsights
      setInsights(prev => ({ ...prev, [recId]: data }))
    } catch {
      setInsightsError(prev => ({ ...prev, [recId]: 'Could not generate insights. Please try again.' }))
    } finally {
      setInsightsLoading(prev => { const n = { ...prev }; delete n[recId]; return n })
    }
  }

  const inModal = recordState !== 'idle'

  return (
    <>
      {/* Existing recordings */}
      {recordings.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-3">
            Your recordings{recordings.length > 1 ? ` (${recordings.length})` : ''}
          </h2>
          <div className="space-y-4">
            {recordings.map((rec) => (
              <div key={rec.id}>
                <div className="rounded-xl overflow-hidden bg-slate-100 aspect-video relative">
                  {signedUrls[rec.id] ? (
                    <video src={signedUrls[rec.id]} controls playsInline className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">Loading…</div>
                  )}
                  {pendingDeleteId !== rec.id ? (
                    <button
                      onClick={() => setPendingDeleteId(rec.id)}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
                      aria-label="Delete recording"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  ) : (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3">
                      <p className="text-white text-sm font-semibold">Delete this recording?</p>
                      <div className="flex gap-2">
                        <button onClick={() => setPendingDeleteId(null)} className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm transition-colors">Cancel</button>
                        <button onClick={() => deleteRecording(rec.id, rec.video_url)} className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors">Delete</button>
                      </div>
                    </div>
                  )}
                </div>

                {!insights[rec.id] && (
                  <button
                    onClick={() => getInsights(rec.id)}
                    disabled={insightsLoading[rec.id] || !signedUrls[rec.id]}
                    className={`mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 text-sm font-semibold transition-colors ${
                      insightsLoading[rec.id]
                        ? 'border-violet-200 bg-violet-50 text-violet-400 cursor-wait'
                        : 'border-violet-300 text-violet-700 hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed'
                    }`}
                  >
                    {insightsLoading[rec.id] ? (
                      <><div className="w-4 h-4 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />Analyzing performance…</>
                    ) : (
                      <><span>🧠</span> Get Coach Insights</>
                    )}
                  </button>
                )}

                {insightsError[rec.id] && (
                  <p className="mt-1 text-xs text-red-500 text-center">{insightsError[rec.id]}</p>
                )}

                {insights[rec.id] && (
                  <div className="mt-2 rounded-xl bg-violet-50 border border-violet-200 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>🧠</span>
                        <span className="font-semibold text-violet-800 text-sm">Coach Insights</span>
                      </div>
                      <button
                        onClick={() => setInsights(prev => { const n = { ...prev }; delete n[rec.id]; return n })}
                        className="text-violet-400 hover:text-violet-600 text-lg leading-none transition-colors"
                        aria-label="Dismiss"
                      >×</button>
                    </div>
                    <p className="text-sm text-violet-800 leading-relaxed">{insights[rec.id].overall}</p>
                    {insights[rec.id].strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">Doing well</p>
                        <ul className="space-y-1">
                          {insights[rec.id].strengths.map((s, i) => (
                            <li key={i} className="flex gap-2 text-sm text-violet-700"><span className="text-green-500 flex-shrink-0">✓</span>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insights[rec.id].improvements.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">Work on</p>
                        <ul className="space-y-1">
                          {insights[rec.id].improvements.map((s, i) => (
                            <li key={i} className="flex gap-2 text-sm text-violet-700"><span className="text-amber-500 flex-shrink-0">→</span>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="rounded-lg bg-violet-100 border border-violet-200 px-3 py-2">
                      <p className="text-xs font-semibold text-violet-600 mb-0.5">Focus next time</p>
                      <p className="text-sm text-violet-800">{insights[rec.id].keyFocus}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record button */}
      {!inModal && planId && kidId && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-1">Record yourself</h2>
          <p className="text-sm text-slate-500 mb-4">
            Capture a clip of your performance to review and track progress over time.
          </p>
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
          <button
            onClick={() => setRecordState('context')}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <span>●</span> Start recording
          </button>
        </div>
      )}

      {/* Full-screen camera modal */}
      {inModal && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">

          {/* ── Context / setup questionnaire ── */}
          {recordState === 'context' && (
            <div className="flex-1 overflow-y-auto px-5 py-8 flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-white text-xl font-bold">Set up shot tracking</h2>
                  <p className="text-white/50 text-sm mt-0.5">We&apos;ll count attempts automatically</p>
                </div>
                <button onClick={close} className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center text-xl leading-none" aria-label="Close">×</button>
              </div>

              {/* Court type */}
              <p className="text-white/70 text-sm font-semibold mb-3">Where are you shooting?</p>
              <div className="grid grid-cols-3 gap-3 mb-8">
                {COURT_TYPES.map((ct) => (
                  <button
                    key={ct.id}
                    onClick={() => setCourtType(ct.id)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-colors ${
                      courtType === ct.id
                        ? 'border-orange-400 bg-orange-400/15'
                        : 'border-white/15 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <span className="text-3xl">{ct.icon}</span>
                    <span className="text-white text-xs font-semibold">{ct.label}</span>
                  </button>
                ))}
              </div>

              {/* Camera placement instructions */}
              <div className="rounded-2xl bg-white/8 border border-white/10 p-4 mb-8 space-y-4">
                <p className="text-white font-semibold text-sm">Camera placement</p>
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">📱</span>
                  <div>
                    <p className="text-white text-sm font-medium">Landscape mode</p>
                    <p className="text-white/50 text-xs mt-0.5">Rotate your phone sideways before recording</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">📍</span>
                  <div>
                    <p className="text-white text-sm font-medium">Beyond the 3-point line</p>
                    <p className="text-white/50 text-xs mt-0.5">Set the phone on the ground or a tripod — far enough to see the full arc of your shot</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">🎯</span>
                  <div>
                    <p className="text-white text-sm font-medium">Point at the basket</p>
                    <p className="text-white/50 text-xs mt-0.5">Keep the hoop in the upper half of the frame at all times</p>
                  </div>
                </div>
              </div>

              <div className="mt-auto">
                <button
                  onClick={() => openCamera()}
                  disabled={!courtType}
                  className="w-full py-4 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-bold text-base transition-colors"
                >
                  Open Camera →
                </button>
                {!courtType && (
                  <p className="text-white/40 text-xs text-center mt-2">Select a court type to continue</p>
                )}
              </div>
            </div>
          )}

          {/* ── Camera view (setup / recording / review) ── */}
          {recordState !== 'context' && (
            <>
              <div className="flex-1 relative overflow-hidden">
                {/* Live preview */}
                <video
                  ref={liveVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`w-full h-full object-cover ${
                    recordState === 'review' || recordState === 'uploading' ? 'hidden' : ''
                  }`}
                />

                {/* Landscape warning — setup only */}
                {recordState === 'setup' && !isLandscape && (
                  <div className="absolute inset-0 z-10 bg-black/85 flex flex-col items-center justify-center gap-3 pointer-events-none">
                    <span className="text-6xl" style={{ display: 'inline-block', transform: 'rotate(-90deg)' }}>📱</span>
                    <p className="text-white text-lg font-bold">Rotate to landscape</p>
                    <p className="text-white/50 text-sm text-center px-10">Landscape mode gives the best view for tracking shots</p>
                  </div>
                )}

                {/* Hoop alignment guide — setup + landscape only */}
                {isBasketball && recordState === 'setup' && isLandscape && (
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Small hoop zone: upper-center, reflects actual hoop size from 3pt line */}
                    <div
                      className="absolute border-2 border-dashed border-yellow-400 rounded-lg"
                      style={{ left: '37%', right: '37%', top: '6%', height: '38%' }}
                    >
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap flex items-center gap-1">
                        <span className="bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded-full">
                          🏀 Hoop
                        </span>
                      </div>
                      <div className="absolute top-0 left-0 w-3 h-3 border-t-4 border-l-4 border-yellow-300" />
                      <div className="absolute top-0 right-0 w-3 h-3 border-t-4 border-r-4 border-yellow-300" />
                      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-4 border-l-4 border-yellow-300" />
                      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-4 border-r-4 border-yellow-300" />
                    </div>
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                      <span className="bg-black/60 text-white/80 text-xs px-3 py-1 rounded-full">
                        Back up until you can see the full shooting arc
                      </span>
                    </div>
                  </div>
                )}

                {/* Ball + hoop tracking overlay (basketball, recording only) */}
                {isBasketball && (
                  <canvas
                    ref={overlayCanvasRef}
                    className={`absolute inset-0 w-full h-full pointer-events-none ${
                      recordState !== 'recording' ? 'opacity-0' : ''
                    }`}
                  />
                )}

                {/* Playback preview */}
                <video
                  ref={reviewVideoRef}
                  controls
                  playsInline
                  className={`w-full h-full object-cover ${
                    recordState !== 'review' && recordState !== 'uploading' ? 'hidden' : ''
                  }`}
                />

                {/* Close button */}
                {recordState !== 'uploading' && (
                  <button
                    onClick={close}
                    className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center text-2xl leading-none"
                    aria-label="Close"
                  >×</button>
                )}

                {/* Recording timer */}
                {recordState === 'recording' && (
                  <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-white text-sm font-mono">{formatTime(elapsed)}</span>
                  </div>
                )}

                {/* Live shot counter badge (basketball only) */}
                {recordState === 'recording' && isBasketball && (
                  <div className={`absolute top-4 right-16 flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ${
                    liveShots.ballDetected ? 'bg-orange-500/80' : 'bg-black/60'
                  }`}>
                    <span className="text-base leading-none">🏀</span>
                    <span className="text-white text-sm font-mono tabular-nums font-semibold">
                      {liveShots.attempts}
                    </span>
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="p-6 pb-10 flex flex-col items-center gap-3">
                {recordState === 'setup' && (
                  <>
                    <div className="flex items-center gap-8">
                      <button
                        onClick={flipCamera}
                        className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                        aria-label="Flip camera"
                      >
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      </button>
                      <button
                        onClick={startRecording}
                        disabled={isBasketball && !isLandscape}
                        className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 disabled:opacity-40 flex items-center justify-center transition-colors"
                        aria-label="Start recording"
                      >
                        <span className="w-6 h-6 rounded-full bg-white" />
                      </button>
                      <div className="w-11 h-11" />
                    </div>
                    <p className="text-white/60 text-sm">
                      {isBasketball && !isLandscape ? 'Rotate to landscape to record' : 'Tap to start recording'}
                    </p>
                  </>
                )}

                {recordState === 'recording' && (
                  <>
                    <button
                      onClick={stopRecording}
                      className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                      aria-label="Stop recording"
                    >
                      <span className="w-5 h-5 rounded-sm bg-white" />
                    </button>
                    <p className="text-white/60 text-sm">
                      {isBasketball ? 'Shot counter active — tap to stop' : 'Tap to stop'}
                    </p>
                  </>
                )}

                {(recordState === 'review' || recordState === 'uploading') && (
                  <>
                    {error && <p className="text-sm text-red-400 mb-1">{error}</p>}

                    {isBasketball && (
                      <div className="w-full max-w-xs">
                        <p className="text-white/60 text-xs text-center mb-3">
                          🏀 {reviewAttempts > 0 ? `Detected ${reviewAttempts} shot${reviewAttempts !== 1 ? 's' : ''} — how many went in?` : 'Track your shots'}
                        </p>
                        <div className="flex items-center justify-center gap-6 mb-1">
                          <ShotCounter
                            label="Attempts"
                            value={reviewAttempts}
                            onChange={(v) => {
                              const next = Math.max(0, v)
                              setReviewAttempts(next)
                              if (reviewMakes > next) setReviewMakes(next)
                            }}
                          />
                          <ShotCounter
                            label="Makes"
                            value={reviewMakes}
                            max={reviewAttempts}
                            onChange={(v) => setReviewMakes(Math.max(0, Math.min(v, reviewAttempts)))}
                          />
                          {reviewAttempts > 0 && (
                            <div className="text-center">
                              <div className="text-white text-xl font-bold">
                                {Math.round((reviewMakes / reviewAttempts) * 100)}%
                              </div>
                              <div className="text-white/50 text-xs">made</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 w-full max-w-xs">
                      <button
                        onClick={retake}
                        disabled={recordState === 'uploading'}
                        className="flex-1 py-3 rounded-xl border-2 border-white/30 text-white font-semibold disabled:opacity-40 transition-colors"
                      >
                        Retake
                      </button>
                      <button
                        onClick={save}
                        disabled={recordState === 'uploading'}
                        className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-40 transition-colors"
                      >
                        {recordState === 'uploading' ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
