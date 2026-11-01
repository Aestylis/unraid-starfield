#version 440
// Silent County Road — SKY scene (for a monitor above the road scene).
// Same pixel grid, palette and dithering as silentroad.frag. No textures, no CPU-side state:
//   SKY    deep navy gradient; the bottom edge matches the road scene's upper sky so the two screens join up
//   MOON   pale disc with faint craters + cold halo; phase follows the real lunar calendar (uniform `moonPhase`)
//   CLOUDS slow fbm snow-cloud banks, posterised into a few tones, silver-lined toward the moon; they dim the moon
//   STARS  sparse, faint, only in cloud gaps
//   SNOW   the same hash flake layers as the road, revealed mostly where moonlight catches them
//   WINTER `erosion` (same clock as the road) thickens the cloud cover through the night
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;       // seconds (shared clock with the road scene)
    float pix;        // pixel-art block size, item units
    float snowAmt;    // 0..1
    float windAmt;    // 0..2
    float erosion;    // 0..1
    float moonPhase;  // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
    vec2 res;
};

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n + 17.3)); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
uint pcg(uint v) { uint st = v * 747796405u + 2891336453u; uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
float uh(vec2 c, float salt) { ivec2 i = ivec2(floor(c)); return float(pcg(uint(i.x) * 1973u ^ pcg(uint(i.y) * 9277u + uint(salt)))) / 4294967295.0; }
float noise1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
float bayer4(vec2 q) {
    int x = int(mod(q.x, 4.0)), y = int(mod(q.y, 4.0));
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[y * 4 + x]) + 0.5) / 16.0;
}
const vec3 PAL[16] = vec3[16](
    vec3(0.027, 0.035, 0.051), vec3(0.051, 0.067, 0.094), vec3(0.075, 0.098, 0.145), vec3(0.106, 0.133, 0.192),
    vec3(0.137, 0.173, 0.239), vec3(0.176, 0.216, 0.286), vec3(0.227, 0.271, 0.349), vec3(0.290, 0.337, 0.420),
    vec3(0.369, 0.416, 0.502), vec3(0.463, 0.510, 0.604), vec3(0.580, 0.627, 0.714), vec3(0.765, 0.796, 0.847),
    vec3(0.231, 0.188, 0.149), vec3(0.431, 0.329, 0.208), vec3(0.706, 0.541, 0.322), vec3(0.941, 0.827, 0.627));
vec3 quantize(vec3 c, vec2 q) {
    c += (bayer4(q) - 0.5) * 0.055;
    float bd = 1e9; vec3 best = PAL[0];
    for (int i = 0; i < 16; i++) { vec3 d = c - PAL[i]; float e = dot(d, d * vec3(1.0, 1.25, 0.9)); if (e < bd) { bd = e; best = PAL[i]; } }
    return best;
}

