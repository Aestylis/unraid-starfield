#!/usr/bin/env python3
"""Generate ember.css (orange/grey/black) from nebula.css by remapping its palette."""
import re, pathlib
here = pathlib.Path(__file__).parent
s = (here / 'nebula.css').read_text()
rgba = {
    (180, 140, 255): (255, 140, 47),   # accent
    (30, 18, 64): (30, 30, 30),        # panel
    (22, 14, 50): (22, 22, 22),        # panel solid
    (18, 12, 44): (20, 20, 20),        # table stripe
    (12, 8, 36): (12, 12, 12),         # nav glass
    (7, 5, 26): (8, 8, 8),             # footer / opac
    (48, 30, 96): (54, 40, 30),        # CA hover
}
def sub_rgba(m):
    k = tuple(int(x) for x in m.group(1, 2, 3))
    if k not in rgba: return m.group(0)
    r, g, b = rgba[k]
    return f'rgba({r}, {g}, {b},{m.group(4)})'
s = re.sub(r'rgba\((\d+),\s*(\d+),\s*(\d+),(\s*[0-9.]+)\)', sub_rgba, s)
hexmap = {
    '#07051a': '#0a0a0a', '#120c2c': '#161616', '#b48cff': '#ff8c2f', '#7a4dff': '#d9480f',
    '#ece6ff': '#f2ede8', '#a99fc8': '#a8a29e', '#7fd8ff': '#ffb36b', '#6f6690': '#6b6560',
    '#c9a6ff': '#ffad66', '#1d1240': '#242424', '#2a1556': '#2a1a0c', '#0c0824': '#0e0c0b',
}
for a, b in hexmap.items():
    s = s.replace(a, b)
s = s.replace('rgb(46, 28, 96)', 'rgb(42, 42, 42)').replace('rgb(9, 6, 28)', 'rgb(10, 10, 10)')
# chart series: orange stays orange, yellow -> grey, light blue -> pale orange, magenta (cpu user) -> white-ish
s = s.replace('svg [fill="#EDC240" i] { fill: #ffb36b; }', 'svg [fill="#EDC240" i] { fill: #9e9e9e; }')
s = s.replace('svg [stroke="#EDC240" i] { stroke: #ffb36b; }', 'svg [stroke="#EDC240" i] { stroke: #9e9e9e; }')
s = s.replace('#ff3df2', '#ffd2a8')
# logo is already orange: no hue shift, just the glow
s = re.sub(r'filter: hue-rotate\(250deg\) saturate\(1\.15\) ', 'filter: ', s)
s = s.replace("shift Unraid's red-orange gradient into Nebula violet", 'keep Unraid orange, add an ember glow')
s = s.replace('/* Nebula theme for the Unraid webGui, from starfinder_campaign_tracker/src/theme/tokens.css (nebula preset).',
              '/* Ember theme for the Unraid webGui (orange / grey / black), generated from nebula.css by make-ember.py.')
s = s.replace('starfield shows through', 'hex grid shows through').replace('the starfield canvas', 'the hex grid canvas')
s = s.replace('deep purple with Nebula\'s glow', 'near-black with a faint ember glow')
(here / 'ember.css').write_text(s)
left = re.findall(r'rgba\((180, 140, 255|30, 18, 64|18, 12, 44)', s) + re.findall(r'#(b48cff|7a4dff|07051a)', s)
print('ember.css written; leftover nebula colours:', left)
