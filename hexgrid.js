/* Unraid page hex grid (Ember theme).
 * A pointy-top hex grid fixed behind the whole page. Each hex's colour comes from a slow gradient field of black, grey
 * and orange drifting across the screen, mixed with the hex's own fixed tint. Every so often two neighbouring hexes
 * slide past each other and swap places (carrying their tint with them). Hexes near the cursor warm up and glow.
 * Redraws at ~24 fps; requestAnimationFrame pauses it in hidden tabs; prefers-reduced-motion draws one still frame.
 */
(function () {
  'use strict'

  var R = 30 // hex circumradius (px)
  var GAP = 1.6 // dark seam between hexes (px)
  var FRAME_MS = 1000 / 24
  var SWAP_EVERY_MS = 260 // start a new swap this often
  var SWAP_MS = 900 // how long a swap takes
  var MAX_SWAPS = 6
  var HOVER_RADIUS = 160
  var BG = '#050505'
  // gradient stops: black -> grey -> ember -> orange
  var STOPS = [
    [0.0, [10, 10, 10]],
    [0.42, [30, 30, 30]],
    [0.66, [58, 56, 54]],
    [0.84, [128, 62, 18]],
    [1.0, [255, 140, 47]],
  ]

  function gradient(v) {
    v = v < 0 ? 0 : v > 1 ? 1 : v
    for (var i = 1; i < STOPS.length; i++) {
      if (v <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i]
        var t = (v - a[0]) / (b[0] - a[0])
        return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]
      }
    }
    return STOPS[STOPS.length - 1][1]
  }

  function ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  function HexGrid() {
    var self = this
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'starfield-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(this.canvas, document.body.firstChild)
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return
    this.w = this.h = 0
    this.dpr = 1
    this.acc = 0
    this.sinceSwap = 0
    this.swaps = []
    this.mx = this.my = -1e6
    this.hexPath = this.makeHexPath(R - GAP / 2)
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

  HexGrid.prototype.makeHexPath = function (r) {
    var p = new Path2D()
    for (var i = 0; i < 6; i++) {
      var a = (Math.PI / 180) * (60 * i - 30)
      var x = r * Math.cos(a), y = r * Math.sin(a)
      if (i === 0) p.moveTo(x, y)
      else p.lineTo(x, y)
    }
    p.closePath()
    return p
  }

  /** Build the slot grid for the viewport; each slot holds one tile (a tile = a fixed personal tint). */
  HexGrid.prototype.resize = function () {
    var w = Math.max(1, window.innerWidth)
    var h = Math.max(1, window.innerHeight)
    this.w = w
    this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    var hw = Math.sqrt(3) * R // horizontal spacing
    var vh = 1.5 * R // vertical spacing
    this.cols = Math.ceil(w / hw) + 2
    this.rows = Math.ceil(h / vh) + 2
    this.slots = [] // slots[i] = {x, y, col, row, tile}
    this.tiles = [] // tiles[j] = {tint, warm, slot}
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var i = this.slots.length
        this.slots.push({ x: (c - 0.5) * hw + (r & 1 ? hw / 2 : 0), y: (r - 0.5) * vh, col: c, row: r, tile: i })
        // personal tint: mostly dark, a few run hot
        var t = Math.random()
        this.tiles.push({ tint: t < 0.08 ? 0.85 + Math.random() * 0.15 : Math.random() * 0.55, hover: 0, slot: i })
      }
    }
    this.swaps = []
    this.draw(performance.now())
  }

  HexGrid.prototype.slotAt = function (col, row) {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return -1
    return row * this.cols + col
  }

  /** Neighbours of a pointy-top, odd-row-shifted grid. */
  HexGrid.prototype.neighbours = function (s) {
    var c = s.col, r = s.row, odd = r & 1
    var d = odd ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]
    var out = []
    for (var i = 0; i < 6; i++) {
      var n = this.slotAt(c + d[i][0], r + d[i][1])
      if (n >= 0) out.push(n)
    }
    return out
  }

  HexGrid.prototype.startSwap = function () {
    if (this.swaps.length >= MAX_SWAPS) return
    var busy = {}
    this.swaps.forEach(function (sw) { busy[sw.a] = busy[sw.b] = 1 })
    for (var tries = 0; tries < 8; tries++) {
      var a = (Math.random() * this.slots.length) | 0
      if (busy[a]) continue
      var ns = this.neighbours(this.slots[a]).filter(function (n) { return !busy[n] })
      if (!ns.length) continue
      var b = ns[(Math.random() * ns.length) | 0]
      this.swaps.push({ a: a, b: b, t: 0 })
      return
    }
  }

  /** Gradient field: two drifting sine waves, slightly warped, shaped so most of the screen stays dark. */
  HexGrid.prototype.field = function (x, y, t) {
    var s = t / 1000
    var v = 0.5 + 0.28 * Math.sin(x * 0.0042 + s * 0.22 + Math.sin(y * 0.003 + s * 0.09) * 1.6) + 0.22 * Math.sin(y * 0.0058 - s * 0.17 + x * 0.0013)
    return Math.pow(Math.max(0, Math.min(1, v)), 1.5)
  }

  HexGrid.prototype.tick = function (t) {
    var dt = Math.min(100, t - this.last)
    this.last = t
    this.acc += dt
    this.sinceSwap += dt
    if (this.sinceSwap >= SWAP_EVERY_MS) {
      this.sinceSwap = 0
      this.startSwap()
    }
    var cursorIn = this.mx > -1e5
    if (!(cursorIn || this.acc >= FRAME_MS)) return
    var step = this.acc
    this.acc = 0
    // advance swaps; when one completes, the two slots exchange tiles
    for (var i = this.swaps.length - 1; i >= 0; i--) {
      var sw = this.swaps[i]
      sw.t += step / SWAP_MS
      if (sw.t >= 1) {
        var ta = this.slots[sw.a].tile
        this.slots[sw.a].tile = this.slots[sw.b].tile
        this.slots[sw.b].tile = ta
        this.swaps.splice(i, 1)
      }
    }
    this.draw(t)
  }

  HexGrid.prototype.colourFor = function (tile, x, y, t, hover) {
    var v = 0.68 * this.field(x, y, t) + 0.32 * tile.tint + hover * 0.45
    var c = gradient(v)
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
  }

  HexGrid.prototype.draw = function (t) {
    var ctx = this.ctx
    if (!ctx) return
    var dpr = this.dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, this.w, this.h)
    var moving = {}
    this.swaps.forEach(function (sw) { moving[sw.a] = moving[sw.b] = 1 })
    var mx = this.mx, my = this.my, hr2 = HOVER_RADIUS * HOVER_RADIUS
    var smooth = Math.min(1, (FRAME_MS / 1000) * 6)
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i]
      var tile = this.tiles[s.tile]
      var dx = s.x - mx, dy = s.y - my
      var d2 = dx * dx + dy * dy
      var target = d2 < hr2 ? 1 - Math.sqrt(d2) / HOVER_RADIUS : 0
      tile.hover += (target - tile.hover) * smooth
      if (moving[i]) continue
      ctx.setTransform(dpr, 0, 0, dpr, s.x * dpr, s.y * dpr)
      ctx.fillStyle = this.colourFor(tile, s.x, s.y, t, tile.hover)
      ctx.fill(this.hexPath)
    }
    // swapping hexes: slide past each other, shrunk a little
    for (var k = 0; k < this.swaps.length; k++) {
      var sw = this.swaps[k]
      var A = this.slots[sw.a], B = this.slots[sw.b]
      var e = ease(Math.min(1, sw.t))
      var lift = Math.sin(Math.PI * Math.min(1, sw.t)) // 0 -> 1 -> 0
      var scale = 1 - 0.18 * lift
      // empty sockets underneath
      ;[A, B].forEach(function (S) {
        ctx.setTransform(dpr, 0, 0, dpr, S.x * dpr, S.y * dpr)
        ctx.fillStyle = '#0b0b0b'
        ctx.fill(this.hexPath)
      }, this)
      var pairs = [[A, B, this.tiles[A.tile]], [B, A, this.tiles[B.tile]]]
      for (var p = 0; p < 2; p++) {
        var from = pairs[p][0], to = pairs[p][1], tl = pairs[p][2]
        // offset perpendicular so they pass beside each other rather than through
        var px = -(to.y - from.y) * 0.18 * lift * (p ? -1 : 1)
        var py = (to.x - from.x) * 0.18 * lift * (p ? -1 : 1)
        var x = from.x + (to.x - from.x) * e + px
        var y = from.y + (to.y - from.y) * e + py
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, x * dpr, y * dpr)
        ctx.fillStyle = this.colourFor(tl, x, y, t, tl.hover + 0.25 * lift)
        ctx.fill(this.hexPath)
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  function start() {
    if (!document.body || document.querySelector('.starfield-canvas')) return
    new HexGrid()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
