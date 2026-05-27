/**
 * Client-side basketball shot tracker using orange-blob detection + arc analysis.
 * Runs entirely in the browser — no API calls.
 *
 * Canvas coordinate system: y=0 is TOP, y=height is BOTTOM.
 * "Rising" = y decreasing. "Falling" = y increasing.
 */

const ORANGE = {
  rMin: 165, rMax: 255,
  gMin: 55,  gMax: 150,
  bMin: 0,   bMax: 95,
  rdiffMin: 75, // r - b must exceed this
}

const SAMPLE_STRIDE = 3      // sample every Nth pixel for performance
const MIN_PIXELS = 30        // min orange pixels (after sampling) to detect a ball
const MAX_PIXELS = 2000      // max (filters large orange objects — jerseys, signage)
const MIN_ARC_PX = 30        // min pixel rise to count as a shot (not a dribble)
const RISING_VEL = -1.5      // px/frame threshold for "rising"
const FALLING_VEL = 1.5      // px/frame threshold for "falling"
const HISTORY_LEN = 60
const DISAPPEARED_FRAMES = 6 // frames with no ball after falling arc = probable make
const FPS_TARGET = 15

// Hoop stability detection: grid cells that are consistently orange = hoop
const GRID_W = 20
const GRID_H = 15
const HOOP_ACCUM_MAX = 25  // max accumulation per cell
const HOOP_THRESHOLD = 15  // cells at/above this = part of hoop region

type Pos = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
type FrameEntry = { ball: Pos | null }

export type ShotCounts = {
  attempts: number
  ballDetected: boolean
  ballBox: Box | null
  hoopBox: Box | null
}

