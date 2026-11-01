/* Unraid page background: a live circuit board (Array theme).
 * Data enters at a network connector on the left, runs through a controller chip, and fans out along copper traces to
 * one chip per disk on the right (parity, data disks, pools). Driven by real activity, polled from parity-theme-stats.php
 * every ~2 s while the tab is visible:
 * - writes travel as glowing packets left -> right along that disk's traces; reads travel right -> left;
 *   the packet rate follows the real MB/s (log scale) and active traces glow;
 * - each disk chip shows its real used %, parity is red, spun-down disks go dark;
 * - the connector's traces glow with real network traffic;
 * - hover a disk chip to highlight its traces and show a readout (name, read/write, used/size, temperature).
 * The static board is pre-rendered to an offscreen canvas; frames only add glow and packets (~24 fps, paused in hidden
 * tabs; prefers-reduced-motion draws still frames).
 */
(function () {
  'use strict'

  var STATS_URL = '/plugins/parity-theme/parity-theme-stats.php'
  var POLL_MS = 2000
  var FRAME_MS = 1000 / 24
  var SPEED = 520 // packet speed, px/s
  var MAX_PACKETS = 450
  var BG = '#0b0b0c'
  var RED = [226, 40, 40]
  var ORANGE = [255, 140, 47]
  var PALE = [255, 214, 170]
  var COPPER = 'rgba(255,140,47,0.11)'
  var COPPER_LIVE = 'rgba(255,140,47,0.20)'

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')'
  }
  function human(b) {
    var u = ['B', 'KB', 'MB', 'GB', 'TB']
    var i = 0
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++ }
    return (b >= 100 || i === 0 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i]
  }
  /** bytes/s -> packets/s: visible at ~100 KB/s, heavy (capped) at hundreds of MB/s */
  function pps(bytes) {
    return bytes <= 0 ? 0 : Math.min(24, 4.5 * Math.log2(1 + bytes / 200000))
  }
  function rnd(a, b) { return a + Math.random() * (b - a) }

  /** PCB-style route: horizontal, 45-degree diagonal, (vertical if the diagonal runs out of room), horizontal. */
  function route(x1, y1, x2, y2, xa) {
    var pts = [[x1, y1]]
    var dy = y2 - y1
    if (Math.abs(dy) < 0.5) { pts.push([x2, y2]); return pts }
    xa = Math.max(x1, Math.min(xa, x2 - 12))
    var room = Math.max(0, x2 - xa - 12)
    var d = Math.min(Math.abs(dy), room)
    var sg = dy > 0 ? 1 : -1
    pts.push([xa, y1])
    pts.push([xa + d, y1 + sg * d])
    if (Math.abs(dy) > d) pts.push([xa + d, y2])
    pts.push([x2, y2])
    return pts
  }
  /** Polyline with cumulative lengths, for walking packets along it. */
  function Path(pts) {
    this.pts = pts
    this.cum = [0]
    for (var i = 1; i < pts.length; i++)
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    this.len = this.cum[this.cum.length - 1]
  }
  Path.prototype.at = function (s) {
    s = Math.max(0, Math.min(this.len, s))
    var i = 1
    while (i < this.cum.length - 1 && this.cum[i] < s) i++
    var seg = this.cum[i] - this.cum[i - 1] || 1
    var t = (s - this.cum[i - 1]) / seg
    var a = this.pts[i - 1], b = this.pts[i]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  function stroke(ctx, pts) {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.stroke()
  }
  function via(ctx, x, y, r, col) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = col
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  function Board() {
    var self = this
    this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'starfield-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(this.canvas, document.body.firstChild)
    this.ctx = this.canvas.getContext('2d')
    if (!this.ctx) return
    this.board = document.createElement('canvas')
    this.disks = []
    this.net = { rx: 0, tx: 0, s: 0 }
    this.packets = []
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

  Board.prototype.poll = function () {
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

  Board.prototype.apply = function (data) {
    var old = {}
    this.disks.forEach(function (d) { old[d.name] = d })
    var list = (data.disks || []).map(function (d) {
      var o = old[d.name] || {}
      d.rr = o.rr || 0
      d.rw = o.rw || 0
      d.accR = o.accR || 0
      d.accW = o.accW || 0
      d.glow = o.glow || 0
      d.hover = o.hover || 0
      d.shownUsed = o.shownUsed != null ? o.shownUsed : d.used || 0
      return d
    })
    var rank = { parity: 0, data: 1, cache: 2 }
    list.sort(function (a, b) { return (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name, undefined, { numeric: true }) })
    var sig = list.map(function (d) { return d.name }).join(',')
    var relayout = sig !== this.sig
    this.sig = sig
    // carry geometry over when the disk set is unchanged; re-point packets at the fresh disk objects
    if (!relayout) list.forEach(function (d) { var o = old[d.name]; d.chip = o.chip; d.paths = o.paths; d.traces = o.traces })
    var byName = {}
    list.forEach(function (d) { byName[d.name] = d })
    this.packets = relayout ? [] : this.packets.filter(function (p) { return (p.disk = byName[p.disk.name]) })
    this.disks = list
    this.net.rx = (data.net && data.net.rx) || 0
    this.net.tx = (data.net && data.net.tx) || 0
    this.netIf = (data.net && data.net.if) || 'eth0'
    if (relayout) this.layout()
    if (this.reducedMotion) this.draw()
  }

  Board.prototype.resize = function () {
    this.w = Math.max(1, window.innerWidth)
    this.h = Math.max(1, window.innerHeight)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = this.board.width = Math.round(this.w * this.dpr)
    this.canvas.height = this.board.height = Math.round(this.h * this.dpr)
    this.layout()
    this.draw()
  }

  /** Place connector, controller and disk chips; route traces; pre-render the static board. */
  Board.prototype.layout = function () {
    var w = this.w, h = this.h, n = this.disks.length
    var cw = 128, ch = Math.max(150, n * 22 + 50)
    var cx = Math.round(Math.max(220, w * 0.3)), cy = Math.round(h * 0.56)
    this.ctrl = { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch }
    // network connector on the left edge: 4 lanes into the controller's left pins
    this.inlets = []
    for (var k = 0; k < 4; k++) {
      var y0 = cy - 27 + k * 18
      var y1 = cy - 30 + k * 20
      this.inlets.push(new Path(route(34, y0, this.ctrl.x, y1, rnd(90, 160))))
    }
    // disk chips down the right side
    var chipW = Math.min(150, Math.max(104, w * 0.08))
    var top = h * 0.17, bot = h * 0.94
    var slot = n ? (bot - top) / n : 0
    var chipH = Math.max(30, Math.min(56, slot - 14))
    var chipX = w - chipW - Math.max(24, w * 0.025)
    var xa = this.ctrl.x + cw + rnd(36, 60)
    var pinTop = this.ctrl.y + 26, pinSpan = ch - 52
    var self = this
    this.disks.forEach(function (d, i) {
      var y = top + slot * i + (slot - chipH) / 2
      d.chip = { x: chipX, y: y, w: chipW, h: chipH }
      d.traces = []
      d.paths = []
      for (var j = 0; j < 2; j++) {
        var outY = pinTop + (pinSpan * (i * 2 + j + 0.5)) / (n * 2)
        var inY = y + chipH / 2 - 5 + j * 10
        var pts = route(self.ctrl.x + cw, outY, chipX, inY, xa + j * 4)
        d.traces.push(pts)
        // a packet's whole journey: connector -> through the controller -> this trace
        d.paths.push(j)
      }
    })
    this.renderBoard()
  }

  /** Full journey for a packet: an inlet lane, straight through the controller, then one of the disk's traces. */
  Board.prototype.journey = function (d) {
    var inlet = this.inlets[(Math.random() * this.inlets.length) | 0]
    var trace = d.traces[(Math.random() * d.traces.length) | 0]
    return new Path(inlet.pts.concat(trace))
  }

  Board.prototype.renderBoard = function () {
    var ctx = this.board.getContext('2d')
    var w = this.w, h = this.h
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // decorative traces: short PCB runs with 45-degree bends, ending in vias
    var count = Math.round((w * h) / 26000)
    ctx.strokeStyle = COPPER
    ctx.lineWidth = 1.4
    for (var i = 0; i < count; i++) {
      var x = rnd(0, w), y = rnd(0, h), pts = [[x, y]]
      var dir = Math.random() < 0.5 ? 0 : Math.random() < 0.5 ? 1 : -1 // 0 straight, +-1 diagonal
      for (var s = 0; s < 2 + ((Math.random() * 4) | 0); s++) {
        var len = rnd(20, 140)
        if (dir === 0) x += len
        else { x += len * 0.7; y += dir * len * 0.7 }
        pts.push([x, y])
        dir = dir === 0 ? (Math.random() < 0.5 ? 1 : -1) : 0
      }
      stroke(ctx, pts)
      via(ctx, pts[0][0], pts[0][1], 2.4, COPPER)
      via(ctx, x, y, 2.4, COPPER)
    }
    // a few SMD parts
    ctx.fillStyle = 'rgba(255,140,47,0.06)'
    for (var c = 0; c < count / 4; c++) ctx.fillRect(rnd(0, w), rnd(0, h), rnd(6, 14), rnd(3, 6))
    // live traces (dim base)
    ctx.strokeStyle = COPPER_LIVE
    ctx.lineWidth = 2
    this.inlets.forEach(function (p) { stroke(ctx, p.pts) })
    this.disks.forEach(function (d) {
      d.traces.forEach(function (t) {
        stroke(ctx, t)
        via(ctx, t[1][0], t[1][1], 3, COPPER_LIVE)
      })
    })
    // network connector
    var cy = this.ctrl.y + this.ctrl.h / 2
    ctx.fillStyle = '#141416'
    ctx.fillRect(0, cy - 44, 34, 88)
    ctx.strokeStyle = 'rgba(255,140,47,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, cy - 43.5, 33, 87)
    ctx.fillStyle = 'rgba(255,140,47,0.25)'
    for (var k = 0; k < 4; k++) ctx.fillRect(26, cy - 29 + k * 18, 8, 4)
    // controller chip
    var r = this.ctrl
    ctx.fillStyle = 'rgba(255,140,47,0.30)'
    for (var py = r.y + 12; py < r.y + r.h - 8; py += 9) {
      ctx.fillRect(r.x - 6, py, 6, 3)
      ctx.fillRect(r.x + r.w, py, 6, 3)
    }
    for (var px = r.x + 12; px < r.x + r.w - 8; px += 9) {
      ctx.fillRect(px, r.y - 6, 3, 6)
      ctx.fillRect(px, r.y + r.h, 3, 6)
    }
    ctx.fillStyle = '#121214'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = 'rgba(255,140,47,0.4)'
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
    ctx.beginPath()
    ctx.arc(r.x + 12, r.y + 12, 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,140,47,0.35)'
    ctx.fill()
    ctx.font = '12px ' + this.font
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(242,242,242,0.35)'
    ctx.fillText('ARRAY', r.x + r.w / 2, r.y + r.h / 2 - 4)
    ctx.font = '10px ' + this.font
    ctx.fillStyle = 'rgba(242,242,242,0.2)'
    ctx.fillText('CTRL', r.x + r.w / 2, r.y + r.h / 2 + 12)
    // disk chip pins (bodies are drawn live)
    ctx.fillStyle = 'rgba(255,140,47,0.30)'
    this.disks.forEach(function (d) {
      var c = d.chip
      for (var y = c.y + 6; y < c.y + c.h - 3; y += 8) {
        ctx.fillRect(c.x - 5, y, 5, 3)
        ctx.fillRect(c.x + c.w, y, 5, 3)
      }
    })
  }

  Board.prototype.emit = function (d, dir) {
    if (this.packets.length >= MAX_PACKETS || !d.traces || !d.traces.length) return
    var path = this.journey(d)
    this.packets.push({ disk: d, dir: dir, path: path, s: dir > 0 ? 0 : path.len, speed: SPEED * rnd(0.85, 1.2) })
  }

  Board.prototype.tick = function (t) {
    var dt = Math.min(100, t - this.last)
    this.last = t
    this.acc += dt
    if (this.acc < FRAME_MS) return
    var s = this.acc / 1000
    this.acc = 0
    var k = Math.min(1, s * 2.5)
    var self = this
    this.hovered = -1
    this.disks.forEach(function (d, i) {
      var c = d.chip
      if (c && self.mx >= c.x - 10 && self.mx <= c.x + c.w + 10 && self.my >= c.y - 6 && self.my <= c.y + c.h + 6) self.hovered = i
    })
    this.disks.forEach(function (d, i) {
      d.rr += (d.read - d.rr) * k
      d.rw += (d.write - d.rw) * k
      d.shownUsed += ((d.used || 0) - d.shownUsed) * k
      d.glow += (Math.min(1, (pps(d.rr) + pps(d.rw)) / 16) - d.glow) * k
      d.hover += ((i === self.hovered ? 1 : 0) - d.hover) * Math.min(1, s * 8)
      d.accW += pps(d.rw) * s
      d.accR += pps(d.rr) * s
      while (d.accW >= 1) { d.accW -= 1; self.emit(d, 1) }
      while (d.accR >= 1) { d.accR -= 1; self.emit(d, -1) }
    })
    for (var j = this.packets.length - 1; j >= 0; j--) {
      var p = this.packets[j]
      p.s += p.dir * p.speed * s
      if (p.s > p.path.len || p.s < 0) this.packets.splice(j, 1)
    }
    this.net.s += (Math.min(1, Math.log2(1 + (this.net.rx + this.net.tx) / 100000) / 11) - this.net.s) * k
    this.draw()
  }

  Board.prototype.draw = function () {
    var ctx = this.ctx
    if (!ctx || !this.ctrl) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(this.board, 0, 0)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // network lanes glow with real traffic
    if (this.net.s > 0.02) {
      ctx.strokeStyle = rgba(ORANGE, 0.45 * this.net.s)
      ctx.lineWidth = 2
      this.inlets.forEach(function (p) { stroke(ctx, p.pts) })
    }
    // active disk traces glow
    this.disks.forEach(function (d) {
      var g = Math.max(d.glow, d.hover * 0.7)
      if (g < 0.02 || !d.traces) return
      ctx.lineWidth = 5
      ctx.strokeStyle = rgba(ORANGE, 0.08 * g)
      d.traces.forEach(function (t) { stroke(ctx, t) })
      ctx.lineWidth = 2
      ctx.strokeStyle = rgba(d.type === 'parity' ? RED : ORANGE, 0.55 * g)
      d.traces.forEach(function (t) { stroke(ctx, t) })
    })
    // packets: bright head with a fading tail behind it
    for (var j = 0; j < this.packets.length; j++) {
      var p = this.packets[j]
      var col = p.dir > 0 ? (p.disk.type === 'parity' ? RED : ORANGE) : PALE
      var hot = 1 + p.disk.hover * 0.5
      for (var q = 4; q >= 0; q--) {
        var pt = p.path.at(p.s - p.dir * q * 7)
        ctx.fillStyle = rgba(col, (q ? 0.5 - q * 0.1 : 1) * 0.9)
        ctx.beginPath()
        ctx.arc(pt[0], pt[1], (q ? 1.6 : 2.4) * hot, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // controller activity LED
    var busy = this.packets.length ? Math.min(1, this.packets.length / 40) : 0
    ctx.fillStyle = rgba(ORANGE, 0.25 + 0.75 * busy)
    ctx.beginPath()
    ctx.arc(this.ctrl.x + 12, this.ctrl.y + 12, 3, 0, Math.PI * 2)
    ctx.fill()
    // connector label
    ctx.font = '10px ' + this.font
    ctx.textAlign = 'center'
    ctx.fillStyle = rgba([242, 242, 242], 0.3 + 0.5 * this.net.s)
    ctx.fillText(this.netIf || 'eth0', 17, this.ctrl.y + this.ctrl.h / 2 + 58)
    // disk chips
    var self = this
    this.disks.forEach(function (d) {
      var c = d.chip
      if (!c) return
      var dim = d.spundown ? 0.4 : 1
      var accent = d.type === 'parity' ? RED : ORANGE
      ctx.fillStyle = '#121214'
      ctx.fillRect(c.x, c.y, c.w, c.h)
      // usage bar along the bottom of the chip (parity: hatched, it has no filesystem)
      var barY = c.y + c.h - 8, barW = c.w - 16
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(c.x + 8, barY, barW, 3)
      if (d.type === 'parity') {
        ctx.fillStyle = rgba(RED, 0.5 * dim)
        for (var hx = 0; hx < barW; hx += 6) ctx.fillRect(c.x + 8 + hx, barY, 3, 3)
      } else {
        var bg = ctx.createLinearGradient(c.x + 8, 0, c.x + 8 + barW, 0)
        bg.addColorStop(0, rgba(RED, 0.9 * dim))
        bg.addColorStop(1, rgba(ORANGE, 0.9 * dim))
        ctx.fillStyle = bg
        ctx.fillRect(c.x + 8, barY, barW * Math.max(0, Math.min(1, d.shownUsed)), 3)
      }
      ctx.strokeStyle = rgba(accent, (0.35 + 0.55 * Math.max(d.glow, d.hover)) * dim)
      ctx.lineWidth = d.hover > 0.5 ? 1.6 : 1
      ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1)
      if (!d.ok) {
        ctx.strokeStyle = 'rgba(240,0,12,0.95)'
        ctx.strokeRect(c.x - 3, c.y - 3, c.w + 6, c.h + 6)
      }
      // activity LED + label
      ctx.fillStyle = d.spundown ? 'rgba(120,120,120,0.4)' : rgba(accent, 0.3 + 0.7 * d.glow)
      ctx.beginPath()
      ctx.arc(c.x + 10, c.y + 10, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '11px ' + self.font
      ctx.textAlign = 'left'
      ctx.fillStyle = rgba([242, 242, 242], (0.55 + 0.45 * d.hover) * (d.spundown ? 0.6 : 1))
      ctx.fillText(d.name, c.x + 18, c.y + 14)
      if (c.h >= 40) {
        ctx.font = '10px ' + self.font
        ctx.fillStyle = 'rgba(242,242,242,0.35)'
        ctx.fillText(d.spundown ? 'standby' : d.used != null ? Math.round(d.used * 100) + '%' : 'parity', c.x + 18, c.y + 27)
      }
    })
    // hover readout, to the left of the chip
    var h = this.disks[this.hovered]
    if (h && h.hover > 0.3 && h.chip) {
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
      var bx = h.chip.x - bw - 18
      var by = Math.max(6, Math.min(this.h - bh - 6, h.chip.y + h.chip.h / 2 - bh / 2))
      ctx.globalAlpha = Math.min(1, (h.hover - 0.3) * 2)
      ctx.fillStyle = 'rgba(14,14,16,0.94)'
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
    new Board()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
