/* Silent County Road — Plasma 6 animated wallpaper.
 * The whole scene is one GPU fragment shader (../shaders/silentroad.frag): procedural pixel art, 16-colour palette,
 * ordered dithering, hash-based snow, lamp-lit visibility, slow fog. The CPU only advances the clock.
 * Scene 1 (sky.frag) is a companion sky for a monitor above: moon in its real phase behind drifting snow clouds.
 * "Winter erosion" follows the real time of night: clear in the daytime, fog gathering from ~18:00, the road at its
 * most buried around 03:30, clearing again by ~07:00. Configurable to always-clear / always-buried.
 */
import QtQuick
import QtQuick.Window
import org.kde.plasma.plasmoid

WallpaperItem {
    id: main

    readonly property int pixelSize: main.configuration.pixelSize || 4
    readonly property int fps: main.configuration.fps || 24
    readonly property real snowAmt: (main.configuration.snowDensity !== undefined ? main.configuration.snowDensity : 50) / 100
    readonly property real fogAmt: (main.configuration.fogDensity !== undefined ? main.configuration.fogDensity : 50) / 50
    readonly property real windAmt: (main.configuration.windStrength !== undefined ? main.configuration.windStrength : 50) / 50
    readonly property real flickerAmt: (main.configuration.flicker !== undefined ? main.configuration.flicker : 50) / 50
    readonly property int scene: main.configuration.scene || 0               // 0 road, 1 sky (for a monitor above)
    readonly property int erosionMode: main.configuration.erosionMode || 0   // 0 clock, 1 always clear, 2 always buried

    // one wall clock for every screen, so wind, snowfall and flicker line up across monitors
    function clockSeconds() { return (Date.now() / 1000) % 86400 }
    // real lunar phase: days since a known new moon (2000-01-06 18:14 UTC) over the synodic month
    function moonPhaseNow() {
        var days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000
        var ph = (days / 29.530588853) % 1
        return ph < 0 ? ph + 1 : ph
    }

    function erosionNow() {
        if (erosionMode === 1) return 0
        if (erosionMode === 2) return 1
        var d = new Date()
        var h = d.getHours() + d.getMinutes() / 60
        var since6pm = (h - 18 + 24) % 24                       // 0 at 18:00
        var rise = smooth(0, 9.5, since6pm)                     // 18:00 -> 03:30
        var fall = 1 - smooth(11, 13, since6pm)                 // 05:00 -> 07:00
        return rise * fall
    }
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

    Rectangle { anchors.fill: parent; color: "#07090d" }

    ShaderEffect {
        id: fx
        anchors.fill: parent
        property real time: main.clockSeconds()
        // block size in PHYSICAL pixels, so a scaled monitor gets the same-size pixels as an unscaled one
        property real pix: main.pixelSize / Math.max(1, Screen.devicePixelRatio)
        property real moonPhase: main.moonPhaseNow()
        property real snowAmt: main.snowAmt
        property real fogAmt: main.fogAmt
        property real windAmt: main.windAmt
        property real erosion: main.erosionNow()
        property real flickerAmt: main.flickerAmt          // 0..2: up to 1 = depth, beyond = more often
        property size res: Qt.size(width, height)
        fragmentShader: Qt.resolvedUrl(main.scene === 1 ? "../shaders/sky.frag.qsb" : "../shaders/silentroad.frag.qsb")
    }

    Timer {
        interval: Math.round(1000 / Math.max(5, main.fps))
        running: true
        repeat: true
        onTriggered: fx.time = main.clockSeconds()
    }
    Timer {                                   // the night moves slowly: refresh erosion once a minute
        interval: 60000
        running: true
        repeat: true
        onTriggered: { fx.erosion = main.erosionNow(); fx.moonPhase = main.moonPhaseNow() }
    }
    onErosionModeChanged: fx.erosion = main.erosionNow()
}