export function createShotTracker() {
  const history: FrameEntry[] = []
  let phase: 'idle' | 'rising' | 'falling' = 'idle'
  let arcStartY = 0
  let arcPeakY = 0
  let disappearedFrames = 0
  let attempts = 0
  let lastProcessTime = 0
  let lastBallBox: Box | null = null
  let lastHoopBox: Box | null = null
  let ballLastSeen = false

  // Hoop grid: accumulates orange presence across frames (static regions = hoop)
  const hoopGrid = new Uint8Array(GRID_W * GRID_H)

  // Reusable offscreen canvas to avoid GC churn at 15fps
  let offscreen: HTMLCanvasElement | null = null
  let offCtx: CanvasRenderingContext2D | null = null

  function getCtx(w: number, h: number): CanvasRenderingContext2D | null {
    if (!offscreen) offscreen = document.createElement('canvas')
    if (offscreen.width !== w || offscreen.height !== h) {
      offscreen.width = w
      offscreen.height = h
      offCtx = offscreen.getContext('2d', { willReadFrequently: true })
    }
    return offCtx
  }

  function isOrange(r: number, g: number, b: number): boolean {
    return r >= ORANGE.rMin && r <= ORANGE.rMax
      && g >= ORANGE.gMin && g <= ORANGE.gMax
      && b >= ORANGE.bMin && b <= ORANGE.bMax
      && r - b >= ORANGE.rdiffMin
  }

  function detectBall(data: Uint8ClampedArray, w: number, h: number): { pos: Pos; box: Box } | null {
    let sumX = 0, sumY = 0, count = 0
    let minX = w, maxX = 0, minY = h, maxY = 0

    for (let y = 0; y < h; y += SAMPLE_STRIDE) {
      for (let x = 0; x < w; x += SAMPLE_STRIDE) {
        const i = (y * w + x) * 4
        if (isOrange(data[i], data[i + 1], data[i + 2])) {
          sumX += x; sumY += y; count++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    if (count < MIN_PIXELS || count > MAX_PIXELS) return null
    return {
      pos: { x: sumX / count, y: sumY / count },
      box: {
        x: minX,
        y: minY,
        w: maxX - minX + SAMPLE_STRIDE,
        h: maxY - minY + SAMPLE_STRIDE,
      },
    }
  }

  function updateHoopGrid(data: Uint8ClampedArray, w: number, h: number, ballBox: Box | null) {
    const cellW = w / GRID_W
    const cellH = h / GRID_H

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const x0 = Math.floor(gx * cellW)
        const x1 = Math.floor((gx + 1) * cellW)
        const y0 = Math.floor(gy * cellH)
        const y1 = Math.floor((gy + 1) * cellH)

        // Skip cells overlapping the current ball (don't count ball as hoop)
        if (ballBox
          && x1 > ballBox.x && x0 < ballBox.x + ballBox.w
          && y1 > ballBox.y && y0 < ballBox.y + ballBox.h) {
          continue
        }

        let orangeCount = 0
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * w + x) * 4
            if (isOrange(data[i], data[i + 1], data[i + 2])) orangeCount++
          }
        }

        const idx = gy * GRID_W + gx
        if (orangeCount >= 2) {
          hoopGrid[idx] = Math.min(hoopGrid[idx] + 1, HOOP_ACCUM_MAX) as 0
        } else {
          hoopGrid[idx] = Math.max(hoopGrid[idx] - 1, 0) as 0
        }
      }
    }
  }

  function computeHoopBox(w: number, h: number): Box | null {
    const cellW = w / GRID_W
    const cellH = h / GRID_H
    let minGX = GRID_W, maxGX = -1, minGY = GRID_H, maxGY = -1

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (hoopGrid[gy * GRID_W + gx] >= HOOP_THRESHOLD) {
          if (gx < minGX) minGX = gx
          if (gx > maxGX) maxGX = gx
          if (gy < minGY) minGY = gy
          if (gy > maxGY) maxGY = gy
        }
      }
    }

    if (maxGX === -1) return null

    // Require at least 2 grid cells wide or tall (filter noise)
    if (maxGX - minGX < 1 && maxGY - minGY < 1) return null

    return {
      x: minGX * cellW,
      y: minGY * cellH,
      w: (maxGX - minGX + 1) * cellW,
      h: (maxGY - minGY + 1) * cellH,
    }
  }

  function avgYVelocity(n = 4): number {
    const recent = history.filter(f => f.ball !== null).slice(-n) as { ball: Pos }[]
    if (recent.length < 2) return 0
    return (recent[recent.length - 1].ball.y - recent[0].ball.y) / (recent.length - 1)
  }

  function recordAttempt() {
    if (arcStartY - arcPeakY >= MIN_ARC_PX) attempts++
  }

  /** Call every animation frame with the live <video> element. */
  function processFrame(video: HTMLVideoElement): ShotCounts {
    const now = performance.now()
    if (now - lastProcessTime < 1000 / FPS_TARGET) {
      return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox }
    }
    lastProcessTime = now

    const scale = Math.min(1, 320 / (video.videoWidth || 320))
    const w = Math.round((video.videoWidth || 320) * scale)
    const h = Math.round((video.videoHeight || 240) * scale)

    const ctx = getCtx(w, h)
    if (!ctx) return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox }

    try { ctx.drawImage(video, 0, 0, w, h) } catch {
      return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox }
    }

    const { data } = ctx.getImageData(0, 0, w, h)
    const ballResult = detectBall(data, w, h)
    const ballBox = ballResult?.box ?? null

    updateHoopGrid(data, w, h, ballBox)
    const hoopBox = computeHoopBox(w, h)

    lastBallBox = ballBox
    lastHoopBox = hoopBox
    ballLastSeen = ballBox !== null

    const ball = ballResult?.pos ?? null
    history.push({ ball })
    if (history.length > HISTORY_LEN) history.shift()

    if (!ball) {
      disappearedFrames++
      if (phase === 'falling' && disappearedFrames === DISAPPEARED_FRAMES) {
        recordAttempt()
        phase = 'idle'
      } else if (disappearedFrames > 20) {
        phase = 'idle'
      }
      return { attempts, ballDetected: false, ballBox: null, hoopBox }
    }

    disappearedFrames = 0
    const vel = avgYVelocity()

    switch (phase) {
      case 'idle':
        if (vel < RISING_VEL) {
          phase = 'rising'; arcStartY = ball.y; arcPeakY = ball.y
        }
        break
      case 'rising':
        if (ball.y < arcPeakY) arcPeakY = ball.y
        if (vel > FALLING_VEL) {
          phase = 'falling'
        } else if (vel > -0.5 && arcStartY - arcPeakY < MIN_ARC_PX * 0.4) {
          phase = 'idle'
        }
        break
      case 'falling':
        if (vel < RISING_VEL) {
          recordAttempt()
          phase = 'rising'; arcStartY = ball.y; arcPeakY = ball.y
        }
        break
    }

    return { attempts, ballDetected: true, ballBox, hoopBox }
  }

  function getCounts(): ShotCounts {
    return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox }
  }

  function reset() {
    history.length = 0
    phase = 'idle'
    arcStartY = arcPeakY = disappearedFrames = attempts = lastProcessTime = 0
    lastBallBox = lastHoopBox = null
    ballLastSeen = false
    hoopGrid.fill(0)
  }

  return { processFrame, getCounts, reset }
}
