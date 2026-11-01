#version 440
// Silent County Road — procedural pixel-art winter night (Plasma 6 wallpaper).
// One pass: every screen pixel is snapped to a coarse pixel grid, the scene is evaluated analytically at that grid
// pixel, then ordered-dithered into a fixed 16-colour palette. No textures, no CPU-side state:
//   SCENE  sky, tree lines, road + snowbanks, poles, wire, streetlamps, fence (static, from fixed layout + hashes)
//   LIGHT  two warm lamp pools / cones / halos
//   FOG    slow value-noise fog, thickest near the horizon, warmed inside lamplight
//   SNOW   hash-generated flakes in 3 depth layers + rare near flakes; nearly invisible unless lamp-lit
//   WIND   slow "moods" from layered low-frequency noise (calm / drift / whisper gust)
//   FLICKER lamps burn steady, then rarely stutter for a few seconds (the far lamp is the dying one)
//   WINTER `erosion` (0..1, driven by the real clock) thickens fog, softens the road edge, buries the fence,
//          and grows snow caps; `roadCover` is snow lying on the road itself
//   DAY    `day` 0..1 / `twi` 0..1 / `rising` re-light the whole scene from the real sun: night -> blue hour -> rose
//          dawn or orange dusk -> overcast winter day. Lamps switch off by day and stutter back on at dusk.
//   PLOUGH once each morning a small plough with an amber beacon crawls up the road, leaving ploughed lanes.
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;      // session seconds
    float pix;       // pixel-art block size, item units
    float snowAmt;   // 0..1
    float fogAmt;    // 0..1
    float windAmt;   // 0..1
    float erosion;   // 0..1
    float flickerAmt;// 0..2 (1 = default)
    float day;       // 0 night .. 1 full daylight
    float twi;       // twilight strength (peaks at sunrise / sunset)
    float rising;    // 1 morning, 0 evening (dawn rose vs dusk orange)
    float lamps;     // 1 lamps on, 0 off
    float lampAge;   // seconds since the lamps last switched on (startup stutter)
    float roadCover; // 0 ploughed .. 1 deep snow on the road
    float plough;    // <0 none, 0..1 progress of the plough from the bottom of the screen to the horizon
    float sunX;      // sun position across the screen (0..1 of width) and its elevation in degrees
    float sunElev;
    vec2 res;        // item size
};