void main() {
    vec2 W = floor(res / pix);
    vec2 q = floor(qt_TexCoord0 * res / pix);
    q.y = W.y - 1.0 - q.y;                               // y up
    vec2 p = (q + 0.5) / W.y;                            // uv, 0..1 tall
    float A = W.x / W.y;
    float e = erosion;

    // wind: identical formula to the road scene so the snow drifts the same way on both screens
    float wind = windAmt * (time * 0.8 + 70.0 * noise1(time / 75.0) + 25.0 * noise1(time / 23.0) + 140.0 * pow(noise1(time / 140.0 + 9.0), 4.0));

    // ---------------- SKY: bottom edge = road scene's upper sky, deepening upward
    vec3 col = mix(vec3(0.045, 0.056, 0.083), vec3(0.020, 0.026, 0.040), pow(p.y, 0.8));

    // ---------------- MOON
    vec2 mc = vec2(A * 0.66, 0.58);
    float mr = 0.10;
    vec2 md = (p - mc) / mr;
    float mdist = length(md);

    // ---------------- CLOUDS: drifting fbm, posterised into bands; cover grows through the night
    vec2 cp = vec2(p.x * 2.2 + wind * 0.0009 + time * 0.0025, p.y * 4.5);
    float d = fbm(cp) * 0.75 + fbm(cp * 2.3 + vec2(time * 0.004, 0.0)) * 0.35;
    float cover = mix(0.46, 0.36, e);                    // lower threshold = more cloud
    float cloud = smoothstep(cover, cover + 0.18, d);
    float cloudAtMoon;                                   // how much cloud sits in front of the moon
    {
        vec2 cm = vec2(mc.x * 2.2 + wind * 0.0009 + time * 0.0025, mc.y * 4.5);
        float dm = fbm(cm) * 0.75 + fbm(cm * 2.3 + vec2(time * 0.004, 0.0)) * 0.35;
        cloudAtMoon = smoothstep(cover, cover + 0.18, dm);
    }

    // moon halo (dimmed when clouds cover the moon)
    float moonVis = 1.0 - 0.55 * cloudAtMoon;     // halo + moonlight soften (not vanish) when cloud crosses the moon
    float halo = exp(-max(mdist - 1.0, 0.0) * 1.6) * 0.20 * moonVis * (0.4 + 0.6 * abs(cos(6.2831853 * moonPhase - 3.14159265)));
    col += vec3(0.55, 0.62, 0.75) * halo;

    // stars: sparse, only where the sky is clear and away from the moon
    float sh = hash21(q * 0.731 + 3.0);
    if (sh > 0.9988 && cloud < 0.1 && mdist > 2.5) {
        float tw = 0.5 + 0.5 * sin(time * (0.8 + sh * 3.0) + sh * 50.0);
        col = mix(col, vec3(0.55, 0.60, 0.70), 0.5 + 0.4 * tw);
    }

    // the disc, with real phase: lit side right while waxing, left while waning
    if (mdist < 1.0) {
        float s = sqrt(max(0.0, 1.0 - md.y * md.y));
        float k = cos(6.2831853 * moonPhase);
        bool lit = moonPhase < 0.5 ? (md.x > s * k) : (md.x < -s * k);
        float crater = 0.88 + 0.12 * vnoise(md * 3.5 + 4.0) - 0.10 * smoothstep(0.55, 0.75, vnoise(md * 6.0 + 9.0));
        vec3 disc = lit ? vec3(0.86, 0.87, 0.84) * crater : vec3(0.10, 0.12, 0.16);   // dark side: faint earthshine
        col = disc;                       // full brightness; the cloud layer below hides whatever is behind cloud
    }

    // clouds over everything: shaded bands, silver-lined toward the moon
    if (cloud > 0.0) {
        float band = floor(clamp((d - cover) / 0.30, 0.0, 0.999) * 3.0) / 2.0;          // 3 posterised tones
        vec3 cc = mix(vec3(0.085, 0.10, 0.14), vec3(0.15, 0.175, 0.23), band);
        // moonlight on cloud edges near the moon
        float near = exp(-max(mdist - 0.8, 0.0) * 0.40) * (0.3 + 0.7 * abs(cos(6.2831853 * moonPhase - 3.14159265)));
        float edge = 1.0 - smoothstep(0.0, 0.35, cloud);
        cc += vec3(0.50, 0.55, 0.64) * near * (0.15 + 1.1 * edge * edge);
        col = mix(col, cc, smoothstep(0.0, 0.25, cloud));
    }

    // ---------------- SNOW: same layers as the road; visible mostly in the moon's light
    vec2 pp = q + 0.5;
    float flake = 0.0;
    for (int l = 0; l < 4; l++) {
        float cs    = l == 0 ? 7.0  : l == 1 ? 11.0 : l == 2 ? 19.0 : 70.0;
        float speed = l == 0 ? 2.6  : l == 1 ? 4.2  : l == 2 ? 6.5  : 5.0;
        float wm    = l == 0 ? 0.45 : l == 1 ? 0.75 : l == 2 ? 1.1  : 1.4;
        float dens  = (l == 0 ? 0.30 : l == 1 ? 0.22 : l == 2 ? 0.12 : 0.025) * snowAmt * 2.0;
        float size  = l == 0 ? 0.55 : l == 1 ? 0.65 : l == 2 ? 0.9  : 2.2;
        float bright= l == 0 ? 0.35 : l == 1 ? 0.55 : l == 2 ? 0.8  : 0.9;
        // varied fall speed: every column of cells has its own pace, so flakes slide past each other
        float sx = pp.x - wind * wm;
        float colH = uh(vec2(floor(sx / cs), 0.0), float(l) * 17.0 + 500.0);
        vec2 sp = vec2(sx, pp.y + time * speed * (0.6 + 0.8 * colH) + colH * 997.0);
        vec2 cell = floor(sp / cs);
        vec2 h = vec2(uh(cell, float(l) * 31.0 + 501.0), uh(cell, float(l) * 31.0 + 502.0));
        // patchy, breathing snowfall: slow drifting bands of heavier/lighter snow + intensity that swells over minutes
        float patchy = smoothstep(0.2, 0.8, vnoise(mod(cell * cs * 0.011 + vec2(time * 0.018, -time * 0.008), 512.0) + float(l) * 3.7));
        float swell = 0.5 + 0.5 * noise1(time / 70.0 + float(l) * 1.3);
        if (h.x > dens * (0.25 + 1.5 * patchy) * (0.45 + 0.75 * swell)) continue;
        vec2 c = (cell + 0.15 + 0.7 * vec2(uh(cell, float(l) * 31.0 + 503.0), uh(cell, float(l) * 31.0 + 504.0))) * cs;
        c.x += sin(time * (0.3 + 0.9 * h.y) + h.y * 40.0) * (0.3 + 1.7 * hash11(h.y * 71.0)) * (1.0 + float(l));   // each flake its own sway
        float dd = length(sp - c);
        if (dd < size) flake = max(flake, bright * (l == 3 ? smoothstep(size, size * 0.3, dd) : 1.0));
    }
    if (flake > 0.0) {
        float lit = clamp(exp(-max(mdist - 1.0, 0.0) * 0.9) * moonVis, 0.0, 1.0);
        float vis = mix(0.14, 0.95, lit) * flake;
        col = mix(col, mix(vec3(0.50, 0.55, 0.64), vec3(0.85, 0.89, 0.95), lit), vis);
    }

    fragColor = vec4(quantize(col, q), 1.0) * qt_Opacity;
}
