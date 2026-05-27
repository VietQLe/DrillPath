/**
 * Client-side basketball shot tracker using orange-blob detection + arc analysis.
 * Runs entirely in the browser — no API calls.
 *
 * Canvas coordinate system: y=0 is TOP, y=height is BOTTOM.
 * "Rising" = y decreasing. "Falling" = y increasing.
 */

// No fixed color struct for ball — we use ratio-based detection instead (see isBallOrange)

// Rim: tight to basketball-rim orange — foliage is more yellow-green (G > 115)
// and dead leaves are more brown; true rim metal is pure orange with low G
const RIM_ORANGE = {
  rMin: 155, rMax: 255,
  gMin: 45,  gMax: 115,
  bMin: 0,   bMax: 80,
  rdiffMin: 80,
}

const SAMPLE_STRIDE = 3
const MIN_BALL_PX = 12
const MAX_BALL_PX = 500
const MIN_ARC_PX = 30
const RISING_VEL = -1.5
const FALLING_VEL = 1.5
const HISTORY_LEN = 60
const DISAPPEARED_FRAMES = 6
const FPS_TARGET = 15

// Hoop grid — 24×18 cells, ~13px per cell at 320px wide
const GRID_W = 24
const GRID_H = 18
const HOOP_ACCUM_MAX = 20
const HOOP_THRESHOLD = 12

// Minimum horizontal run of stable cells to be considered a rim (≥3 cells ≈ 40px)
const MIN_RIM_RUN = 3
// Rim must be in top 50% of frame — foliage and ground objects are typically lower
const MAX_RIM_GY_FRAC = 0.50

export type Pos = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
type FrameEntry = { ball: Pos | null }

