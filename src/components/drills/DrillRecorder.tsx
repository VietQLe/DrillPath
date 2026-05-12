'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DrillRecording } from '@/types'

type RecordState = 'idle' | 'setup' | 'recording' | 'review' | 'uploading'

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export default function DrillRecorder({
  drillId,
  planId,
  kidId,
  initialRecordings,
}: {
  drillId: string
  planId: string | null
  kidId: string | null
  initialRecordings: DrillRecording[]
}) {
  const [recordings, setRecordings] = useState(initialRecordings)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const reviewVideoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Generate signed URLs for existing recordings
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
      for (const r of results) {
        if (r) urls[r[0]] = r[1]
      }
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
      const mimeBase = mimeType.split(';')[0]
      const blob = new Blob(chunksRef.current, { type: mimeBase })
      blobRef.current = blob
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url
      stopStream()
      setRecordState('review')
      // set src after state update so the element is visible
      requestAnimationFrame(() => {
        if (reviewVideoRef.current) reviewVideoRef.current.src = url
      })
    }
    recorder.start(100)
    recorderRef.current = recorder
    setElapsed(0)
    setRecordState('recording')
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
  }

  function retake() {
    blobRef.current = null
    revokeBlobUrl()
    openCamera()
  }

  function close() {
    if (timerRef.current) clearInterval(timerRef.current)
    stopStream()
    revokeBlobUrl()
    blobRef.current = null
    setRecordState('idle')
    setElapsed(0)
    setError(null)
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

  const inModal = recordState !== 'idle'

  return (
    <>
      {/* Existing recordings */}
      {recordings.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-3">
            Your recordings{recordings.length > 1 ? ` (${recordings.length})` : ''}
          </h2>
          <div className="space-y-3">
            {recordings.map((rec) => (
              <div key={rec.id} className="rounded-xl overflow-hidden bg-slate-100 aspect-video relative">
                {signedUrls[rec.id] ? (
                  <video
                    src={signedUrls[rec.id]}
                    controls
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                    Loading…
                  </div>
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
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => deleteRecording(rec.id, rec.video_url)}
                        className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record button (idle state, only in workout context) */}
      {!inModal && planId && kidId && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-1">Record yourself</h2>
          <p className="text-sm text-slate-500 mb-4">
            Capture a clip of your performance to review and track progress over time.
          </p>
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
          <button
            onClick={() => openCamera()}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <span>●</span> Start recording
          </button>
        </div>
      )}

      {/* Full-screen camera modal */}
      {inModal && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Video area */}
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
                className="absolute top-safe-or-4 top-4 right-4 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            )}

            {/* Recording timer badge */}
            {recordState === 'recording' && (
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-sm font-mono">{formatTime(elapsed)}</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="p-6 pb-10 flex flex-col items-center gap-3">
            {/* Setup: flip + record */}
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
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                    aria-label="Start recording"
                  >
                    <span className="w-6 h-6 rounded-full bg-white" />
                  </button>
                  <div className="w-11 h-11" />
                </div>
                <p className="text-white/60 text-sm">Tap to start recording</p>
              </>
            )}

            {/* Recording: tap to stop */}
            {recordState === 'recording' && (
              <>
                <button
                  onClick={stopRecording}
                  className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
                  aria-label="Stop recording"
                >
                  <span className="w-5 h-5 rounded-sm bg-white" />
                </button>
                <p className="text-white/60 text-sm">Tap to stop</p>
              </>
            )}

            {/* Review: save or retake */}
            {(recordState === 'review' || recordState === 'uploading') && (
              <>
                {error && <p className="text-sm text-red-400 mb-1">{error}</p>}
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
        </div>
      )}
    </>
  )
}
