# Starfield, Hexgrid & Parity — animated themes for Unraid

Three full webGui reskins for Unraid 7.3+, each with a live animated background behind every page.

| | **Starfield** (Nebula) | **Hexgrid** (Ember) | **Parity** (Array) |
|---|---|---|---|
| Palette | deep purple, violet accent | black, grey, orange | Unraid brand red → orange on charcoal |
| Background | three-layer parallax starfield drifting left; stars twinkle and scatter away from the cursor | hex grid under a drifting black→grey→orange gradient; neighbouring hexes randomly slide past each other and swap places; hexes warm up under the cursor | **live circuit board**: data enters at a network connector on the left, runs through a controller chip and out along copper traces to one chip per disk (parity, data, pools) on the right; writes travel as packets left→right and reads right→left at the disk's real rate, active traces glow, chips show real usage / spin-down; hover a chip for read/write speed, usage and temperature |
| Fonts | Orbitron (headings, nav) + Exo 2 (body) | same | Unraid's own bitstream (labels) + clear-sans (body) |
| Panels | chamfered glass | chamfered glass | square, red→orange gradient accent bars |

<!-- screenshots: add screenshots/nebula-*.png and screenshots/ember-*.png (blur IPs, serials and share names first) -->

Restyled: header (banner image replaced by the animation), nav bar, section title bars (chamfered glass panels), all tables
(including Plugins, Docker, Unassigned Devices), buttons, inputs, tabs, toggle switches, dialogs, tooltips, the footer,
Community Apps cards, and the System Stats charts. Status colours (green/red disk indicators) are left alone on purpose.

## Install

Plugins → Install Plugin, paste one of:

```
https://raw.githubusercontent.com/Aestylis/unraid-starfield/main/starfield.plg
https://raw.githubusercontent.com/Aestylis/unraid-starfield/main/hexgrid.plg
https://raw.githubusercontent.com/Aestylis/unraid-starfield/main/parity.plg
```

then hard-refresh the browser (Ctrl+Shift+R). **Only one can be installed at a time** — the installer refuses if another
is present; remove it before installing a different one. Removing a plugin restores the stock look (your banner image
and Display Settings are never touched).

## Performance

Canvas 2D, redrawn at ~24 fps (full rate only while the cursor is interacting), paused automatically in background tabs.
With *prefers-reduced-motion* set, a single still frame is drawn.

## Compatibility

- Built and tested on Unraid **7.3.4** with the **black** base theme and the top navigation layout.
- Other base themes (white / azure / gray) and the sidebar layout should mostly work since the theme overrides Unraid's
  colour variables, but are untested — issues and screenshots welcome.
- Unraid updates can rename page elements; if the animation or some colours disappear after an update, open an issue.
- The Nebula theme hue-shifts the Unraid logo to violet; Ember and Array leave it as-is.

## How it works

Each plugin installs a `Menu="Buttons"` page, which Unraid includes in the `<head>` of every webGui page. It loads one
stylesheet (overriding Unraid's CSS variables, plus a few targeted rules) and one script that inserts a fixed
`<canvas>` behind the page. No core files are modified. The Parity theme also installs `parity-stats.php`, a read-only JSON endpoint (behind the normal webGui login) that reports per-disk read/write rates from `diskload.ini`, usage/spin-down/temperature from `disks.ini`, and network throughput; the page polls it every 2 s only while the tab is visible.

## Building

Edit `nebula.css`, `starfield.js`, `hexgrid.js` and `parity.js` (the Ember and Array stylesheets are generated from `nebula.css` by
`make-themes.py`), then run `./build.sh` to produce all three `.plg` files with the CSS/JS inlined. Bump happens
automatically (date-based version).

## Credits & licences

- Code: MIT, © Aestylis. The starfield is ported from the author's own projects.
- Fonts: [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Exo 2](https://fonts.google.com/specimen/Exo+2),
  SIL Open Font License 1.1 (see `fonts/OFL-*.txt`), via Fontsource.
- Not affiliated with or endorsed by Lime Technology. Unraid is a trademark of Lime Technology, Inc.