export type ShotCounts = {
  attempts: number
  ballDetected: boolean
  ballBox: Box | null
  hoopBox: Box | null
  ballTrail: Pos[]      // recent ball positions for live trail
  shotArc: Pos[] | null // positions of the arc that just completed (one frame only)
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
  let lastBallTrail: Pos[] = []
  let currentArcPts: Pos[] = []
  let pendingArc: Pos[] | null = null

  const hoopGrid = new Uint8Array(GRID_W * GRID_H)

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

  // Ratio-based orange detection handles bright new balls AND dull/worn/shadowed ones.
  //
  // Rules (in order):
  //   1. R is the dominant channel (orange is red-led, not yellow or blue)
  //   2. G < 78% of R — filters skin tones and yellow where G ≈ R
  //   3. B < G — not pink or purple
  //   4. R - B ≥ 45 — must have warm red-orange quality (not grey)
  //   5. R ≥ 110 — not too dark to be a visible ball
  //   6. G ≥ 30 — not pure red (ball always has some green in its orange)
  //
  // Passes: bright new ball (255,100,20), dull worn (160,95,70), dark in shadow (120,75,55)
  // Fails:  skin tones (G too close to R), grass/sky (B ≥ G or R not dominant)
  function isBallOrange(r: number, g: number, b: number): boolean {
    return r > g && r > b           // R dominant
      && g < r * 0.78               // not yellow / skin tone
      && b < g                      // not pink / purple
      && r - b >= 48                // warm orange (looser than rim — ball can be worn/dull)
      && r >= 100                   // not too dark (dull worn balls can be darker)
      && g >= 28                    // not pure red
  }

  function isRimOrange(r: number, g: number, b: number): boolean {
    return r >= RIM_ORANGE.rMin && r <= RIM_ORANGE.rMax
      && g >= RIM_ORANGE.gMin && g <= RIM_ORANGE.gMax
      && b >= RIM_ORANGE.bMin && b <= RIM_ORANGE.bMax
      && r - b >= RIM_ORANGE.rdiffMin
  }

  // Net: bright white/off-white nylon — tight range to avoid matching sky or foliage
  function isNetWhite(r: number, g: number, b: number): boolean {
    const min = Math.min(r, g, b)
    const max = Math.max(r, g, b)
    return max > 210 && min > 165 && max - min < 40
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

    if (count < MIN_BALL_PX || count > MAX_BALL_PX) return null

    const bw = maxX - minX + SAMPLE_STRIDE
    const bh = maxY - minY + SAMPLE_STRIDE

    // Reject blobs that are too large — ball can't span >22% of frame in either dimension
    if (bw > w * 0.22 || bh > h * 0.22) return null

    // Reject flat shapes — ball is roughly circular (rim is very wide and flat)
    const aspect = bw / bh
    if (aspect < 0.35 || aspect > 2.5) return null

    // Reject sparse blobs — a real ball is a compact solid mass, not scattered pixels
    const density = (count * SAMPLE_STRIDE * SAMPLE_STRIDE) / (bw * bh)
    if (density < 0.28) return null

    return {
      pos: { x: sumX / count, y: sumY / count },
      box: { x: minX, y: minY, w: bw, h: bh },
    }
  }

  function updateHoopGrid(data: Uint8ClampedArray, w: number, h: number, ballBox: Box | null) {
    const cellW = w / GRID_W
    const cellH = h / GRID_H
    const maxGY = Math.floor(GRID_H * MAX_RIM_GY_FRAC)

    for (let gy = 0; gy < maxGY; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const x0 = Math.floor(gx * cellW)
        const x1 = Math.floor((gx + 1) * cellW)
        const y0 = Math.floor(gy * cellH)
        const y1 = Math.floor((gy + 1) * cellH)

        // Don't count the moving ball as the hoop
        if (ballBox
          && x1 > ballBox.x && x0 < ballBox.x + ballBox.w
          && y1 > ballBox.y && y0 < ballBox.y + ballBox.h) {
          continue
        }

        // Stride 1 — rim is only a few pixels wide, can't skip
        let rimCount = 0
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4
            if (isRimOrange(data[i], data[i + 1], data[i + 2])) rimCount++
          }
        }

        const idx = gy * GRID_W + gx
        if (rimCount >= 2) {
          // Require ≥2 rim pixels per cell to avoid single-pixel noise from foliage
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
    const maxGY = Math.floor(GRID_H * MAX_RIM_GY_FRAC)

    // Find the longest HORIZONTAL run of triggered cells in the upper frame.
    // The rim is a horizontal arc — scattered individual cells are noise/foliage.
    let bestRun = { gx0: 0, gx1: 0, gy: 0, len: 0 }

    for (let gy = 0; gy < maxGY; gy++) {
      let runStart = -1
      let runLen = 0
      for (let gx = 0; gx <= GRID_W; gx++) {
        const triggered = gx < GRID_W && hoopGrid[gy * GRID_W + gx] >= HOOP_THRESHOLD
        if (triggered) {
          if (runStart === -1) runStart = gx
          runLen++
        } else {
          if (runLen > bestRun.len) {
            bestRun = { gx0: runStart, gx1: gx - 1, gy, len: runLen }
          }
          runStart = -1
          runLen = 0
        }
      }
    }

    if (bestRun.len < MIN_RIM_RUN) return null

    const rimBox: Box = {
      x: bestRun.gx0 * cellW,
      y: bestRun.gy * cellH,
      w: (bestRun.gx1 - bestRun.gx0 + 1) * cellW,
      h: cellH * 1.5,
    }

    // Width sanity: rim should be 5–40% of frame width (not a wall or a tiny speck)
    const rimWidthFrac = rimBox.w / w
    if (rimWidthFrac < 0.05 || rimWidthFrac > 0.40) return null

    // Aspect: rim must be wider than tall (at least 1.5:1)
    if (rimBox.w < rimBox.h * 1.5) return null

    // Extend down to include net (white nylon below the rim).
    // Cap search to max 25px below rim — net doesn't hang far at this scale.
    const netY0 = Math.round(rimBox.y + rimBox.h)
    const netY1 = Math.min(h, netY0 + 25)
    const netX0 = Math.round(rimBox.x)
    const netX1 = Math.min(w, Math.round(rimBox.x + rimBox.w))

    let lowestNetY = netY0
    for (let y = netY0; y < netY1; y += 2) {
      let rowWhite = 0
      for (let x = netX0; x < netX1; x += 2) {
        const i = (y * w + x) * 4
        if (isNetWhite(data[i], data[i + 1], data[i + 2])) rowWhite++
      }
      if (rowWhite >= 4) lowestNetY = y
    }

    if (lowestNetY > netY0) {
      return { x: rimBox.x, y: rimBox.y, w: rimBox.w, h: lowestNetY - rimBox.y + 4 }
    }

    return rimBox
  }

  function avgYVelocity(n = 4): number {
    const recent = history.filter(f => f.ball !== null).slice(-n) as { ball: Pos }[]
    if (recent.length < 2) return 0
    return (recent[recent.length - 1].ball.y - recent[0].ball.y) / (recent.length - 1)
  }

  function recordAttempt() {
    if (arcStartY - arcPeakY >= MIN_ARC_PX) {
      attempts++
      if (currentArcPts.length >= 3) pendingArc = [...currentArcPts]
    }
    currentArcPts = []
  }

  function processFrame(video: HTMLVideoElement): ShotCounts {
    const now = performance.now()
    if (now - lastProcessTime < 1000 / FPS_TARGET) {
      return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox, ballTrail: lastBallTrail, shotArc: null }
    }
    lastProcessTime = now

    const scale = Math.min(1, 320 / (video.videoWidth || 320))
    const w = Math.round((video.videoWidth || 320) * scale)
    const h = Math.round((video.videoHeight || 240) * scale)

    const ctx = getCtx(w, h)
    if (!ctx) return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox, ballTrail: lastBallTrail, shotArc: null }

    try { ctx.drawImage(video, 0, 0, w, h) } catch {
      return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox, ballTrail: lastBallTrail, shotArc: null }
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

    lastBallTrail = history.filter(f => f.ball !== null).slice(-20).map(f => f.ball as Pos)

    if (!ball) {
      disappearedFrames++
      if (phase === 'falling' && disappearedFrames === DISAPPEARED_FRAMES) {
        recordAttempt()
        phase = 'idle'
      } else if (disappearedFrames > 20) {
        phase = 'idle'
        currentArcPts = []
      }
      const shotArc = pendingArc; pendingArc = null
      return { attempts, ballDetected: false, ballBox: null, hoopBox, ballTrail: lastBallTrail, shotArc }
    }

    disappearedFrames = 0
    const vel = avgYVelocity()

    switch (phase) {
      case 'idle':
        if (vel < RISING_VEL) {
          phase = 'rising'; arcStartY = ball.y; arcPeakY = ball.y
          currentArcPts = [ball]
        }
        break
      case 'rising':
        currentArcPts.push(ball)
        if (ball.y < arcPeakY) arcPeakY = ball.y
        if (vel > FALLING_VEL) {
          phase = 'falling'
        } else if (vel > -0.5 && arcStartY - arcPeakY < MIN_ARC_PX * 0.4) {
          phase = 'idle'
          currentArcPts = []
        }
        break
      case 'falling':
        currentArcPts.push(ball)
        if (vel < RISING_VEL) {
          recordAttempt()
          phase = 'rising'; arcStartY = ball.y; arcPeakY = ball.y
          currentArcPts = [ball]
        }
        break
    }

    const shotArc = pendingArc; pendingArc = null
    return { attempts, ballDetected: true, ballBox, hoopBox, ballTrail: lastBallTrail, shotArc }
  }

  function getCounts(): ShotCounts {
    return { attempts, ballDetected: ballLastSeen, ballBox: lastBallBox, hoopBox: lastHoopBox, ballTrail: lastBallTrail, shotArc: null }
  }

  function reset() {
    history.length = 0
    phase = 'idle'
    arcStartY = arcPeakY = disappearedFrames = attempts = lastProcessTime = 0
    lastBallBox = lastHoopBox = null
    ballLastSeen = false
    hoopGrid.fill(0)
    lastBallTrail = []
    currentArcPts = []
    pendingArc = null
  }

  return { processFrame, getCounts, reset }
}
