#version 440
// Hexgrid (Ember) wallpaper: every pixel finds its hex, then colours it from the drifting gradient field + the hex's
// tile tint (sampled from a cols x rows texture). Up to 6 swaps are drawn as two shrunken hexes sliding past each other
// over dark empty sockets. Coordinates are in item units, matching the original canvas implementation.
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;      // seconds
    float hexR;      // circumradius
    vec2 res;        // item size
    vec2 grid;       // cols, rows
    vec4 swapPos0; vec4 swapInf0;
    vec4 swapPos1; vec4 swapInf1;
    vec4 swapPos2; vec4 swapInf2;
    vec4 swapPos3; vec4 swapInf3;
    vec4 swapPos4; vec4 swapInf4;
    vec4 swapPos5; vec4 swapInf5;
};
layout(binding = 1) uniform sampler2D tints;

const float S3 = 1.7320508;
const float GAP = 1.6;
const vec3 BG = vec3(5.0) / 255.0;
const vec3 SOCKET = vec3(11.0) / 255.0;

vec3 grad(float v) {
    v = clamp(v, 0.0, 1.0);
    vec3 c0 = vec3(10.0) / 255.0, c1 = vec3(30.0) / 255.0, c2 = vec3(58.0, 56.0, 54.0) / 255.0;
    vec3 c3 = vec3(128.0, 62.0, 18.0) / 255.0, c4 = vec3(255.0, 140.0, 47.0) / 255.0;
    if (v < 0.42) return mix(c0, c1, v / 0.42);
    if (v < 0.66) return mix(c1, c2, (v - 0.42) / 0.24);
    if (v < 0.84) return mix(c2, c3, (v - 0.66) / 0.18);
    return mix(c3, c4, (v - 0.84) / 0.16);
}
float field(vec2 p) {
    float v = 0.5 + 0.28 * sin(p.x * 0.0042 + time * 0.22 + sin(p.y * 0.003 + time * 0.09) * 1.6)
                  + 0.22 * sin(p.y * 0.0058 - time * 0.17 + p.x * 0.0013);
    return pow(clamp(v, 0.0, 1.0), 1.5);
}
vec2 centerOf(vec2 cr) {
    float hw = S3 * hexR, vh = 1.5 * hexR;
    return vec2((cr.x - 0.5) * hw + (mod(cr.y, 2.0) > 0.5 ? hw * 0.5 : 0.0), (cr.y - 0.5) * vh);
}
// "hex radius" of an offset from a pointy-top hex centre: equals the inradius on the edge
float hexD(vec2 d) { d = abs(d); return max(d.x, 0.5 * d.x + 0.8660254 * d.y); }
float tintAt(vec2 cr) { return texture(tints, (cr + 0.5) / grid).r; }
float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }

// paint one moving hex of a swap over col
vec3 mover(vec3 col, vec2 p, vec2 from, vec2 to, float t, float tint, float sgn, float edge) {
    float e = ease(t), lift = sin(3.14159265 * t), sc = 1.0 - 0.18 * lift;
    vec2 pos = from + (to - from) * e + vec2(-(to.y - from.y), to.x - from.x) * 0.18 * lift * sgn;
    float a = smoothstep(edge * sc + 0.7, edge * sc - 0.7, hexD(p - pos));
    return mix(col, grad(0.68 * field(pos) + 0.32 * tint + 0.11 * lift), a);
}
vec3 swapLayer(vec3 col, vec2 p, vec2 ctr, float baseA, vec4 pos, vec4 inf, float edge) {
    if (inf.w < 0.5) return col;
    // this pixel's own hex is one of the two sockets
    if (distance(ctr, pos.xy) < 1.0 || distance(ctr, pos.zw) < 1.0) col = mix(BG, SOCKET, baseA);
    col = mover(col, p, pos.xy, pos.zw, inf.x, inf.y, 1.0, edge);
    col = mover(col, p, pos.zw, pos.xy, inf.x, inf.z, -1.0, edge);
    return col;
}

void main() {
    vec2 p = qt_TexCoord0 * res;
    float hw = S3 * hexR, vh = 1.5 * hexR;
    float r0 = floor(p.y / vh + 0.5);
    vec2 best = vec2(0.0); vec2 bestC = vec2(0.0); float bd = 1e9;
    for (int dr = -1; dr <= 1; dr++) {
        float r = r0 + float(dr);
        float off = mod(r, 2.0) > 0.5 ? hw * 0.5 : 0.0;
        float c0 = floor((p.x - off) / hw + 0.5);
        for (int dc = -1; dc <= 1; dc++) {
            vec2 cr = vec2(c0 + float(dc), r);
            vec2 c = centerOf(cr);
            float d = dot(p - c, p - c);
            if (d < bd) { bd = d; best = cr; bestC = c; }
        }
    }
    float edge = (hexR - GAP * 0.5) * 0.8660254;
    float baseA = smoothstep(edge + 0.7, edge - 0.7, hexD(p - bestC));
    vec3 col = mix(BG, grad(0.68 * field(bestC) + 0.32 * tintAt(best)), baseA);
    col = swapLayer(col, p, bestC, baseA, swapPos0, swapInf0, edge);
    col = swapLayer(col, p, bestC, baseA, swapPos1, swapInf1, edge);
    col = swapLayer(col, p, bestC, baseA, swapPos2, swapInf2, edge);
    col = swapLayer(col, p, bestC, baseA, swapPos3, swapInf3, edge);
    col = swapLayer(col, p, bestC, baseA, swapPos4, swapInf4, edge);
    col = swapLayer(col, p, bestC, baseA, swapPos5, swapInf5, edge);
    fragColor = vec4(col, 1.0) * qt_Opacity;
}