// ------------------------------------------------------------------ utilities
float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n + 17.3)); }
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
uint pcg(uint v) { uint st = v * 747796405u + 2891336453u; uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
float uh(vec2 c, float salt) { ivec2 i = ivec2(floor(c)); return float(pcg(uint(i.x) * 1973u ^ pcg(uint(i.y) * 9277u + uint(salt)))) / 4294967295.0; }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
float noise1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
float bayer4(vec2 q) {
    int x = int(mod(q.x, 4.0)), y = int(mod(q.y, 4.0));
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

// ---- palettes: one hand-picked 16-colour set per phase; the active palette blends between them each frame
//      (night <-> day by sun height, then toward dusk or dawn during twilight); entries 16-19 are each phase's sky blues.
//      PAL_TAIL is reserved for the plough.
const vec3 PAL_NIGHT[20] = vec3[20](
    vec3(0.027, 0.035, 0.051), vec3(0.051, 0.067, 0.094), vec3(0.075, 0.098, 0.145), vec3(0.106, 0.133, 0.192),
    vec3(0.137, 0.173, 0.239), vec3(0.176, 0.216, 0.286), vec3(0.227, 0.271, 0.349), vec3(0.290, 0.337, 0.420),
    vec3(0.369, 0.416, 0.502), vec3(0.463, 0.510, 0.604), vec3(0.580, 0.627, 0.714), vec3(0.765, 0.796, 0.847),
    vec3(0.231, 0.188, 0.149), vec3(0.431, 0.329, 0.208), vec3(0.706, 0.541, 0.322), vec3(0.941, 0.827, 0.627),
    vec3(0.050, 0.070, 0.140), vec3(0.080, 0.110, 0.220), vec3(0.120, 0.170, 0.320), vec3(0.200, 0.270, 0.450));
const vec3 PAL_DAY[20] = vec3[20](
    vec3(0.100, 0.120, 0.120), vec3(0.160, 0.200, 0.190), vec3(0.220, 0.200, 0.190), vec3(0.300, 0.330, 0.360),
    vec3(0.400, 0.440, 0.480), vec3(0.480, 0.520, 0.570), vec3(0.580, 0.630, 0.690), vec3(0.660, 0.710, 0.770),
    vec3(0.740, 0.780, 0.830), vec3(0.820, 0.850, 0.890), vec3(0.890, 0.910, 0.940), vec3(0.950, 0.960, 0.970),
    vec3(0.550, 0.330, 0.140), vec3(0.800, 0.520, 0.200), vec3(0.450, 0.460, 0.480), vec3(1.000, 0.800, 0.450),
    vec3(0.300, 0.460, 0.740), vec3(0.420, 0.580, 0.830), vec3(0.560, 0.690, 0.880), vec3(0.700, 0.800, 0.930));
const vec3 PAL_DUSK[20] = vec3[20](
    vec3(0.050, 0.050, 0.090), vec3(0.090, 0.090, 0.150), vec3(0.140, 0.130, 0.210), vec3(0.200, 0.180, 0.280),
    vec3(0.280, 0.240, 0.340), vec3(0.380, 0.300, 0.380), vec3(0.500, 0.380, 0.420), vec3(0.640, 0.460, 0.420),
    vec3(0.780, 0.540, 0.380), vec3(0.900, 0.620, 0.360), vec3(0.960, 0.740, 0.480), vec3(0.990, 0.860, 0.640),
    vec3(0.231, 0.188, 0.149), vec3(0.431, 0.329, 0.208), vec3(0.706, 0.541, 0.322), vec3(0.941, 0.827, 0.627),
    vec3(0.080, 0.100, 0.220), vec3(0.130, 0.170, 0.340), vec3(0.200, 0.250, 0.460), vec3(0.300, 0.360, 0.580));
const vec3 PAL_DAWN[20] = vec3[20](
    vec3(0.060, 0.060, 0.100), vec3(0.100, 0.110, 0.170), vec3(0.160, 0.170, 0.250), vec3(0.240, 0.250, 0.340),
    vec3(0.340, 0.340, 0.440), vec3(0.460, 0.430, 0.520), vec3(0.600, 0.520, 0.600), vec3(0.740, 0.600, 0.660),
    vec3(0.860, 0.680, 0.660), vec3(0.930, 0.780, 0.700), vec3(0.970, 0.880, 0.800), vec3(0.990, 0.950, 0.900),
    vec3(0.231, 0.188, 0.149), vec3(0.431, 0.329, 0.208), vec3(0.706, 0.541, 0.322), vec3(0.941, 0.827, 0.627),
    vec3(0.090, 0.120, 0.250), vec3(0.150, 0.210, 0.400), vec3(0.240, 0.330, 0.560), vec3(0.380, 0.480, 0.700));
const vec3 PAL_TAIL = vec3(0.702, 0.235, 0.188);
vec3 quantize(vec3 c, vec2 q) {
    c += (bayer4(q) - 0.5) * 0.055;
    float bd = 1e9; vec3 best = vec3(0.0);
    for (int i = 0; i < 20; i++) {
        vec3 pc = mix(mix(PAL_NIGHT[i], PAL_DAY[i], day), mix(PAL_DUSK[i], PAL_DAWN[i], rising), twi * 0.85);
        vec3 d = c - pc; float e = dot(d, d * vec3(1.0, 1.25, 0.9));
        if (e < bd) { bd = e; best = pc; }
    }
    return best;
}

// night colour -> day colour, by the global `day`
vec3 DN(vec3 night, vec3 dayc) { return mix(night, dayc, day); }

// ------------------------------------------------------------------ layout (uv: y up, 0..1 tall, 0..A wide)
const float HZ = 0.40;           // horizon
float A;                         // aspect
vec2 VP;                         // road vanishing point
float px1;                       // one pixel in uv

float roadT(float y) { return clamp((HZ - y) / HZ, 0.0, 1.0); }               // 0 at horizon, 1 at bottom
float roadCx(float y) { float t = roadT(y); return VP.x + t * (A * 0.47 - VP.x) + 0.05 * A * t * t; }
float roadHw(float y) { float t = roadT(y); return 0.003 + t * 0.26; }

// spruce silhouette: cell grid along x, returns 1 inside a tree; tip = 1 on snowy tier tips
float spruces(vec2 p, float baseY, float cw, float hMin, float hMax, float seed, float gapX, float gapW, out float tip) {
    tip = 0.0;
    float inside = 0.0;
    float ci = floor(p.x / cw);
    for (int k = -1; k <= 1; k++) {
        float c = ci + float(k);
        float r1 = hash11(c * 3.17 + seed), r2 = hash11(c * 7.31 + seed * 2.0);
        float cx = (c + 0.5 + (r1 - 0.5) * 0.7) * cw;
        float h = mix(hMin, hMax, r2);
        h *= smoothstep(0.0, gapW, abs(cx - gapX));                 // opening where the road leaves
        float y = p.y - baseY;
        if (y < 0.0 || y > h) continue;
        float tiers = 5.0 + floor(r1 * 3.0);
        float s = fract((y / h) * tiers);                            // 0 at bottom of tier, 1 at top
        float hw = (h - y) * 0.30 * (0.62 + 0.38 * (1.0 - s));      // jagged tiers
        hw = max(hw, px1 * 0.8);                                     // trunk / tip at least a pixel
        if (abs(p.x - cx) < hw) {
            inside = 1.0;
            if (s > 0.90 && abs(p.x - cx) > hw * 0.5) tip = 1.0;    // snow resting on tier ends
        }
    }
    return inside;
}

// one hand-placed spruce: base y, centre x, height; tip = snowy tier end
float spruce(vec2 p, float baseY, float cx, float h, float seed, inout float tip) {
    float y = p.y - baseY;
    if (y < 0.0 || y > h) return 0.0;
    float tiers = 6.0 + floor(hash11(seed) * 3.0);
    float s = fract((y / h) * tiers);
    float hw = (h - y) * 0.27 * (0.60 + 0.40 * (1.0 - s));
    hw = max(hw, px1 * 0.8);
    float jag = (hash11(floor(y / px1) + seed) - 0.5) * px1 * 1.6;   // ragged needles
    if (abs(p.x - cx) < hw + jag) {
        if (s > 0.88 && abs(p.x - cx) > hw * 0.55) tip = 1.0;
        return 1.0;
    }
    return 0.0;
}

// distance (in pixels) to a segment
float segPx(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) / px1; }

// lamp light at p: ground pool + cone + halo. head = lamp head position, g = ground y under it, k = strength
float lampLight(vec2 p, vec2 head, float g, float k, out float halo) {
    vec2 d = p - head;
    halo = k * exp(-dot(d, d) / (0.0016 * k));
    float below = head.y - p.y;
    float cone = 0.0;
    if (below > 0.0) {
        float r = below * 0.55 + 0.004;
        cone = smoothstep(r, r * 0.25, abs(d.x)) * smoothstep(head.y - g + 0.02, 0.0, below) * k;
    }
    vec2 pd = vec2((p.x - head.x) / (0.20 * k), (p.y - g) / (0.045 * k));
    float pool = exp(-dot(pd, pd)) * k;
    return max(cone * 0.75, pool);
}

// Lamp flicker: time is split into windows; a window hosts a stutter episode with probability `chance`.
// Inside the episode the lamp jumps between dim/off/on at ~12 Hz, with brief full blackouts. Returns intensity 0..1.
float flicker(float t, float seed, float window, float chance) {
    float w = floor(t / window);
    if (hash11(w * 1.731 + seed) > chance) return 1.0;
    float start = hash11(w * 3.17 + seed) * (window - 6.0);
    float len = 1.2 + hash11(w * 5.91 + seed) * 3.8;
    float local = t - w * window - start;
    if (local < 0.0 || local > len) return 1.0;
    float tick = floor(t * 12.0);
    float r = hash11(tick * 0.917 + seed);
    float dead = step(0.82, hash11(floor(t * 3.0) * 1.37 + seed));           // ~1/3 s blackouts
    return mix(r < 0.45 ? 0.08 : r < 0.75 ? 0.55 : 1.0, 0.04, dead);
}

void main() {
    // coarse pixel grid
    vec2 W = floor(res / pix);
    vec2 q = floor(qt_TexCoord0 * res / pix);
    q.y = W.y - 1.0 - q.y;                         // y up
    vec2 p = (q + 0.5) / W.y;                      // uv
    A = W.x / W.y;
    px1 = 1.0 / W.y;
    VP = vec2(A * 0.36, HZ);
    float e = erosion;

    // ---------------- LIGHT (two streetlamps along the left verge)
    vec2 lamp1 = vec2(roadCx(0.20) - roadHw(0.20) - 0.02 + 0.07, 0.52); float g1 = 0.20;
    vec2 lamp2 = vec2(roadCx(0.355) - roadHw(0.355) - 0.012 + 0.022, 0.468); float g2 = 0.355;
    float f1 = mix(1.0, flicker(time, 3.0, 90.0, 0.35 * max(flickerAmt, 1.0)), min(flickerAmt, 1.0));           // near lamp: rare stutters
    float f2 = mix(1.0, flicker(time + 7.0, 11.0, 40.0, 0.40 * max(flickerAmt, 1.0)), min(flickerAmt, 1.0));    // far lamp: dying, more often
    // switched off by day; on switch-on they stutter for a few seconds before settling
    float boot1 = lampAge < 5.0 ? mix(step(0.45, hash11(floor(lampAge * 9.0) + 3.0)), 1.0, smoothstep(2.5, 5.0, lampAge)) : 1.0;
    float boot2 = lampAge < 6.5 ? mix(step(0.55, hash11(floor(lampAge * 7.0) + 9.0)), 1.0, smoothstep(4.0, 6.5, lampAge)) : 1.0;
    f1 *= lamps * boot1;
    f2 *= lamps * boot2;
    float h1, h2;
    float L = lampLight(p, lamp1, g1, 1.0, h1) * f1 + lampLight(p, lamp2, g2, 0.45, h2) * f2;
    h1 *= f1; h2 *= f2;
    float halo = h1 + h2;
    vec3 warm = vec3(0.86, 0.66, 0.40);

    // ---------------- SKY
    float sk = clamp((p.y - HZ) / (1.0 - HZ), 0.0, 1.0);
    vec3 glow = mix(vec3(0.95, 0.58, 0.36), vec3(0.88, 0.60, 0.64), rising);      // dusk orange / dawn rose
    vec3 col = mix(DN(vec3(0.115, 0.14, 0.20), vec3(0.74, 0.82, 0.92)), DN(vec3(0.045, 0.06, 0.11), vec3(0.44, 0.60, 0.84)), pow(sk, 0.6));
    col = mix(col, vec3(0.20, 0.26, 0.46), twi * 0.38 * smoothstep(0.35, 1.0, sk));      // blue hour overhead (soft: the sky screen carries most of it)
    col = mix(col, glow, twi * 0.75 * exp(-sk * 3.0));                             // horizon glow at dawn/dusk
    // clouds: same recipe as the sky screen, thinning toward the horizon so the two monitors read as one sky
    if (p.y > HZ) {
        vec2 cp = vec2(p.x * 2.2 + time * 0.0025, p.y * 4.5 + 3.0);
        float cd = fbm(cp) * 0.75 + fbm(cp * 2.3 + vec2(time * 0.004, 0.0)) * 0.35;
        float cov = mix(0.46, 0.36, e) + 0.12 * (1.0 - smoothstep(HZ, HZ + 0.35, p.y));
        float cl = smoothstep(cov, cov + 0.18, cd);
        float band = floor(clamp((cd - cov) / 0.30, 0.0, 0.999) * 3.0) / 2.0;
        vec3 cc = mix(DN(vec3(0.085, 0.10, 0.14), vec3(0.58, 0.62, 0.68)), DN(vec3(0.15, 0.175, 0.23), vec3(0.82, 0.85, 0.89)), band);
        cc = mix(cc, glow * 1.05, twi * 0.35);
        col = mix(col, cc, smoothstep(0.0, 0.25, cl) * 0.85);
    }
    col += warm * halo * 0.5;
    // low sun: a pale disc just above the tree line around sunrise / sunset (higher sun lives on the sky screen)
    vec2 sunP = vec2(sunX * A, HZ + sunElev * 0.035);
    float sunD = length(p - sunP);
    if (sunElev > -1.5 && sunElev < 12.0) {
        col = mix(col, mix(vec3(1.0, 0.85, 0.62), vec3(0.98, 0.96, 0.90), day), smoothstep(0.034, 0.030, sunD));
        col += glow * 0.35 * exp(-sunD * 9.0) * (0.4 + twi);
    }

    // ---------------- GROUND (snow field + road)
    if (p.y < HZ) {
        float t = roadT(p.y);
        vec3 snow = mix(DN(vec3(0.15, 0.18, 0.24), vec3(0.70, 0.75, 0.81)), DN(vec3(0.30, 0.345, 0.43), vec3(0.90, 0.92, 0.95)), pow(t, 0.8));
        snow = mix(snow, snow * glow * 1.25, twi * 0.35);                           // snow takes the dawn/dusk colour
        float cx = roadCx(p.y), hw = roadHw(p.y);
        float dx = abs(p.x - cx) / max(hw, 1e-4);
        // road: slightly darker, smoother snow; edge softens through the night
        // snow lying on the road: the plough clears everything closer than itself
        float rc = roadCover;
        if (plough >= 0.0 && t > 1.0 - plough) rc = 0.0;
        float edge = mix(0.04, 0.22, rc);
        float road = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, dx);
        vec3 snowRoad = snow * mix(0.72, 0.93, rc);
        // ploughed: packed grey with two cleared lanes and a centre ridge
        vec3 bare = DN(vec3(0.085, 0.10, 0.135), vec3(0.42, 0.45, 0.50));
        float lane = smoothstep(0.10, 0.0, abs(dx - 0.5)) * 0.6 + smoothstep(0.06, 0.0, abs(dx)) * -0.35;
        bare *= 1.0 - 0.18 * lane;
        snow = mix(snow, mix(bare, snowRoad, smoothstep(0.0, 0.45, rc)), road);
        // snowbanks: lighter ridges along both edges, a bit taller as snow builds
        float bank = exp(-pow((dx - 1.12) / (0.07 + 0.05 * e), 2.0));
        snow += DN(vec3(0.05, 0.055, 0.06), vec3(0.06, 0.06, 0.06)) * bank * (0.6 + 0.6 * max(e, 1.0 - rc)) * (0.4 + t);
        // faint drift texture
        snow *= 0.94 + 0.08 * vnoise(vec2(p.x * 40.0, p.y * 140.0));
        col = snow;
    }

    // ---------------- FAR TREE LINE (fog-tinted) and NEAR SPRUCES (framing)
    float tip;
    float farT = spruces(p, HZ - 0.004, 0.032, 0.035, 0.11, 11.0, VP.x, 0.05, tip);
    if (farT > 0.5) col = mix(DN(vec3(0.07, 0.085, 0.115), vec3(0.40, 0.46, 0.48)), DN(vec3(0.16, 0.19, 0.24), vec3(0.80, 0.84, 0.88)), tip * (0.5 + 0.5 * e));
    // framing spruces, hand placed (x from the left edge / right edge, base y, height)
    const vec3 LEFT[6]  = vec3[6](vec3(0.03, 0.24, 0.66), vec3(0.11, 0.27, 0.50), vec3(0.18, 0.25, 0.72),
                                 vec3(0.27, 0.29, 0.40), vec3(0.34, 0.31, 0.27), vec3(0.075, 0.30, 0.34));
    const vec3 RIGHT[5] = vec3[5](vec3(0.03, 0.23, 0.74), vec3(0.12, 0.26, 0.56), vec3(0.20, 0.28, 0.42),
                                 vec3(0.27, 0.30, 0.30), vec3(0.085, 0.29, 0.36));
    float ntip = 0.0, nearT = 0.0;
    for (int i = 0; i < 6; i++) nearT = max(nearT, spruce(p, LEFT[i].y, LEFT[i].x, LEFT[i].z, float(i) * 5.3 + 1.0, ntip));
    for (int i = 0; i < 5; i++) nearT = max(nearT, spruce(p, RIGHT[i].y, A - RIGHT[i].x, RIGHT[i].z, float(i) * 7.9 + 2.0, ntip));
    if (nearT > 0.5) col = mix(DN(vec3(0.03, 0.035, 0.05), vec3(0.16, 0.21, 0.19)), DN(vec3(0.20, 0.23, 0.29), vec3(0.88, 0.91, 0.94)), ntip * (0.55 + 0.45 * e));

    // ---------------- FENCE (right verge, receding to the vanishing point; buried through the night)
    for (int i = 0; i < 9; i++) {
        float t = 0.18 + float(i) * 0.105;                 // depth along road
        float y = HZ - t * HZ;
        float x = roadCx(y) + roadHw(y) * 1.32 + 0.01 * t;
        float h = 0.075 * t * (1.0 - 0.55 * e);             // buried
        float w = max(px1 * 1.0, 0.007 * t);
        if (abs(p.x - x) < w * 0.5 && p.y > y && p.y < y + h) col = DN(vec3(0.05, 0.055, 0.07), vec3(0.22, 0.20, 0.19));
        float cap = px1 * (1.0 + 1.5 * e);                  // snow cap grows
        if (abs(p.x - x) < w * 0.5 + px1 * 0.5 && p.y >= y + h && p.y < y + h + cap) col = DN(vec3(0.44, 0.48, 0.56), vec3(0.93, 0.95, 0.96));
    }

    // ---------------- UTILITY POLES + WIRE
    vec2 poleB = vec2(A * 0.70, 0.25), poleT = vec2(A * 0.70 + 0.02, 0.88);          // leaning
    if (segPx(p, poleB, poleT) < 0.9) col = DN(vec3(0.04, 0.045, 0.06), vec3(0.22, 0.20, 0.19));
    vec2 armL = vec2(poleT.x - 0.05, 0.835), armR = vec2(poleT.x + 0.045, 0.842);
    if (segPx(p, armL, armR) < 0.6) col = DN(vec3(0.04, 0.045, 0.06), vec3(0.22, 0.20, 0.19));
    if (abs(p.x - (armL.x + armR.x) * 0.5) < 0.048 && p.y > 0.842 && p.y < 0.842 + px1 * (0.6 + 1.2 * e)) col = DN(vec3(0.40, 0.44, 0.52), vec3(0.93, 0.95, 0.96));
    vec2 farB = vec2(VP.x + 0.12, HZ - 0.008), farTop = vec2(VP.x + 0.124, HZ + 0.11);
    if (segPx(p, farB, farTop) < 0.6) col = DN(vec3(0.06, 0.07, 0.09), vec3(0.22, 0.20, 0.19));
    // sagging wires: near crossarm -> far pole, and near crossarm -> off-screen right
    for (int w = 0; w < 2; w++) {
        vec2 a = w == 0 ? armL : armR;
        vec2 b = w == 0 ? farTop + vec2(0.0, -0.004) : vec2(A + 0.05, 0.80);
        if (p.x > min(a.x, b.x) && p.x < max(a.x, b.x)) {
            float s = (p.x - a.x) / (b.x - a.x);
            float y = mix(a.y, b.y, s) - (w == 0 ? 0.035 : 0.05) * 4.0 * s * (1.0 - s);
            if (abs(p.y - y) < px1 * 0.5) col = DN(vec3(0.06, 0.07, 0.09), vec3(0.22, 0.20, 0.19));
        }
    }

    // ---------------- STREETLAMPS (posts, arms, heads)
    vec2 l1b = vec2(lamp1.x - 0.07, g1), l1t = vec2(lamp1.x - 0.07, lamp1.y + 0.01);
    if (segPx(p, l1b, l1t) < 0.8 || segPx(p, l1t, lamp1 + vec2(0.0, 0.006)) < 0.6) col = DN(vec3(0.05, 0.055, 0.07), vec3(0.22, 0.20, 0.19));
    vec2 l2b = vec2(lamp2.x - 0.022, g2), l2t = vec2(lamp2.x - 0.022, lamp2.y + 0.004);
    if (segPx(p, l2b, l2t) < 0.6 || segPx(p, l2t, lamp2 + vec2(0.0, 0.003)) < 0.5) col = DN(vec3(0.06, 0.065, 0.08), vec3(0.22, 0.20, 0.19));
    if (length((p - lamp1) / vec2(0.012, 0.006)) < 1.0) col = mix(DN(vec3(0.33, 0.26, 0.19), vec3(0.45, 0.46, 0.48)), vec3(0.95, 0.83, 0.62), f1);
    if (length((p - lamp2) / vec2(0.006, 0.0035)) < 1.0) col = mix(DN(vec3(0.30, 0.24, 0.18), vec3(0.45, 0.46, 0.48)), vec3(0.80, 0.64, 0.42), f2);
    if (abs(p.x - lamp1.x) < 0.012 && p.y > lamp1.y + 0.006 && p.y < lamp1.y + 0.006 + px1 * (1.0 + e)) col = DN(vec3(0.44, 0.48, 0.56), vec3(0.93, 0.95, 0.96));

    // ---------------- LAMPLIGHT on the scene (snow takes the warm light; dark shapes barely)
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    col = mix(col, col + warm * 0.55, clamp(L, 0.0, 1.0) * smoothstep(0.08, 0.30, lum));

    // ---------------- FOG (thickens with the night; warmed in lamplight; dithered by the quantizer)
    float fogH = exp(-max(0.0, p.y - HZ + 0.06) * 5.0);
    float n = vnoise(vec2(p.x * 3.0 + time * 0.006, p.y * 9.0 - time * 0.0015)) * 0.6 + vnoise(vec2(p.x * 9.0 - time * 0.01, p.y * 20.0)) * 0.4;
    float fog = fogAmt * (0.22 + 0.55 * e) * fogH * (0.55 + 0.45 * n);
    fog += fogAmt * e * 0.18 * smoothstep(0.25, 0.0, abs(p.x - roadCx(p.y))) * step(p.y, HZ);   // the road fades first
    vec3 fogCol = mix(mix(DN(vec3(0.17, 0.20, 0.26), vec3(0.84, 0.87, 0.90)), glow, twi * 0.22), warm * 0.75, clamp(L * 0.8, 0.0, 0.7));
    col = mix(col, fogCol, clamp(fog, 0.0, 0.75));

    // ---------------- PLOUGH (drawn after the fog: it is close to the camera; seen from behind, driving away up the road; amber beacon on the cab)
    float beaconGlow = 0.0;
    bool tail = false;
    vec2 beaconP = vec2(-9.0);
    if (plough >= 0.0 && plough <= 1.0) {
        float tp = 1.0 - plough;                                   // 1 at the bottom of the screen, 0 at the horizon
        float yb = HZ - tp * HZ;
        float hwp = roadHw(yb);
        float xc = roadCx(yb) + hwp * 0.22;                        // keeps to the right lane
        float wv = max(hwp * 0.72, px1 * 4.0), hv = wv * 0.78;
        float dxp = abs(p.x - xc), dyp = p.y - yb;
        if (dyp > 0.0 && dyp < hv * 0.58 && dxp < wv * 0.5) {
            col = vec3(0.80, 0.52, 0.20);                                          // body
            if (dyp < max(px1, hv * 0.12)) col = vec3(0.16, 0.13, 0.11);           // bumper
            if (dyp < hv * 0.25 && dyp > hv * 0.08 && dxp > wv * 0.5 - max(px1, wv * 0.1)) tail = true;   // tail lights
        }
        if (dyp >= hv * 0.58 && dyp < hv && dxp < wv * 0.30) {
            col = vec3(0.74, 0.48, 0.19);                                          // cab
            if (dyp > hv * 0.68 && dyp < hv * 0.92 && dxp < wv * 0.20) col = vec3(0.07, 0.08, 0.10);   // rear window
        }
        beaconP = vec2(xc, yb + hv + max(px1, hv * 0.08));
        bool on = fract(time * 1.6) < 0.5;
        if (abs(p.x - beaconP.x) < max(px1 * 0.6, wv * 0.06) && abs(p.y - beaconP.y) < max(px1 * 0.6, hv * 0.07))
            col = on ? vec3(1.0, 0.80, 0.45) : vec3(0.43, 0.33, 0.21);
        if (on) beaconGlow = exp(-length((p - beaconP) / vec2(0.09, 0.05)) * 2.2) * (1.0 - 0.7 * day);
    }
    col += vec3(0.95, 0.62, 0.25) * beaconGlow * 0.55;

    // ---------------- WIND mood: smooth offset whose slope changes like weather
    float wind = windAmt * (time * 0.8 + 70.0 * noise1(time / 75.0) + 25.0 * noise1(time / 23.0) + 140.0 * pow(noise1(time / 140.0 + 9.0), 4.0));

    // ---------------- SNOW (in pixel units; 3 layers + rare near flakes)
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
        float colH = uh(vec2(floor(sx / cs), 0.0), float(l) * 17.0 + 0.0);
        vec2 sp = vec2(sx, pp.y + time * speed * (0.6 + 0.8 * colH) + colH * 997.0);
        vec2 cell = floor(sp / cs);
        vec2 h = vec2(uh(cell, float(l) * 31.0 + 1.0), uh(cell, float(l) * 31.0 + 2.0));
        // patchy, breathing snowfall: slow drifting bands of heavier/lighter snow + intensity that swells over minutes
        float patchy = smoothstep(0.2, 0.8, vnoise(mod(cell * cs * 0.011 + vec2(time * 0.018, -time * 0.008), 512.0) + float(l) * 3.7));
        float swell = 0.5 + 0.5 * noise1(time / 70.0 + float(l) * 1.3);
        if (h.x > dens * (0.25 + 1.5 * patchy) * (0.45 + 0.75 * swell)) continue;
        vec2 c = (cell + 0.15 + 0.7 * vec2(uh(cell, float(l) * 31.0 + 3.0), uh(cell, float(l) * 31.0 + 4.0))) * cs;
        c.x += sin(time * (0.3 + 0.9 * h.y) + h.y * 40.0) * (0.3 + 1.7 * hash11(h.y * 71.0)) * (1.0 + float(l));   // each flake its own sway       // gentle sway
        float d = length(sp - c);
        if (d < size) flake = max(flake, bright * (l == 3 ? smoothstep(size, size * 0.3, d) : 1.0));
    }
    if (flake > 0.0) {
        float lit = clamp(L * 1.4, 0.0, 1.0);
        float vis = mix(mix(0.10, 1.0, lit), 0.85, day) * flake;              // almost invisible in the dark, plain by day
        vec3 fc = mix(DN(vec3(0.55, 0.60, 0.68), vec3(0.97, 0.98, 0.99)), vec3(1.0, 0.88, 0.70), lit);
        if (lit > 0.55 && uh(q + vec2(floor(time * 6.0), 0.0), 77.0) > 0.93) { fc = vec3(1.0, 0.95, 0.85); vis = 1.0; }  // sparkle
        col = mix(col, fc, vis);
    }

    fragColor = vec4(tail ? PAL_TAIL : quantize(col, q), 1.0) * qt_Opacity;
}
