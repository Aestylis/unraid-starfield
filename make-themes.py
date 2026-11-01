#!/usr/bin/env python3
"""Generate the derived theme stylesheets from nebula.css by remapping its palette.
  ember.css  orange / grey / black  (hexgrid plugin)
  array.css  Unraid brand red->orange on charcoal, Unraid's own fonts, square panels  (parity plugin)
"""
import re, pathlib
here = pathlib.Path(__file__).parent
BASE = (here / 'nebula.css').read_text()

def remap(s, rgba, hexmap, rgb):
    def sub(m):
        k = tuple(int(x) for x in m.group(1, 2, 3))
        if k not in rgba: return m.group(0)
        r, g, b = rgba[k]
        return f'rgba({r}, {g}, {b},{m.group(4)})'
    s = re.sub(r'rgba\((\d+),\s*(\d+),\s*(\d+),(\s*[0-9.]+)\)', sub, s)
    for a, b in hexmap.items(): s = s.replace(a, b)
    for a, b in rgb.items(): s = s.replace(a, b)
    return s

def check(name, s):
    left = re.findall(r'rgba\((180, 140, 255|30, 18, 64|18, 12, 44)', s) + re.findall(r'#(b48cff|7a4dff|07051a)', s)
    assert not left, f'{name}: leftover nebula colours {left}'
    (here / name).write_text(s)

def chart(s, yellow, magenta):
    s = re.sub(r'(svg \[fill="#EDC240" i\] \{ fill: )[^;]+;', r'\g<1>' + yellow + ';', s)
    s = re.sub(r'(svg \[stroke="#EDC240" i\] \{ stroke: )[^;]+;', r'\g<1>' + yellow + ';', s)
    return s.replace('#ff3df2', magenta)

def no_logo_shift(s, why):
    s = re.sub(r'filter: hue-rotate\(250deg\) saturate\(1\.15\) ', 'filter: ', s)
    return s.replace("shift Unraid's red-orange gradient into Nebula violet", why)

# ---------------------------------------------------------------- ember
s = remap(BASE,
    {(180, 140, 255): (255, 140, 47), (30, 18, 64): (30, 30, 30), (22, 14, 50): (22, 22, 22), (18, 12, 44): (20, 20, 20),
     (12, 8, 36): (12, 12, 12), (7, 5, 26): (8, 8, 8), (48, 30, 96): (54, 40, 30)},
    {'#07051a': '#0a0a0a', '#120c2c': '#161616', '#b48cff': '#ff8c2f', '#7a4dff': '#d9480f', '#ece6ff': '#f2ede8',
     '#a99fc8': '#a8a29e', '#7fd8ff': '#ffb36b', '#6f6690': '#6b6560', '#c9a6ff': '#ffad66', '#1d1240': '#242424',
     '#2a1556': '#2a1a0c', '#0c0824': '#0e0c0b'},
    {'rgb(46, 28, 96)': 'rgb(42, 42, 42)', 'rgb(9, 6, 28)': 'rgb(10, 10, 10)'})
s = chart(s, '#9e9e9e', '#ffd2a8')
s = no_logo_shift(s, 'keep Unraid orange, add an ember glow')
s = s.replace('/* Nebula theme for the Unraid webGui, from starfinder_campaign_tracker/src/theme/tokens.css (nebula preset).',
              '/* Ember theme for the Unraid webGui (orange / grey / black), generated from nebula.css by make-themes.py.')
s = s.replace('starfield shows through', 'hex grid shows through').replace('the starfield canvas', 'the hex grid canvas')
s = s.replace("deep purple with Nebula's glow", 'near-black with a faint ember glow')
check('ember.css', s)

# ---------------------------------------------------------------- array (Unraid brand)
s = remap(BASE,
    {(180, 140, 255): (255, 140, 47), (30, 18, 64): (24, 24, 26), (22, 14, 50): (20, 20, 22), (18, 12, 44): (22, 22, 24),
     (12, 8, 36): (14, 14, 16), (7, 5, 26): (10, 10, 12), (48, 30, 96): (52, 26, 22)},
    {'#07051a': '#0b0b0c', '#120c2c': '#151517', '#b48cff': '#ff8c2f', '#7a4dff': '#e22828', '#ece6ff': '#f2f2f2',
     '#a99fc8': '#9e9e9e', '#7fd8ff': '#ffa463', '#6f6690': '#666666', '#c9a6ff': '#ffad66', '#1d1240': '#202022',
     '#2a1556': '#2a0e0e', '#0c0824': '#0f0d0d'},
    {'rgb(46, 28, 96)': 'rgb(34, 34, 36)', 'rgb(9, 6, 28)': 'rgb(12, 12, 12)'})
s = chart(s, '#e22828', '#f2f2f2')
s = no_logo_shift(s, 'keep the Unraid logo as-is, with a red-orange glow')
s = s.replace('rgba(255, 140, 47, 0.45));\n}', 'rgba(226, 40, 40, 0.5));\n}', 1) if 'drop-shadow(0 0 6px rgba(255, 140, 47, 0.45))' in s else s
# Unraid's own bundled fonts: no downloads
s = re.sub(r"@font-face \{[^}]*\}\n", '', s)
s = s.replace("--nb-font-display: 'Orbitron', sans-serif;", "--nb-font-display: bitstream, monospace;")
s = s.replace("--nb-font-body: 'Exo 2', sans-serif;", "--nb-font-body: clear-sans, sans-serif;")
s = s.replace('/* Nebula theme for the Unraid webGui, from starfinder_campaign_tracker/src/theme/tokens.css (nebula preset).',
              '/* Array theme for the Unraid webGui: Unraid brand red (#e22828) -> orange (#ff8c2f) on charcoal, Unraid\'s own fonts,\n * generated from nebula.css by make-themes.py.')
s = s.replace('starfield shows through', 'disk array shows through').replace('the starfield canvas', 'the disk array canvas')
s = s.replace("deep purple with Nebula's glow", 'charcoal with a faint red glow')
s += '''
/* ---- Array: Unraid-style structure (square panels, red->orange gradient accents) ---- */
html:root { --ar-gradient: linear-gradient(90deg, #e22828, #ff8c2f); }
div.title {
  clip-path: none;
  outline: none;
  border-left: 3px solid #e22828;
  border-image: linear-gradient(180deg, #e22828, #ff8c2f) 1;
  background-image: linear-gradient(90deg, rgba(226, 40, 40, 0.16), rgba(24, 24, 26, 0) 45%);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 1.15rem;
  text-shadow: 0 0 10px rgba(226, 40, 40, 0.45);
}
.nav-tile { font-size: 1.15rem; letter-spacing: 0.1em; }
.nav-tile .nav-item.active a {
  box-shadow: none;
  background: var(--ar-gradient) left bottom / 100% 2px no-repeat;
}
.nav-tile .nav-item a:hover, .nav-tile .nav-item.active a { text-shadow: 0 0 10px rgba(255, 140, 47, 0.5); }
.tabs button[role="tab"][aria-selected="true"] { border-image: var(--ar-gradient) 1; }
.usage-bar > span:not(.orange):not(.red):not(.redbar):not(.orangebar) { background-image: var(--ar-gradient); }
input[type="button"]:hover, input[type="reset"]:hover, input[type="submit"]:hover,
button:not([role="tab"]):hover, a.button:hover { box-shadow: 0 0 12px rgba(226, 40, 40, 0.5); }
'''
check('array.css', s)
print('ember.css, array.css written')
