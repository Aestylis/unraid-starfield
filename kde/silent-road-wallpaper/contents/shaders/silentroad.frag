#version 440
// Silent County Road — procedural pixel-art winter night (Plasma 6 wallpaper).
// One pass: every screen pixel is snapped to a coarse pixel grid, the scene is evaluated analytically at that grid
// pixel, then ordered-dithered into a fixed 16-colour palette. No textures, no CPU-side state:
//   SCENE  sky, tree lines, road + snowbanks, poles, wire, streetlamps, fence (static, from fixed layout + hashes)
//   LIGHT  two warm lamp pools / cones / halos
//   FOG    slow value-noise fog, thickest near the horizon, warmed inside lamplight
//   SNOW   hash-generated flakes in 3 depth layers + rare near flakes; nearly invisible unless lamp-lit
//   WIND   slow "moods" from layered low-frequency noise (calm / drift / whisper gust)
//   WINTER `erosion` (0..1, driven by the real clock) thickens fog, softens the road edge, buries the fence,
//          and grows snow caps — the road slowly disappears through the night.
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
float noise1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
float bayer4(vec2 q) {
    int x = int(mod(q.x, 4.0)), y = int(mod(q.y, 4.0));
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

// 16-colour palette: cold night blues/greys + muted amber
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
    float h1, h2;
    float L = lampLight(p, lamp1, g1, 1.0, h1) + lampLight(p, lamp2, g2, 0.45, h2);
    float halo = h1 + h2;
    vec3 warm = vec3(0.86, 0.66, 0.40);

    // ---------------- SKY
    float sk = clamp((p.y - HZ) / (1.0 - HZ), 0.0, 1.0);
    vec3 col = mix(vec3(0.115, 0.14, 0.19), vec3(0.04, 0.05, 0.075), pow(sk, 0.6));
    col += warm * halo * 0.5;

    // ---------------- GROUND (snow field + road)
    if (p.y < HZ) {
        float t = roadT(p.y);
        vec3 snow = mix(vec3(0.15, 0.18, 0.24), vec3(0.30, 0.345, 0.43), pow(t, 0.8));
        float cx = roadCx(p.y), hw = roadHw(p.y);
        float dx = abs(p.x - cx) / max(hw, 1e-4);
        // road: slightly darker, smoother snow; edge softens through the night
        float edge = mix(0.04, 0.22, e);
        float road = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, dx);
        snow = mix(snow, snow * mix(0.72, 0.93, e), road);
        // snowbanks: lighter ridges along both edges, a bit taller as snow builds
        float bank = exp(-pow((dx - 1.12) / (0.07 + 0.05 * e), 2.0));
        snow += vec3(0.05, 0.055, 0.06) * bank * (0.6 + 0.6 * e) * (0.4 + t);
        // faint drift texture
        snow *= 0.94 + 0.08 * vnoise(vec2(p.x * 40.0, p.y * 140.0));
        col = snow;
    }

    // ---------------- FAR TREE LINE (fog-tinted) and NEAR SPRUCES (framing)
    float tip;
    float farT = spruces(p, HZ - 0.004, 0.032, 0.035, 0.11, 11.0, VP.x, 0.05, tip);
    if (farT > 0.5) col = mix(vec3(0.07, 0.085, 0.115), vec3(0.16, 0.19, 0.24), tip * (0.5 + 0.5 * e));
    // framing spruces, hand placed (x from the left edge / right edge, base y, height)
    const vec3 LEFT[6]  = vec3[6](vec3(0.03, 0.24, 0.66), vec3(0.11, 0.27, 0.50), vec3(0.18, 0.25, 0.72),
                                 vec3(0.27, 0.29, 0.40), vec3(0.34, 0.31, 0.27), vec3(0.075, 0.30, 0.34));
    const vec3 RIGHT[5] = vec3[5](vec3(0.03, 0.23, 0.74), vec3(0.12, 0.26, 0.56), vec3(0.20, 0.28, 0.42),
                                 vec3(0.27, 0.30, 0.30), vec3(0.085, 0.29, 0.36));
    float ntip = 0.0, nearT = 0.0;
    for (int i = 0; i < 6; i++) nearT = max(nearT, spruce(p, LEFT[i].y, LEFT[i].x, LEFT[i].z, float(i) * 5.3 + 1.0, ntip));
    for (int i = 0; i < 5; i++) nearT = max(nearT, spruce(p, RIGHT[i].y, A - RIGHT[i].x, RIGHT[i].z, float(i) * 7.9 + 2.0, ntip));
    if (nearT > 0.5) col = mix(vec3(0.03, 0.035, 0.05), vec3(0.20, 0.23, 0.29), ntip * (0.55 + 0.45 * e));

    // ---------------- FENCE (right verge, receding to the vanishing point; buried through the night)
    for (int i = 0; i < 9; i++) {
        float t = 0.18 + float(i) * 0.105;                 // depth along road
        float y = HZ - t * HZ;
        float x = roadCx(y) + roadHw(y) * 1.32 + 0.01 * t;
        float h = 0.075 * t * (1.0 - 0.55 * e);             // buried
        float w = max(px1 * 1.0, 0.007 * t);
        if (abs(p.x - x) < w * 0.5 && p.y > y && p.y < y + h) col = vec3(0.05, 0.055, 0.07);
        float cap = px1 * (1.0 + 1.5 * e);                  // snow cap grows
        if (abs(p.x - x) < w * 0.5 + px1 * 0.5 && p.y >= y + h && p.y < y + h + cap) col = vec3(0.44, 0.48, 0.56);
    }

    // ---------------- UTILITY POLES + WIRE
    vec2 poleB = vec2(A * 0.70, 0.25), poleT = vec2(A * 0.70 + 0.02, 0.88);          // leaning
    if (segPx(p, poleB, poleT) < 0.9) col = vec3(0.04, 0.045, 0.06);
    vec2 armL = vec2(poleT.x - 0.05, 0.835), armR = vec2(poleT.x + 0.045, 0.842);
    if (segPx(p, armL, armR) < 0.6) col = vec3(0.04, 0.045, 0.06);
    if (abs(p.x - (armL.x + armR.x) * 0.5) < 0.048 && p.y > 0.842 && p.y < 0.842 + px1 * (0.6 + 1.2 * e)) col = vec3(0.40, 0.44, 0.52);
    vec2 farB = vec2(VP.x + 0.12, HZ - 0.008), farTop = vec2(VP.x + 0.124, HZ + 0.11);
    if (segPx(p, farB, farTop) < 0.6) col = vec3(0.06, 0.07, 0.09);
    // sagging wires: near crossarm -> far pole, and near crossarm -> off-screen right
    for (int w = 0; w < 2; w++) {
        vec2 a = w == 0 ? armL : armR;
        vec2 b = w == 0 ? farTop + vec2(0.0, -0.004) : vec2(A + 0.05, 0.80);
        if (p.x > min(a.x, b.x) && p.x < max(a.x, b.x)) {
            float s = (p.x - a.x) / (b.x - a.x);
            float y = mix(a.y, b.y, s) - (w == 0 ? 0.035 : 0.05) * 4.0 * s * (1.0 - s);
            if (abs(p.y - y) < px1 * 0.5) col = vec3(0.06, 0.07, 0.09);
        }
    }

    // ---------------- STREETLAMPS (posts, arms, heads)
    vec2 l1b = vec2(lamp1.x - 0.07, g1), l1t = vec2(lamp1.x - 0.07, lamp1.y + 0.01);
    if (segPx(p, l1b, l1t) < 0.8 || segPx(p, l1t, lamp1 + vec2(0.0, 0.006)) < 0.6) col = vec3(0.05, 0.055, 0.07);
    vec2 l2b = vec2(lamp2.x - 0.022, g2), l2t = vec2(lamp2.x - 0.022, lamp2.y + 0.004);
    if (segPx(p, l2b, l2t) < 0.6 || segPx(p, l2t, lamp2 + vec2(0.0, 0.003)) < 0.5) col = vec3(0.06, 0.065, 0.08);
    if (length((p - lamp1) / vec2(0.012, 0.006)) < 1.0) col = vec3(0.95, 0.83, 0.62);
    if (length((p - lamp2) / vec2(0.006, 0.0035)) < 1.0) col = vec3(0.80, 0.64, 0.42);
    if (abs(p.x - lamp1.x) < 0.012 && p.y > lamp1.y + 0.006 && p.y < lamp1.y + 0.006 + px1 * (1.0 + e)) col = vec3(0.44, 0.48, 0.56);

    // ---------------- LAMPLIGHT on the scene (snow takes the warm light; dark shapes barely)
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    col = mix(col, col + warm * 0.55, clamp(L, 0.0, 1.0) * smoothstep(0.08, 0.30, lum));

    // ---------------- FOG (thickens with the night; warmed in lamplight; dithered by the quantizer)
    float fogH = exp(-max(0.0, p.y - HZ + 0.06) * 5.0);
    float n = vnoise(vec2(p.x * 3.0 + time * 0.006, p.y * 9.0 - time * 0.0015)) * 0.6 + vnoise(vec2(p.x * 9.0 - time * 0.01, p.y * 20.0)) * 0.4;
    float fog = fogAmt * (0.22 + 0.55 * e) * fogH * (0.55 + 0.45 * n);
    fog += fogAmt * e * 0.18 * smoothstep(0.25, 0.0, abs(p.x - roadCx(p.y))) * step(p.y, HZ);   // the road fades first
    vec3 fogCol = mix(vec3(0.17, 0.20, 0.26), warm * 0.75, clamp(L * 0.8, 0.0, 0.7));
    col = mix(col, fogCol, clamp(fog, 0.0, 0.75));

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
        vec2 sp = pp + vec2(-wind * wm, time * speed);
        vec2 cell = floor(sp / cs);
        vec2 h = hash22(cell + float(l) * 31.7);
        if (h.x > dens) continue;
        vec2 c = (cell + 0.15 + 0.7 * hash22(cell * 1.37 + float(l))) * cs;
        c.x += sin(time * (0.4 + h.y) + h.y * 40.0) * (1.0 + float(l));       // gentle sway
        float d = length(sp - c);
        if (d < size) flake = max(flake, bright * (l == 3 ? smoothstep(size, size * 0.3, d) : 1.0));
    }
    if (flake > 0.0) {
        float lit = clamp(L * 1.4, 0.0, 1.0);
        float vis = mix(0.10, 1.0, lit) * flake;                               // almost invisible in the dark
        vec3 fc = mix(vec3(0.55, 0.60, 0.68), vec3(1.0, 0.88, 0.70), lit);
        if (lit > 0.55 && hash21(q + floor(time * 6.0)) > 0.93) { fc = vec3(1.0, 0.95, 0.85); vis = 1.0; }  // sparkle
        col = mix(col, fc, vis);
    }

    fragColor = vec4(quantize(col, q), 1.0) * qt_Opacity;
}
