/* Unraid page background: live share streams (Array theme).
 * Driven by the server's real activity (polled from parity-stats.php every ~2 s while the tab is visible):
 * - a row of "wells" along the bottom, one per array disk, parity and pool; each filled to its real used %, parity
 *   rimmed in red, spun-down disks dark;
 * - writes: particles stream down from the top into the disk being written, at a rate that follows its real MB/s;
 * - reads: particles rise from the disk back up to the top;
 * - the top edge glows with real network traffic;
 * - hover near a well to highlight its stream and show a readout (name, read/write, used/size, temperature).
 * Idle shows only a faint drift. Redraws at ~24 fps; paused in hidden tabs; prefers-reduced-motion draws still frames.
 * (The previous block-grid "disk array" background is in git history.)
 */
(function () {
  'use strict'

  var STATS_URL = '/plugins/parity/parity-stats.php'
  var POLL_MS = 2000
  var FRAME_MS = 1000 / 24
  var BOTTOM = 44 // gap under the wells (clears the footer)
  var WELL_H = 64
  var MAX_PARTICLES = 700
  var BG = '#0b0b0c'
  var RED = [226, 40, 40]
  var ORANGE = [255, 140, 47]
  var PALE = [255, 208, 160]

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')'
  }
  function human(b) {
    var u = ['B', 'KB', 'MB', 'GB', 'TB']
    var i = 0
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++ }
    return (b >= 100 || i === 0 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i]
  }
  /** bytes/s -> particles/s: visible at 100 KB/s, heavy (but capped) at hundreds of MB/s */
  function pps(bytes) {
    return bytes <= 0 ? 0 : Math.min(36, 6.5 * Math.log2(1 + bytes / 200000))
  }
  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
  }

  function Streams() {
    var self = this
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'starfield-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(this.canvas, document.body.firstChild)
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return
    this.disks = []
    this.net = { rx: 0, tx: 0, srx: 0, stx: 0 }
    this.particles = []
    this.dust = []
    this.mx = this.my = -1e6
    this.acc = 0
    this.hovered = -1
    this.font = getComputedStyle(document.body).getPropertyValue('--nb-font-display').trim() || 'monospace'
    this.resize()
    var timer
    window.addEventListener('resize', function () {
      clearTimeout(timer)
      timer = setTimeout(function () { self.resize() }, 150)
    })
    window.addEventListener('pointermove', function (e) {
      self.mx = e.clientX
      self.my = e.clientY
    })
    var leave = function () { self.mx = self.my = -1e6 }
    document.addEventListener('mouseleave', leave)
    window.addEventListener('blur', leave)
    this.poll()
    document.addEventListener('visibilitychange', function () { if (!document.hidden) self.poll() })
    if (this.reducedMotion) return
    this.last = performance.now()
    requestAnimationFrame(function loop(t) { self.tick(t); requestAnimationFrame(loop) })
  }

  Streams.prototype.poll = function () {
    var self = this
    clearTimeout(this.pollTimer)
    if (document.hidden) return
    fetch(STATS_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(function (data) {
        self.apply(data)
        self.pollTimer = setTimeout(function () { self.poll() }, POLL_MS)
      })
      .catch(function () { self.pollTimer = setTimeout(function () { self.poll() }, 10000) })
  }

  Streams.prototype.apply = function (data) {
    var old = {}
    this.disks.forEach(function (d) { old[d.name] = d })
    var list = (data.disks || []).map(function (d) {
      var o = old[d.name]
      d.rr = o ? o.rr : 0 // smoothed rates
      d.rw = o ? o.rw : 0
      d.accR = d.accW = 0
      d.glow = o ? o.glow : 0
      d.hover = o ? o.hover : 0
      d.srcX = o ? o.srcX : null
      d.x = o ? o.x : 0
      d.w = o ? o.w : 0
      d.shownUsed = o ? o.shownUsed : d.used || 0
      return d
    })
    // parity first, then data disks, then pools
    var rank = { parity: 0, data: 1, cache: 2 }
    list.sort(function (a, b) { return (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name, undefined, { numeric: true }) })
    // particles keep pointing at their disk objects: re-point them at the fresh ones
    var byName = {}
    list.forEach(function (d) { byName[d.name] = d })
    this.particles = this.particles.filter(function (p) { return (p.disk = byName[p.disk.name]) })
    var changed = list.length !== this.disks.length
    this.disks = list
    this.net.rx = (data.net && data.net.rx) || 0
    this.net.tx = (data.net && data.net.tx) || 0
    if (changed) this.layout()
    if (this.reducedMotion) this.draw(performance.now())
  }

  Streams.prototype.resize = function () {
    this.w = Math.max(1, window.innerWidth)
    this.h = Math.max(1, window.innerHeight)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.dust = []
    for (var i = 0; i < Math.round((this.w * this.h) / 40000); i++)
      this.dust.push({ x: Math.random() * this.w, y: Math.random() * this.h, v: 4 + Math.random() * 8, a: 0.08 + Math.random() * 0.18 })
    this.layout()
    this.draw(performance.now())
  }

  Streams.prototype.layout = function () {
    this.wellTop = this.h - BOTTOM - WELL_H
    var n = this.disks.length
    if (!n) return
    var slot = Math.min(150, this.w / (n + 1))
    var ww = Math.max(26, Math.min(70, slot * 0.55))
    var x0 = this.w / 2 - (slot * (n - 1)) / 2
    var self = this
    this.disks.forEach(function (d, i) {
      d.x = x0 + i * slot
      d.w = ww
      if (d.srcX == null) d.srcX = self.w * (0.2 + 0.6 * Math.random())
    })
  }

  Streams.prototype.emit = function (d, dir, hot) {
    if (this.particles.length >= MAX_PARTICLES) return
    // each disk's stream comes from its own wandering point on the top edge, so streams branch apart
    this.particles.push({
      disk: d,
      dir: dir, // 1 = write (down), -1 = read (up)
      sx: d.srcX + gauss() * 70,
      tx: d.x + gauss() * d.w * 0.28,
      bend: gauss() * 120,
      t: 0,
      life: 1.9 + Math.random() * 1.4,
      size: hot ? 1.9 : 1.2 + Math.random() * 0.7,
    })
  }

  Streams.prototype.pathAt = function (p, u) {
    // cubic bezier from the top inlet to the well mouth (u: 0 = top, 1 = well)
    var y0 = -8, y1 = this.wellTop - 2
    var c1x = p.sx + p.bend, c1y = this.h * 0.38
    var c2x = p.tx - p.bend * 0.4, c2y = this.h * 0.62
    var m = 1 - u
    return [
      m * m * m * p.sx + 3 * m * m * u * c1x + 3 * m * u * u * c2x + u * u * u * p.tx,
      m * m * m * y0 + 3 * m * m * u * c1y + 3 * m * u * u * c2y + u * u * u * y1,
    ]
  }

  Streams.prototype.tick = function (t) {
    var dt = Math.min(100, t - this.last)
    this.last = t
    this.acc += dt
    if (this.acc < FRAME_MS) return
    var s = this.acc / 1000
    this.acc = 0
    var k = Math.min(1, s * 2.5)
    var self = this
    // hover: the well under the cursor (within the lower band)
    this.hovered = -1
    if (this.my > this.wellTop - 90)
      this.disks.forEach(function (d, i) { if (Math.abs(self.mx - d.x) < Math.max(d.w, 40)) self.hovered = i })
    this.disks.forEach(function (d, i) {
      d.rr += (d.read - d.rr) * k
      d.rw += (d.write - d.rw) * k
      d.shownUsed += ((d.used || 0) - d.shownUsed) * k
      d.glow += (Math.min(1, (pps(d.rr) + pps(d.rw)) / 30) - d.glow) * k
      d.hover += ((i === self.hovered ? 1 : 0) - d.hover) * Math.min(1, s * 8)
      d.srcX += gauss() * 30 * s // wander
      d.srcX = Math.max(self.w * 0.08, Math.min(self.w * 0.92, d.srcX))
      d.accW += pps(d.rw) * s
      d.accR += pps(d.rr) * s
      while (d.accW >= 1) { d.accW -= 1; self.emit(d, 1, i === self.hovered) }
      while (d.accR >= 1) { d.accR -= 1; self.emit(d, -1, i === self.hovered) }
    })
    for (var j = this.particles.length - 1; j >= 0; j--) {
      var p = this.particles[j]
      p.t += s / p.life
      if (p.t >= 1) this.particles.splice(j, 1)
    }
    this.net.srx += (this.net.rx - this.net.srx) * k
    this.net.stx += (this.net.tx - this.net.stx) * k
    for (var q = 0; q < this.dust.length; q++) {
      var m = this.dust[q]
      m.y += m.v * s
      if (m.y > this.h) { m.y = -2; m.x = Math.random() * this.w }
    }
    this.draw(t)
  }

  Streams.prototype.draw = function () {
    var ctx = this.ctx
    if (!ctx) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, this.w, this.h)

    // faint drifting dust so idle is not dead
    for (var q = 0; q < this.dust.length; q++) {
      var m = this.dust[q]
      ctx.fillStyle = rgba(ORANGE, m.a * 0.6)
      ctx.fillRect(m.x, m.y, 1.2, 1.2)
    }

    // network glow along the top edge
    var net = Math.min(1, Math.log2(1 + (this.net.srx + this.net.stx) / 100000) / 12)
    if (net > 0.01) {
      var g = ctx.createLinearGradient(0, 0, 0, 90)
      g.addColorStop(0, rgba(ORANGE, 0.35 * net))
      g.addColorStop(1, rgba(RED, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, this.w, 90)
    }

    // particles with short trails
    ctx.lineCap = 'round'
    for (var j = 0; j < this.particles.length; j++) {
      var p = this.particles[j]
      var u = p.dir > 0 ? p.t : 1 - p.t
      var u0 = Math.max(0, Math.min(1, u - 0.03 * p.dir))
      var a = this.pathAt(p, u), b = this.pathAt(p, u0)
      var fade = Math.min(1, p.t * 6, (1 - p.t) * 5)
      var hot = p.disk.hover
      var col = p.dir > 0 ? mix(ORANGE, RED, u) : mix(RED, PALE, 1 - u)
      ctx.strokeStyle = rgba(col, (0.55 + 0.45 * hot) * fade)
      ctx.lineWidth = p.size * (1 + hot * 0.6)
      ctx.beginPath()
      ctx.moveTo(b[0], b[1])
      ctx.lineTo(a[0], a[1])
      ctx.stroke()
    }

    // wells
    var top = this.wellTop
    ctx.font = '11px ' + this.font
    ctx.textAlign = 'center'
    this.disks.forEach(function (d) {
      var x = d.x - d.w / 2
      var dim = d.spundown ? 0.35 : 1
      // activity glow above the mouth
      if (d.glow > 0.02 || d.hover > 0.02) {
        var gg = ctx.createRadialGradient(d.x, top, 0, d.x, top, d.w * 1.4)
        gg.addColorStop(0, rgba(ORANGE, 0.35 * Math.max(d.glow, d.hover * 0.6)))
        gg.addColorStop(1, rgba(ORANGE, 0))
        ctx.fillStyle = gg
        ctx.fillRect(d.x - d.w * 1.5, top - d.w * 1.4, d.w * 3, d.w * 2)
      }
      // body
      ctx.fillStyle = 'rgba(20,20,22,0.85)'
      ctx.fillRect(x, top, d.w, WELL_H)
      if (d.type === 'parity') {
        // parity has no filesystem: draw it as a red-hatched, always-full disk
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, top, d.w, WELL_H)
        ctx.clip()
        ctx.strokeStyle = rgba(RED, 0.28 * dim)
        ctx.lineWidth = 1
        for (var hx = -WELL_H; hx < d.w; hx += 7) {
          ctx.beginPath()
          ctx.moveTo(x + hx, top + WELL_H)
          ctx.lineTo(x + hx + WELL_H, top)
          ctx.stroke()
        }
        ctx.restore()
      } else {
        // fill level = real used %
        var fh = WELL_H * Math.max(0, Math.min(1, d.shownUsed))
        var fg = ctx.createLinearGradient(0, top + WELL_H, 0, top)
        fg.addColorStop(0, rgba(RED, 0.75 * dim))
        fg.addColorStop(1, rgba(ORANGE, 0.75 * dim))
        ctx.fillStyle = fg
        ctx.fillRect(x, top + WELL_H - fh, d.w, fh)
      }
      // rim
      ctx.strokeStyle = d.type === 'parity' ? rgba(RED, 0.9 * dim) : rgba(ORANGE, (0.35 + 0.5 * Math.max(d.glow, d.hover)) * dim)
      ctx.lineWidth = d.hover > 0.5 ? 1.6 : 1
      ctx.strokeRect(x + 0.5, top + 0.5, d.w - 1, WELL_H - 1)
      if (!d.ok) {
        ctx.strokeStyle = 'rgba(240,0,12,0.95)'
        ctx.strokeRect(x - 2, top - 2, d.w + 4, WELL_H + 4)
      }
      // label
      ctx.fillStyle = rgba([242, 242, 242], (0.45 + 0.5 * d.hover) * (d.spundown ? 0.6 : 1))
      ctx.fillText(d.name, d.x, top + WELL_H + 14)
    })

    // hover readout
    var h = this.disks[this.hovered]
    if (h && h.hover > 0.3) {
      var lines = [
        h.name + (h.spundown ? '  (spun down)' : ''),
        'read  ' + human(h.read) + '/s',
        'write ' + human(h.write) + '/s',
        h.used != null ? 'used  ' + Math.round(h.used * 100) + '% of ' + human(h.size) : 'size  ' + human(h.size),
      ]
      if (h.temp != null) lines.push('temp  ' + h.temp + ' C')
      ctx.font = '12px ' + this.font
      ctx.textAlign = 'left'
      var bw = 0
      lines.forEach(function (l) { bw = Math.max(bw, ctx.measureText(l).width) })
      bw += 20
      var bh = lines.length * 16 + 12
      var bx = Math.max(6, Math.min(this.w - bw - 6, h.x - bw / 2))
      var by = top - bh - 14
      ctx.globalAlpha = Math.min(1, (h.hover - 0.3) * 2)
      ctx.fillStyle = 'rgba(14,14,16,0.92)'
      ctx.fillRect(bx, by, bw, bh)
      var lg = ctx.createLinearGradient(0, by, 0, by + bh)
      lg.addColorStop(0, '#e22828')
      lg.addColorStop(1, '#ff8c2f')
      ctx.fillStyle = lg
      ctx.fillRect(bx, by, 3, bh)
      lines.forEach(function (l, i) {
        ctx.fillStyle = i ? '#bdbdbd' : '#f2f2f2'
        ctx.fillText(l, bx + 12, by + 20 + i * 16)
      })
      ctx.globalAlpha = 1
    }
  }

  function start() {
    if (!document.body || document.querySelector('.starfield-canvas')) return
    new Streams()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
