/**
 * Client-side basketball shot tracker using orange-blob detection + arc analysis.
 * Runs entirely in the browser — no API calls.
 *
 * Canvas coordinate system: y=0 is TOP, y=height is BOTTOM.
 * "Rising" = y decreasing. "Falling" = y increasing.
 */

// Ball detection: tight orange range (basketball)
const BALL_ORANGE = {
  rMin: 165, rMax: 255,
  gMin: 55,  gMax: 150,
  bMin: 0,   bMax: 95,
  rdiffMin: 75,
}

// Rim detection: broader range — rim paint can be more red-orange, and appears
// darker/desaturated at distance compared to a close-up basketball
const RIM_ORANGE = {
  rMin: 140, rMax: 255,
  gMin: 35,  gMax: 160,
  bMin: 0,   bMax: 110,
  rdiffMin: 55,
}

const SAMPLE_STRIDE = 3       // ball pixel scan stride
const MIN_PIXELS = 30
const MAX_PIXELS = 2000
const MIN_ARC_PX = 30
const RISING_VEL = -1.5
const FALLING_VEL = 1.5
const HISTORY_LEN = 60
const DISAPPEARED_FRAMES = 6
const FPS_TARGET = 15

// Hoop stability grid — smaller cells (24×18) for better resolution on thin rim
const GRID_W = 24
const GRID_H = 18
const HOOP_ACCUM_MAX = 20
const HOOP_THRESHOLD = 10  // lower = detects faster but more false positives

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

  const hoopGrid = new Uint8Array(GRID_W * GRID_H)

  // Reusable offscreen canvas
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

  function isBallOrange(r: number, g: number, b: number): boolean {
    return r >= BALL_ORANGE.rMin && r <= BALL_ORANGE.rMax
      && g >= BALL_ORANGE.gMin && g <= BALL_ORANGE.gMax
      && b >= BALL_ORANGE.bMin && b <= BALL_ORANGE.bMax
      && r - b >= BALL_ORANGE.rdiffMin
  }

  function isRimOrange(r: number, g: number, b: number): boolean {
    return r >= RIM_ORANGE.rMin && r <= RIM_ORANGE.rMax
      && g >= RIM_ORANGE.gMin && g <= RIM_ORANGE.gMax
      && b >= RIM_ORANGE.bMin && b <= RIM_ORANGE.bMax
      && r - b >= RIM_ORANGE.rdiffMin
  }

  // Net is white/off-white nylon; against glass it stands out
  function isNetWhite(r: number, g: number, b: number): boolean {
    const min = Math.min(r, g, b)
    const max = Math.max(r, g, b)
    return max > 175 && min > 120 && max - min < 65
  }

  function detectBall(data: Uint8ClampedArray, w: number, h: number): { pos: Pos; box: Box } | null {
    let sumX = 0, sumY = 0, count = 0
    let minX = w, maxX = 0, minY = h, maxY = 0

    for (let y = 0; y < h; y += SAMPLE_STRIDE) {
      for (let x = 0; x < w; x += SAMPLE_STRIDE) {
        const i = (y * w + x) * 4
        if (isBallOrange(data[i], data[i + 1], data[i + 2])) {
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
      box: { x: minX, y: minY, w: maxX - minX + SAMPLE_STRIDE, h: maxY - minY + SAMPLE_STRIDE },
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

        // Stride 1 inside cells — rim is a thin ring, can't afford to skip pixels
        let rimCount = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4
            if (isRimOrange(data[i], data[i + 1], data[i + 2])) rimCount++
          }
        }

        const idx = gy * GRID_W + gx
        // 1 rim pixel per cell is enough — rim appears as a narrow arc
        if (rimCount >= 1) {
          hoopGrid[idx] = Math.min(hoopGrid[idx] + 1, HOOP_ACCUM_MAX) as 0
        } else {
          hoopGrid[idx] = Math.max(hoopGrid[idx] - 1, 0) as 0
        }
      }
    }
  }

  function computeHoopBox(data: Uint8ClampedArray, w: number, h: number): Box | null {
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
    if (maxGX - minGX < 1 && maxGY - minGY < 1) return null  // too small

    const rimBox: Box = {
      x: minGX * cellW,
      y: minGY * cellH,
      w: (maxGX - minGX + 1) * cellW,
      h: (maxGY - minGY + 1) * cellH,
    }

    // Extend box downward to include the net (white pixels below the rim)
    const netSearchY0 = Math.round(rimBox.y + rimBox.h)
    const netSearchY1 = Math.min(h, Math.round(rimBox.y + rimBox.h + rimBox.h * 4))
    const netSearchX0 = Math.round(rimBox.x)
    const netSearchX1 = Math.min(w, Math.round(rimBox.x + rimBox.w))

    let lowestNetY = netSearchY0
    for (let y = netSearchY0; y < netSearchY1; y += 2) {
      let rowWhite = 0
      for (let x = netSearchX0; x < netSearchX1; x += 2) {
        const i = (y * w + x) * 4
        if (isNetWhite(data[i], data[i + 1], data[i + 2])) rowWhite++
      }
      // Row has enough white pixels to be part of the net
      if (rowWhite >= 3) lowestNetY = y
    }

    if (lowestNetY > netSearchY0) {
      // Expand hoop box to include the net
      return {
        x: rimBox.x,
        y: rimBox.y,
        w: rimBox.w,
        h: lowestNetY - rimBox.y + 4,
      }
    }

    return rimBox
  }

  function avgYVelocity(n = 4): number {
    const recent = history.filter(f => f.ball !== null).slice(-n) as { ball: Pos }[]
    if (recent.length < 2) return 0
    return (recent[recent.length - 1].ball.y - recent[0].ball.y) / (recent.length - 1)
  }

  function recordAttempt() {
    if (arcStartY - arcPeakY >= MIN_ARC_PX) attempts++
  }

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
    const hoopBox = computeHoopBox(data, w, h)

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
        if (vel < RISING_VEL) { phase = 'rising'; arcStartY = ball.y; arcPeakY = ball.y }
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
