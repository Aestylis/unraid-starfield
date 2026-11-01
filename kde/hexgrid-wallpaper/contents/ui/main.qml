/* Hexgrid (Ember) — Plasma 6 animated wallpaper, GPU edition.
 * Port of hexgrid.js from the Unraid hexgrid-theme. A fragment shader (../shaders/hexgrid.frag) draws every pixel:
 * which hex it is in, the seams, and the colour from a drifting black -> grey -> orange gradient field mixed with that
 * hex's tile tint. The CPU only runs the swap bookkeeping: every so often two neighbouring hexes slide past each other
 * and trade places (carrying their tint); per-slot tints live in a tiny cols x rows texture that is repainted only when
 * a swap completes. Up to 6 swaps run at once and are passed to the shader as uniforms.
 */
import QtQuick
import org.kde.plasma.plasmoid

WallpaperItem {
    id: main

    readonly property int hexSize: main.configuration.hexSize || 30
    readonly property int fps: main.configuration.fps || 24
    readonly property int swapsPerSecond: main.configuration.swapsPerSecond !== undefined ? main.configuration.swapsPerSecond : 4

    Rectangle { anchors.fill: parent; color: "#050505" }

    QtObject {
        id: st
        property int cols: 0
        property int rows: 0
        property var tileOf: []   // slot -> tile id
        property var tint: []     // tile id -> 0..1
        property var swaps: []    // {a, b, t}
        property real lastMs: 0
        property real sinceSwap: 0
        readonly property real swapMs: 900
        readonly property int maxSwaps: 6

        function build() {
            var R = main.hexSize
            var hw = Math.sqrt(3) * R, vh = 1.5 * R
            cols = Math.ceil(main.width / hw) + 2
            rows = Math.ceil(main.height / vh) + 2
            var n = cols * rows, to = [], ti = []
            for (var i = 0; i < n; i++) {
                to.push(i)
                var r = Math.random()
                ti.push(r < 0.08 ? 0.85 + Math.random() * 0.15 : Math.random() * 0.55)
            }
            tileOf = to
            tint = ti
            swaps = []
            tintCanvas.requestPaint()
        }
        function center(i) {
            var R = main.hexSize, hw = Math.sqrt(3) * R, vh = 1.5 * R
            var c = i % cols, r = Math.floor(i / cols)
            return [(c - 0.5) * hw + (r & 1 ? hw / 2 : 0), (r - 0.5) * vh]
        }
        function neighbours(i) {
            var c = i % cols, r = Math.floor(i / cols)
            var d = (r & 1) ? [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
                            : [[1, 0], [-1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]]
            var out = []
            for (var k = 0; k < 6; k++) {
                var cc = c + d[k][0], rr = r + d[k][1]
                if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) out.push(rr * cols + cc)
            }
            return out
        }
        function startSwap() {
            if (swaps.length >= maxSwaps || !tileOf.length) return
            var busy = {}
            for (var i = 0; i < swaps.length; i++) { busy[swaps[i].a] = 1; busy[swaps[i].b] = 1 }
            for (var tries = 0; tries < 8; tries++) {
                var a = (Math.random() * tileOf.length) | 0
                if (busy[a]) continue
                var ns = neighbours(a).filter(function (n) { return !busy[n] })
                if (!ns.length) continue
                swaps.push({ a: a, b: ns[(Math.random() * ns.length) | 0], t: 0 })
                return
            }
        }
        function tick() {
            var now = Date.now()
            var dt = lastMs ? Math.min(250, now - lastMs) : 0
            lastMs = now
            if (!tileOf.length) build()
            if (main.swapsPerSecond > 0) {
                sinceSwap += dt
                var every = 1000 / main.swapsPerSecond
                while (sinceSwap >= every) { sinceSwap -= every; startSwap() }
            }
            var done = false
            for (var i = swaps.length - 1; i >= 0; i--) {
                var sw = swaps[i]
                sw.t += dt / swapMs
                if (sw.t >= 1) {
                    var ta = tileOf[sw.a]
                    tileOf[sw.a] = tileOf[sw.b]
                    tileOf[sw.b] = ta
                    swaps.splice(i, 1)
                    done = true
                }
            }
            if (done) tintCanvas.requestPaint()
            // hand the active swaps to the shader
            for (var k = 0; k < 6; k++) {
                var s = swaps[k]
                if (s) {
                    var A = center(s.a), B = center(s.b)
                    fx["swapPos" + k] = Qt.vector4d(A[0], A[1], B[0], B[1])
                    fx["swapInf" + k] = Qt.vector4d(s.t, tint[tileOf[s.a]], tint[tileOf[s.b]], 1)
                } else if (fx["swapInf" + k].w !== 0) {
                    fx["swapInf" + k] = Qt.vector4d(0, 0, 0, 0)
                }
            }
            fx.time = (now % 86400000) / 1000
        }
    }

    // per-slot tints: one pixel per hex, read by the shader
    Canvas {
        id: tintCanvas
        x: 0; y: 0
        width: Math.max(1, st.cols); height: Math.max(1, st.rows)
        renderStrategy: Canvas.Immediate
        onPaint: {
            var ctx = getContext("2d")
            for (var i = 0; i < st.tileOf.length; i++) {
                var g = Math.round(st.tint[st.tileOf[i]] * 255)
                ctx.fillStyle = "rgb(" + g + "," + g + "," + g + ")"
                ctx.fillRect(i % st.cols, Math.floor(i / st.cols), 1, 1)
            }
        }
    }
    ShaderEffectSource {
        id: tintSrc
        sourceItem: tintCanvas
        hideSource: true
        smooth: false
        visible: false
    }

    ShaderEffect {
        id: fx
        anchors.fill: parent
        property real time: 0
        property real hexR: main.hexSize
        property size res: Qt.size(width, height)
        property size grid: Qt.size(Math.max(1, st.cols), Math.max(1, st.rows))
        property var tints: tintSrc
        property vector4d swapPos0: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf0: Qt.vector4d(0, 0, 0, 0)
        property vector4d swapPos1: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf1: Qt.vector4d(0, 0, 0, 0)
        property vector4d swapPos2: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf2: Qt.vector4d(0, 0, 0, 0)
        property vector4d swapPos3: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf3: Qt.vector4d(0, 0, 0, 0)
        property vector4d swapPos4: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf4: Qt.vector4d(0, 0, 0, 0)
        property vector4d swapPos5: Qt.vector4d(0, 0, 0, 0); property vector4d swapInf5: Qt.vector4d(0, 0, 0, 0)
        fragmentShader: Qt.resolvedUrl("../shaders/hexgrid.frag.qsb")
    }

    onWidthChanged: st.tileOf = []
    onHeightChanged: st.tileOf = []
    onHexSizeChanged: st.tileOf = []

    Timer {
        interval: Math.round(1000 / Math.max(5, main.fps))
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: st.tick()
    }
}
