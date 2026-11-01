/* Hexgrid (Ember) — Plasma 6 animated wallpaper.
 * Port of hexgrid.js from the Unraid hexgrid-theme: a pointy-top hex grid whose colours come from a slow
 * black -> grey -> orange gradient field mixed with each hex's own fixed tint. Every so often two neighbouring hexes
 * shrink, slide past each other and swap places (carrying their tint). Hexes near the cursor warm up (when the pointer
 * is over bare desktop). Drawn with a QML Canvas at a configurable frame rate.
 */
import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: main

    readonly property int hexSize: main.configuration.hexSize || 30
    readonly property int fps: main.configuration.fps || 24
    readonly property int swapsPerSecond: main.configuration.swapsPerSecond !== undefined ? main.configuration.swapsPerSecond : 4
    readonly property bool mouseGlow: main.configuration.mouseGlow !== undefined ? main.configuration.mouseGlow : true

    Rectangle { anchors.fill: parent; color: "#050505" }

    Canvas {
        id: canvas
        anchors.fill: parent
        renderStrategy: Canvas.Threaded
        renderTarget: Canvas.Image

        // grid state
        property var slots: []   // {x, y, col, row, tile}
        property var tiles: []   // {tint, hover}
        property var swaps: []   // {a, b, t}
        property int cols: 0
        property int rows: 0
        property real lastT: 0
        property real sinceSwap: 0
        property real mx: -1e6
        property real my: -1e6
        property var hexX: []
        property var hexY: []

        readonly property real gap: 1.6
        readonly property real swapMs: 900
        readonly property int maxSwaps: 6
        readonly property real hoverRadius: 160
        readonly property var stops: [
            [0.0, [10, 10, 10]],
            [0.42, [30, 30, 30]],
            [0.66, [58, 56, 54]],
            [0.84, [128, 62, 18]],
            [1.0, [255, 140, 47]]
        ]

        function gradient(v) {
            v = v < 0 ? 0 : v > 1 ? 1 : v
            for (var i = 1; i < stops.length; i++) {
                if (v <= stops[i][0]) {
                    var a = stops[i - 1], b = stops[i]
                    var t = (v - a[0]) / (b[0] - a[0])
                    return "rgb(" + ((a[1][0] + (b[1][0] - a[1][0]) * t) | 0) + "," + ((a[1][1] + (b[1][1] - a[1][1]) * t) | 0) + "," + ((a[1][2] + (b[1][2] - a[1][2]) * t) | 0) + ")"
                }
            }
            return "rgb(255,140,47)"
        }

        function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

        function field(x, y, t) {
            var s = t / 1000
            var v = 0.5 + 0.28 * Math.sin(x * 0.0042 + s * 0.22 + Math.sin(y * 0.003 + s * 0.09) * 1.6) + 0.22 * Math.sin(y * 0.0058 - s * 0.17 + x * 0.0013)
            return Math.pow(Math.max(0, Math.min(1, v)), 1.5)
        }

        function build() {
            var R = main.hexSize
            var w = Math.max(1, width), h = Math.max(1, height)
            var hw = Math.sqrt(3) * R, vh = 1.5 * R
            cols = Math.ceil(w / hw) + 2
            rows = Math.ceil(h / vh) + 2
            var s = [], tl = []
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) {
                    var i = s.length
                    s.push({ x: (c - 0.5) * hw + (r & 1 ? hw / 2 : 0), y: (r - 0.5) * vh, col: c, row: r, tile: i })
                    var t = Math.random()
                    tl.push({ tint: t < 0.08 ? 0.85 + Math.random() * 0.15 : Math.random() * 0.55, hover: 0 })
                }
            }
            slots = s
            tiles = tl
            swaps = []
            // hex outline offsets (pointy top), inset by half the seam
            var rr = R - gap / 2, xs = [], ys = []
            for (var k = 0; k < 6; k++) {
                var ang = Math.PI / 180 * (60 * k - 30)
                xs.push(rr * Math.cos(ang))
                ys.push(rr * Math.sin(ang))
            }
            hexX = xs
            hexY = ys
        }

        function slotAt(c, r) {
            if (c < 0 || r < 0 || c >= cols || r >= rows) return -1
            return r * cols + c
        }

        function neighbours(sl) {
            var d = (sl.row & 1) ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
                                 : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]
            var out = []
            for (var i = 0; i < 6; i++) {
                var n = slotAt(sl.col + d[i][0], sl.row + d[i][1])
                if (n >= 0) out.push(n)
            }
            return out
        }

        function startSwap() {
            if (swaps.length >= maxSwaps || !slots.length) return
            var busy = {}
            for (var i = 0; i < swaps.length; i++) { busy[swaps[i].a] = 1; busy[swaps[i].b] = 1 }
            for (var tries = 0; tries < 8; tries++) {
                var a = (Math.random() * slots.length) | 0
                if (busy[a]) continue
                var ns = neighbours(slots[a]).filter(function (n) { return !busy[n] })
                if (!ns.length) continue
                swaps.push({ a: a, b: ns[(Math.random() * ns.length) | 0], t: 0 })
                return
            }
        }

        function hexPath(ctx, x, y, scale) {
            ctx.beginPath()
            ctx.moveTo(x + hexX[0] * scale, y + hexY[0] * scale)
            for (var k = 1; k < 6; k++) ctx.lineTo(x + hexX[k] * scale, y + hexY[k] * scale)
            ctx.closePath()
            ctx.fill()
        }

        function step(now) {
            var dt = lastT ? Math.min(250, now - lastT) : 0
            lastT = now
            if (main.swapsPerSecond > 0) {
                sinceSwap += dt
                var every = 1000 / main.swapsPerSecond
                while (sinceSwap >= every) { sinceSwap -= every; startSwap() }
            }
            for (var i = swaps.length - 1; i >= 0; i--) {
                var sw = swaps[i]
                sw.t += dt / swapMs
                if (sw.t >= 1) {
                    var ta = slots[sw.a].tile
                    slots[sw.a].tile = slots[sw.b].tile
                    slots[sw.b].tile = ta
                    swaps.splice(i, 1)
                }
            }
            return dt
        }

        onPaint: {
            if (!slots.length) build()
            var ctx = getContext("2d")
            var now = Date.now()
            var dt = step(now)
            var t = now
            ctx.fillStyle = "#050505"
            ctx.fillRect(0, 0, width, height)
            var moving = {}
            for (var q = 0; q < swaps.length; q++) { moving[swaps[q].a] = 1; moving[swaps[q].b] = 1 }
            var hr2 = hoverRadius * hoverRadius
            var smooth = Math.min(1, dt / 1000 * 6)
            for (var i = 0; i < slots.length; i++) {
                var s = slots[i]
                var tile = tiles[s.tile]
                if (main.mouseGlow) {
                    var dx = s.x - mx, dy = s.y - my
                    var d2 = dx * dx + dy * dy
                    var target = d2 < hr2 ? 1 - Math.sqrt(d2) / hoverRadius : 0
                    tile.hover += (target - tile.hover) * smooth
                } else tile.hover = 0
                if (moving[i]) continue
                ctx.fillStyle = gradient(0.68 * field(s.x, s.y, t) + 0.32 * tile.tint + tile.hover * 0.45)
                hexPath(ctx, s.x, s.y, 1)
            }
            // swapping hexes: empty sockets, then the two hexes sliding past each other, shrunk a little
            for (var k = 0; k < swaps.length; k++) {
                var sw = swaps[k]
                var A = slots[sw.a], B = slots[sw.b]
                var e = ease(Math.min(1, sw.t))
                var lift = Math.sin(Math.PI * Math.min(1, sw.t))
                var scale = 1 - 0.18 * lift
                ctx.fillStyle = "#0b0b0b"
                hexPath(ctx, A.x, A.y, 1)
                hexPath(ctx, B.x, B.y, 1)
                var pairs = [[A, B, tiles[A.tile]], [B, A, tiles[B.tile]]]
                for (var p = 0; p < 2; p++) {
                    var from = pairs[p][0], to = pairs[p][1], tl = pairs[p][2]
                    var sign = p ? -1 : 1
                    var x = from.x + (to.x - from.x) * e - (to.y - from.y) * 0.18 * lift * sign
                    var y = from.y + (to.y - from.y) * e + (to.x - from.x) * 0.18 * lift * sign
                    ctx.fillStyle = gradient(0.68 * field(x, y, t) + 0.32 * tl.tint + (tl.hover + 0.25 * lift) * 0.45)
                    hexPath(ctx, x, y, scale)
                }
            }
        }

        onWidthChanged: slots = []
        onHeightChanged: slots = []
    }

    Connections {
        target: main
        function onHexSizeChanged() { canvas.slots = [] }
    }

    // pointer over bare desktop warms nearby hexes
    HoverHandler {
        id: hover
        enabled: main.mouseGlow
        onPointChanged: {
            canvas.mx = hover.point.position.x
            canvas.my = hover.point.position.y
        }
        onHoveredChanged: if (!hovered) { canvas.mx = -1e6; canvas.my = -1e6 }
    }

    Timer {
        interval: Math.round(1000 / Math.max(5, main.fps))
        running: true
        repeat: true
        onTriggered: canvas.requestPaint()
    }
}
