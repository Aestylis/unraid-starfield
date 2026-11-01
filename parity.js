/* Unraid page background: a live disk array (Array theme).
 * The screen is an array of disks: vertical lanes of blocks, one lane per disk, every few lanes a parity disk.
 * - Writes: blocks heat up red -> orange and cool back down; some writes are sequential runs down a lane, and every
 *   write also touches the parity block on the same stripe (that is how parity works).
 * - Parity check: a red->orange scan band sweeps down the array, reading each stripe as it passes.
 * - Spin-down: idle disks occasionally dim (spun down) and later spin back up.
 * - The cursor warms the blocks under it.
 * Redraws at ~24 fps; requestAnimationFrame pauses it in hidden tabs; prefers-reduced-motion draws one still frame.
 */
(function () {
  'use strict'

  var CELL_W = 34 // block width (px)
  var CELL_H = 12 // block height (px)
  var GAP_X = 14 // gap between disk lanes
  var GAP_Y = 4 // gap between blocks
  var PARITY_EVERY = 7 // every Nth lane is a parity disk
  var FRAME_MS = 1000 / 24
  var COOL_PER_S = 0.55 // heat lost per second
  var WRITES_PER_S = 9 // random single-block writes
  var RUNS_PER_S = 0.7 // sequential write runs
  var SWEEP_S = 38 // seconds for the parity check band to cross the screen
  var HOVER_RADIUS = 130
  var BG = '#0b0b0c'

  // heat 0..1 -> idle charcoal -> brand red -> brand orange -> hot white-orange
  var STOPS = [
    [0.0, [24, 24, 26]],
    [0.35, [120, 22, 22]],
    [0.6, [226, 40, 40]],
    [0.85, [255, 140, 47]],
    [1.0, [255, 205, 150]],
  ]
  function heatColour(v, dim) {
    v = v < 0 ? 0 : v > 1 ? 1 : v
    var c = STOPS[STOPS.length - 1][1]
    for (var i = 1; i < STOPS.length; i++) {
      if (v <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i], t = (v - a[0]) / (b[0] - a[0])
        c = [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]
        break
      }
    }
    return 'rgb(' + ((c[0] * dim) | 0) + ',' + ((c[1] * dim) | 0) + ',' + ((c[2] * dim) | 0) + ')'
  }

  function DiskArray() {
    var self = this
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'starfield-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(this.canvas, document.body.firstChild)
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return
    this.acc = 0
    this.runs = []
    this.sweepY = Math.random()
    this.mx = this.my = -1e6
    this.resize()
    var timer
    window.addEventListener('resize', function () {
      clearTimeout(timer)
      timer = setTimeout(function () { self.resize() }, 150)
    })
    if (this.reducedMotion) return
    window.addEventListener('pointermove', function (e) {
      self.mx = e.clientX
      self.my = e.clientY
    })
    var leave = function () { self.mx = self.my = -1e6 }
    document.addEventListener('mouseleave', leave)
    window.addEventListener('blur', leave)
    window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') leave() })
    this.last = performance.now()
    requestAnimationFrame(function loop(t) { self.tick(t); requestAnimationFrame(loop) })
  }

  DiskArray.prototype.resize = function () {
    var w = Math.max(1, window.innerWidth)
    var h = Math.max(1, window.innerHeight)
    this.w = w
    this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.lanes = Math.max(1, Math.floor((w + GAP_X) / (CELL_W + GAP_X)))
    this.rows = Math.max(1, Math.ceil(h / (CELL_H + GAP_Y)))
    this.x0 = Math.round((w - (this.lanes * (CELL_W + GAP_X) - GAP_X)) / 2)
    this.heat = new Float32Array(this.lanes * this.rows)
    this.hover = new Float32Array(this.lanes * this.rows)
    this.disks = []
    for (var l = 0; l < this.lanes; l++) {
      // seed a little residual heat so the first frame is not blank
      for (var r = 0; r < this.rows; r++) if (Math.random() < 0.05) this.heat[r * this.lanes + l] = Math.random() * 0.5
      this.disks.push({ parity: l % PARITY_EVERY === PARITY_EVERY - 1, spin: 1, target: 1, idle: Math.random() * 20 })
    }
    this.runs = []
    this.draw(performance.now())
  }

  DiskArray.prototype.parityLaneFor = function (lane) {
    var p = lane - (lane % PARITY_EVERY) + PARITY_EVERY - 1
    return p < this.lanes ? p : -1
  }

  DiskArray.prototype.write = function (lane, row, amount) {
    if (lane < 0 || row < 0 || lane >= this.lanes || row >= this.rows) return
    var d = this.disks[lane]
    d.target = 1 // writing spins the disk up
    d.idle = 0
    var i = row * this.lanes + lane
    this.heat[i] = Math.min(1, this.heat[i] + amount)
    if (!d.parity) {
      // the parity block on the same stripe is updated too
      var p = this.parityLaneFor(lane)
      if (p >= 0) {
        var j = row * this.lanes + p
        this.heat[j] = Math.min(1, this.heat[j] + amount * 0.8)
        this.disks[p].target = 1
        this.disks[p].idle = 0
      }
    }
  }

  DiskArray.prototype.randomDataLane = function () {
    for (var k = 0; k < 6; k++) {
      var l = (Math.random() * this.lanes) | 0
      if (!this.disks[l].parity) return l
    }
    return 0
  }

  DiskArray.prototype.tick = function (t) {
    var dt = Math.min(100, t - this.last)
    this.last = t
    this.acc += dt
    var cursorIn = this.mx > -1e5
    if (!(cursorIn || this.acc >= FRAME_MS)) return
    var s = this.acc / 1000
    this.acc = 0
    var n = this.heat.length
    // cool down
    var cool = COOL_PER_S * s
    for (var i = 0; i < n; i++) if (this.heat[i] > 0) this.heat[i] = Math.max(0, this.heat[i] - cool * (0.4 + this.heat[i]))
    // random writes
    var writes = WRITES_PER_S * s
    while (writes > 0) {
      if (Math.random() < writes) this.write(this.randomDataLane(), (Math.random() * this.rows) | 0, 0.55 + Math.random() * 0.45)
      writes -= 1
    }
    // sequential runs down a lane
    if (Math.random() < RUNS_PER_S * s) this.runs.push({ lane: this.randomDataLane(), row: (Math.random() * this.rows * 0.6) | 0, left: 6 + ((Math.random() * 18) | 0), acc: 0 })
    for (var k = this.runs.length - 1; k >= 0; k--) {
      var run = this.runs[k]
      run.acc += s
      while (run.acc > 0.045 && run.left > 0) {
        run.acc -= 0.045
        this.write(run.lane, run.row++, 0.9)
        run.left--
      }
      if (run.left <= 0 || run.row >= this.rows) this.runs.splice(k, 1)
    }
    // parity check sweep: reads (gently warms) every block on the stripes it crosses
    this.sweepY += s / SWEEP_S
    if (this.sweepY > 1.15) this.sweepY = -0.15
    var sweepRow = Math.floor((this.sweepY * this.h) / (CELL_H + GAP_Y))
    if (sweepRow >= 0 && sweepRow < this.rows)
      for (var l = 0; l < this.lanes; l++) {
        var idx = sweepRow * this.lanes + l
        var floor = this.disks[l].parity ? 0.62 : 0.4
        if (this.heat[idx] < floor) this.heat[idx] = floor
        this.disks[l].target = 1
      }
    // spin down idle disks, spin them up on demand
    for (var d = 0; d < this.lanes; d++) {
      var disk = this.disks[d]
      disk.idle += s
      if (disk.idle > 25 && Math.random() < 0.02 * s) disk.target = 0.35
      disk.spin += (disk.target - disk.spin) * Math.min(1, s * 1.5)
    }
    this.draw(t)
  }

  DiskArray.prototype.draw = function (t) {
    var ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, this.w, this.h)
    var mx = this.mx, my = this.my, hr = HOVER_RADIUS
    var smooth = Math.min(1, (FRAME_MS / 1000) * 6)
    for (var l = 0; l < this.lanes; l++) {
      var disk = this.disks[l]
      var x = this.x0 + l * (CELL_W + GAP_X)
      // lane rail: parity disks get a faint red rail
      ctx.fillStyle = disk.parity ? 'rgba(226,40,40,0.10)' : 'rgba(255,255,255,0.025)'
      ctx.fillRect(x - 3, 0, CELL_W + 6, this.h)
      for (var r = 0; r < this.rows; r++) {
        var i = r * this.lanes + l
        var y = r * (CELL_H + GAP_Y)
        var dx = x + CELL_W / 2 - mx, dy = y + CELL_H / 2 - my
        var d = Math.sqrt(dx * dx + dy * dy)
        var target = d < hr ? (1 - d / hr) * 0.55 : 0
        this.hover[i] += (target - this.hover[i]) * smooth
        var v = Math.max(this.heat[i], this.hover[i])
        ctx.fillStyle = heatColour(disk.parity ? v * 0.9 + 0.04 : v, 0.45 + 0.55 * disk.spin)
        ctx.fillRect(x, y, CELL_W, CELL_H)
      }
    }
    // parity check band
    var by = this.sweepY * this.h
    var band = ctx.createLinearGradient(0, by - 60, 0, by + 6)
    band.addColorStop(0, 'rgba(226,40,40,0)')
    band.addColorStop(0.85, 'rgba(226,40,40,0.10)')
    band.addColorStop(1, 'rgba(255,140,47,0.22)')
    ctx.fillStyle = band
    ctx.fillRect(0, by - 60, this.w, 66)
    var line = ctx.createLinearGradient(0, 0, this.w, 0)
    line.addColorStop(0, '#e22828')
    line.addColorStop(1, '#ff8c2f')
    ctx.fillStyle = line
    ctx.globalAlpha = 0.55
    ctx.fillRect(0, by + 5, this.w, 1.5)
    ctx.globalAlpha = 1
  }

  function start() {
    if (!document.body || document.querySelector('.starfield-canvas')) return
    new DiskArray()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
