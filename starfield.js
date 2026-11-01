/* Unraid page starfield (Nebula theme).
 * Ported from starfinder_campaign_tracker/src/fx/starfield.ts: three parallax layers drift slowly left (redrawn at
 * ~24 fps), a few stars twinkle, and the cursor pushes nearby stars away (they spring back). Fixed behind the whole
 * page; the Nebula CSS makes surfaces translucent. requestAnimationFrame pauses it in hidden tabs; prefers-reduced-motion draws one still frame.
 */
(function () {
  'use strict'

  var STAR_LAYERS = [
    { perMp: 160, size: 0.55, alpha: 0.55, speed: 4 }, // far: dim, slow
    { perMp: 300, size: 0.8, alpha: 0.8, speed: 8 },
    { perMp: 120, size: 1.15, alpha: 1.0, speed: 14 }, // near: sparse, bright, fastest
  ]
  var DENSITY = 1
  var ACCENT_RGB = '180,140,255' // Nebula violet, used by ~8% of stars
  var FRAME_MS = 1000 / 24
  var LAYER_DEPTH = [0.45, 0.75, 1]
  var PUSH_RADIUS = 170
  var PUSH_MAX = 40
  var SPRING = 0.12
  var DAMPING = 0.78
  var SETTLED = 0.05

  function tint(alpha) {
    var t = Math.random()
    if (t < 0.12) return 'rgba(185,205,255,' + alpha + ')'
    if (t < 0.2) return 'rgba(' + ACCENT_RGB + ',' + alpha + ')'
    return 'rgba(255,255,255,' + alpha + ')'
  }

  function Starfield() {
    var self = this
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'starfield-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(this.canvas, document.body.firstChild)
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return
    this.stars = []
    this.twinkle = []
    this.offsets = [0, 0, 0]
    this.w = this.h = 0
    this.dpr = 1
    this.acc = 0
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

  Starfield.prototype.resize = function () {
    var w = Math.max(1, window.innerWidth)
    var h = Math.max(1, window.innerHeight)
    if (w === this.w && h === this.h && this.stars.length) return
    this.w = w
    this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    var mp = ((w * h) / 1e6) * DENSITY
    var stars = []
    STAR_LAYERS.forEach(function (sp, layer) {
      var n = Math.round(sp.perMp * mp)
      for (var i = 0; i < n; i++)
        stars.push({ x: Math.random() * w, y: Math.random() * h, r: sp.size * (0.7 + Math.random() * 0.6), tint: tint(sp.alpha), layer: layer, ox: 0, oy: 0, vx: 0, vy: 0 })
    })
    this.stars = stars
    this.offsets = STAR_LAYERS.map(function () { return Math.random() * w })
    this.twinkle = []
    for (var j = 0, n2 = Math.max(4, Math.round(14 * mp)); j < n2; j++)
      this.twinkle.push({ x: Math.random() * w, y: Math.random() * h, r: 0.6 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2, speed: 1.2 + Math.random() * 1.6, tint: tint(1) })
    this.draw(performance.now())
  }

  Starfield.prototype.homeX = function (s) {
    return (((s.x - this.offsets[s.layer]) % this.w) + this.w) % this.w
  }

  Starfield.prototype.push = function () {
    var moving = false
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i]
      var dx = this.homeX(s) - this.mx
      var dy = s.y - this.my
      var d = Math.hypot(dx, dy)
      var tx = 0, ty = 0
      if (d < PUSH_RADIUS && d > 0.5) {
        var f = Math.pow(1 - d / PUSH_RADIUS, 2) * PUSH_MAX * LAYER_DEPTH[s.layer]
        tx = (dx / d) * f
        ty = (dy / d) * f
      }
      s.vx = (s.vx + (tx - s.ox) * SPRING) * DAMPING
      s.vy = (s.vy + (ty - s.oy) * SPRING) * DAMPING
      s.ox += s.vx
      s.oy += s.vy
      if (Math.abs(s.vx) > SETTLED || Math.abs(s.vy) > SETTLED || Math.abs(s.ox - tx) > SETTLED || Math.abs(s.oy - ty) > SETTLED) moving = true
    }
    return moving
  }

  Starfield.prototype.tick = function (t) {
    var dt = Math.min(100, t - this.last)
    this.last = t
    this.acc += dt
    var cursorIn = this.mx > -1e5
    var displaced = false
    for (var i = 0; i < this.stars.length && !displaced; i++) displaced = this.stars[i].ox !== 0 || this.stars[i].oy !== 0
    if (!(cursorIn || displaced || this.acc >= FRAME_MS)) return
    var step = this.acc / 1000
    this.acc = 0
    for (var l = 0; l < STAR_LAYERS.length; l++) this.offsets[l] = (this.offsets[l] + STAR_LAYERS[l].speed * step) % this.w
    var moving = this.push()
    if (!moving && !cursorIn) this.stars.forEach(function (s) { s.ox = s.oy = s.vx = s.vy = 0 })
    this.draw(t)
  }

  Starfield.prototype.draw = function (t) {
    var ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i]
      ctx.fillStyle = s.tint
      ctx.beginPath()
      ctx.arc(this.homeX(s) + s.ox, s.y + s.oy, s.r * (1 + Math.min(1, Math.hypot(s.ox, s.oy) / PUSH_MAX) * 0.6), 0, Math.PI * 2)
      ctx.fill()
    }
    for (var j = 0; j < this.twinkle.length; j++) {
      var tw = this.twinkle[j]
      ctx.globalAlpha = this.reducedMotion ? 0.7 : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin((t / 1000) * tw.speed + tw.phase))
      ctx.fillStyle = tw.tint
      ctx.beginPath()
      ctx.arc(tw.x, tw.y, tw.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function start() {
    if (!document.body || document.querySelector('.starfield-canvas')) return
    new Starfield()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
