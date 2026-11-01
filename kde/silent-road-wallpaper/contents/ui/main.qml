/* Silent County Road — Plasma 6 animated wallpaper.
 * The whole scene is one GPU fragment shader (../shaders/silentroad.frag, or sky.frag for a monitor above):
 * procedural pixel art, 24-colour palette, ordered dithering, hash-based snow, slow fog. The CPU only works out the
 * time of day:
 *   - the real sun for the configured location (default Grants Pass, OR): elevation, azimuth, today's sunrise/sunset,
 *     driving day / twilight / dawn-vs-dusk colouring and the sun's position;
 *   - the lamps: off by day, switched on (with a startup stutter) when the sun is ~3 deg above the horizon at dusk;
 *   - the snow timeline: snow builds from sunset to a peak in the small hours; ~25 min after sunrise a plough clears
 *     the road over ~2 minutes; the fog lifts by late morning; a little snow settles again through the afternoon.
 *   - the real lunar phase for the sky screen.
 * Both screens share one wall clock, so wind, snowfall, flicker and the plough line up across monitors.
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
    readonly property int erosionMode: main.configuration.erosionMode || 0   // 0 follows the day, 1 always clear, 2 always buried
    readonly property real latitude: main.configuration.latitude !== undefined ? main.configuration.latitude : 42.51
    readonly property real longitude: main.configuration.longitude !== undefined ? main.configuration.longitude : -123.39
    readonly property int previewHour: main.configuration.previewHour !== undefined ? main.configuration.previewHour : -1

    // ------------------------------------------------------------------ clocks
    function clockSeconds() { return (Date.now() / 1000) % 86400 }
    // "now" for the scene: the real time, or today at the preview hour (the minutes keep running so it still moves)
    function sceneDate() {
        var d = new Date()
        if (previewHour >= 0) d.setHours(previewHour)
        return d
    }

    // ------------------------------------------------------------------ sun (NOAA-style low-precision formulas)
    function sunPosition(date) {
        var rad = Math.PI / 180
        var n = date.getTime() / 86400000 + 2440587.5 - 2451545.0          // days since J2000
        var L = (280.460 + 0.9856474 * n) % 360
        var g = ((357.528 + 0.9856003 * n) % 360) * rad
        var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad
        var eps = (23.439 - 0.0000004 * n) * rad
        var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
        var dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
        var gmst = (18.697374558 + 24.06570982441908 * n) % 24
        var H = (gmst * 15 + longitude) * rad - ra                          // hour angle
        var lat = latitude * rad
        var elev = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H))
        var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI
        return { elev: elev / rad, az: (az / rad + 360) % 360 }
    }
    // today's sunrise / sunset as minutes after local midnight (scan in 2-minute steps; -0.833 deg = standard horizon)
    function sunTimes(date) {
        var d0 = new Date(date); d0.setHours(0, 0, 0, 0)
        var riseT = d0.getTime() + 7 * 3600000, setT = d0.getTime() + 17 * 3600000, prev = sunPosition(d0).elev
        for (var m = 2; m <= 1500; m += 2) {                     // 25 h covers the daylight-saving change day
            var t = d0.getTime() + m * 60000
            var e = sunPosition(new Date(t)).elev
            if (prev < -0.833 && e >= -0.833) riseT = t
            if (prev >= -0.833 && e < -0.833) setT = t
            prev = e
        }
        // report as LOCAL clock minutes (elapsed minutes since midnight are off by an hour on DST-change days)
        function clockMin(t) { var x = new Date(t); return x.getHours() * 60 + x.getMinutes() }
        return { rise: clockMin(riseT), set: clockMin(setT),
                 azRise: sunPosition(new Date(riseT)).az, azSet: sunPosition(new Date(setT)).az }
    }
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

    // real lunar phase: days since a known new moon (2000-01-06 18:14 UTC) over the synodic month
    function moonPhaseNow() {
        var days = (Date.now() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000
        var ph = (days / 29.530588853) % 1
        return ph < 0 ? ph + 1 : ph
    }

    // ------------------------------------------------------------------ the day's state (recomputed every few seconds)
    property var times: sunTimes(new Date())
    property real ploughStartMin: times.rise + 25
    property real lampsOnSinceMs: 0
    property bool lampsWereOn: false
    property bool started: false

    function update() {
        var d = sceneDate()
        var m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
        var sp = sunPosition(d)
        fx.sunElev = sp.elev
        fx.day = smooth(-8, 6, sp.elev)
        fx.twi = Math.exp(-Math.pow((sp.elev - 1) / 5.5, 2))
        fx.rising = m < 12 * 60 ? 1 : 0
        fx.sunX = Math.max(-0.2, Math.min(1.2, 0.08 + 0.84 * (sp.az - times.azRise) / Math.max(1, times.azSet - times.azRise)))

        // lamps: on below ~3 deg of sun elevation, with a startup stutter on switch-on
        var on = sp.elev < 3
        if (on && !lampsWereOn && started) lampsOnSinceMs = Date.now()   // stutter only on a real dusk switch-on
        lampsWereOn = on
        started = true
        fx.lamps = on ? 1 : 0
        fx.lampAge = on ? (lampsOnSinceMs ? (Date.now() - lampsOnSinceMs) / 1000 : 99) : 0

        // snow timeline
        var e = 0, cover = 0, plough = -1
        if (erosionMode === 1) { e = 0; cover = 0 }
        else if (erosionMode === 2) { e = 1; cover = 1 }
        else {
            var nightLen = times.rise + 1440 - times.set
            var since = m >= times.set ? m - times.set : m + 1440 - times.set   // minutes since last sunset
            var build = smooth(0, nightLen * 0.62, since)                       // peaks in the small hours
            var P = ploughStartMin
            if (m >= P + 2 && m < times.set) {                                   // ploughed, fog lifting, light snow returning
                var peak = smooth(0, nightLen * 0.62, P + 1440 - times.set)
                e = peak * (1 - smooth(P, P + 180, m))
                cover = 0.03 + 0.12 * smooth(P + 60, times.set, m)
            } else {
                e = build
                cover = build
                if (m >= P && m < P + 2) plough = (m - P) / 2                    // the plough's two minutes
            }
        }
        fx.erosion = e
        fx.roadCover = cover
        fx.plough = plough
    }

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
        property real erosion: 0
        property real flickerAmt: main.flickerAmt          // 0..2: up to 1 = depth, beyond = more often
        property real day: 0
        property real twi: 0
        property real rising: 0
        property real lamps: 1
        property real lampAge: 99
        property real roadCover: 0
        property real plough: -1
        property real sunX: 0.5
        property real sunElev: -20
        property size res: Qt.size(width, height)
        fragmentShader: Qt.resolvedUrl(main.scene === 1 ? "../shaders/sky.frag.qsb" : "../shaders/silentroad.frag.qsb")
    }

    Component.onCompleted: update()
    onPreviewHourChanged: update()
    onErosionModeChanged: update()
    onLatitudeChanged: { times = sunTimes(new Date()); ploughStartMin = times.rise + 25; update() }
    onLongitudeChanged: { times = sunTimes(new Date()); ploughStartMin = times.rise + 25; update() }

    Timer {                                   // animation clock
        interval: Math.round(1000 / Math.max(5, main.fps))
        running: true
        repeat: true
        onTriggered: fx.time = main.clockSeconds()
    }
    Timer {                                   // the day moves slowly: sun, lamps, snow timeline every 2 s
        interval: 2000
        running: true
        repeat: true
        onTriggered: main.update()
    }
    Timer {                                   // new day: recompute sunrise / sunset and the moon
        interval: 600000
        running: true
        repeat: true
        onTriggered: { main.times = main.sunTimes(new Date()); main.ploughStartMin = main.times.rise + 25; fx.moonPhase = main.moonPhaseNow() }
    }
}
