/**
 * Client-side basketball shot tracker using orange-blob detection + arc analysis.
 * Counts shot ATTEMPTS by detecting the ball's rise-then-fall trajectory.
 * No API calls — runs entirely in the browser via canvas pixel analysis.
 *
 * Canvas coordinate system: y=0 is TOP, y=height is BOTTOM.
 * "Rising" = y decreasing. "Falling" = y increasing.
 */

// Orange basketball pixel ranges (RGB)
const ORANGE = {
  rMin: 165, rMax: 255,
  gMin: 55, gMax: 150,
  bMin: 0, bMax: 95,
  rdiffMin: 75, // r - b must exceed this
}

// Tuning constants
const SAMPLE_STRIDE = 3       // sample every Nth pixel for performance
const MIN_PIXELS = 30         // min orange pixels (after sampling) to consider a ball
const MAX_PIXELS = 2000       // max (filter large orange objects like jerseys/walls)
const MIN_ARC_PX = 30         // minimum pixel rise needed to count as a shot (not a dribble)
const RISING_VEL = -1.5       // px/frame threshold for "rising"
const FALLING_VEL = 1.5       // px/frame threshold for "falling"
const HISTORY_LEN = 60        // frames of ball position history
const DISAPPEARED_FRAMES = 6  // frames with no ball after falling = shot completed (went in)
const FPS_TARGET = 12         // process at most this many frames per second

type Pos = { x: number; y: number }
type Frame = { ball: Pos | null }

export type ShotCounts = { attempts: number; ballDetected: boolean }

export function createShotTracker() {
  const history: Frame[] = []
  let phase: 'idle' | 'rising' | 'falling' = 'idle'
  let arcStartY = 0
  let arcPeakY = 0
  let disappearedFrames = 0
  let attempts = 0
  let lastProcessTime = 0
  let ballLastSeen = false

  function isOrange(r: number, g: number, b: number): boolean {
    return r >= ORANGE.rMin && r <= ORANGE.rMax
      && g >= ORANGE.gMin && g <= ORANGE.gMax
      && b >= ORANGE.bMin && b <= ORANGE.bMax
      && r - b >= ORANGE.rdiffMin
  }

  function detectBall(ctx: CanvasRenderingContext2D, w: number, h: number): Pos | null {
    const data = ctx.getImageData(0, 0, w, h).data
    let sumX = 0, sumY = 0, count = 0

    for (let y = 0; y < h; y += SAMPLE_STRIDE) {
      for (let x = 0; x < w; x += SAMPLE_STRIDE) {
        const i = (y * w + x) * 4
        if (isOrange(data[i], data[i + 1], data[i + 2])) {
          sumX += x
          sumY += y
          count++
        }
      }
    }

    if (count < MIN_PIXELS || count > MAX_PIXELS) return null
    return { x: sumX / count, y: sumY / count }
  }

  function avgYVelocity(n = 4): number {
    const recent = history.filter(f => f.ball !== null).slice(-n) as { ball: Pos }[]
    if (recent.length < 2) return 0
    const dy = recent[recent.length - 1].ball.y - recent[0].ball.y
    return dy / (recent.length - 1)
  }

  function recordAttempt() {
    // Only count if arc had meaningful height (filters out dribbles and noise)
    if (arcStartY - arcPeakY >= MIN_ARC_PX) {
      attempts++
    }
  }

  /**
   * Call this every animation frame with the live <video> element.
   * Returns current shot counts and whether the ball is visible.
   */
  function processFrame(video: HTMLVideoElement): ShotCounts {
    const now = performance.now()
    if (now - lastProcessTime < 1000 / FPS_TARGET) {
      return { attempts, ballDetected: ballLastSeen }
    }
    lastProcessTime = now

    // Downscale to 320px wide for performance
    const scale = Math.min(1, 320 / (video.videoWidth || 320))
    const w = Math.round((video.videoWidth || 320) * scale)
    const h = Math.round((video.videoHeight || 240) * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { attempts, ballDetected: ballLastSeen }

    try {
      ctx.drawImage(video, 0, 0, w, h)
    } catch {
      return { attempts, ballDetected: ballLastSeen }
    }

    const ball = detectBall(ctx, w, h)
    ballLastSeen = ball !== null

    history.push({ ball })
    if (history.length > HISTORY_LEN) history.shift()

    if (!ball) {
      disappearedFrames++

      // Ball vanished mid-falling arc → likely went through the hoop
      if (phase === 'falling' && disappearedFrames === DISAPPEARED_FRAMES) {
        recordAttempt()
        phase = 'idle'
      } else if (disappearedFrames > 20) {
        phase = 'idle'
      }

      return { attempts, ballDetected: false }
    }

    disappearedFrames = 0
    const vel = avgYVelocity()

    switch (phase) {
      case 'idle':
        if (vel < RISING_VEL) {
          phase = 'rising'
          arcStartY = ball.y
          arcPeakY = ball.y
        }
        break

      case 'rising':
        if (ball.y < arcPeakY) arcPeakY = ball.y

        if (vel > FALLING_VEL) {
          // Peaked and now falling — shot is in the air
          phase = 'falling'
        } else if (vel > -0.5) {
          // Barely moving up — probably just noise, reset if arc too small
          if (arcStartY - arcPeakY < MIN_ARC_PX * 0.4) {
            phase = 'idle'
          }
        }
        break

      case 'falling':
        if (vel < RISING_VEL) {
          // Ball reversed direction (bounced off rim, floor, or backboard)
          recordAttempt()
          phase = 'rising'
          arcStartY = ball.y
          arcPeakY = ball.y
        }
        break
    }

    return { attempts, ballDetected: true }
  }

  function reset() {
    history.length = 0
    phase = 'idle'
    arcStartY = 0
    arcPeakY = 0
    disappearedFrames = 0
    attempts = 0
    lastProcessTime = 0
    ballLastSeen = false
  }

  function getCounts(): ShotCounts {
    return { attempts, ballDetected: ballLastSeen }
  }

  return { processFrame, getCounts, reset }
}
