# unraid-starfield

Two full Unraid webGui reskins (install only one at a time):

| plugin | palette | background |
|---|---|---|
| `starfield.plg` | Nebula (violet; from starfinder_campaign_tracker tokens.css) | drifting parallax starfield, cursor pushes stars |
| `hexgrid.plg` | Ember (orange / grey / black) | hex grid with a drifting black→grey→orange gradient; neighbouring hexes randomly slide past each other and swap; cursor warms hexes |

- Edit `nebula.css` (Ember is generated from it by `make-ember.py`), `starfield.js`, `hexgrid.js`; run `./build.sh` to produce both `.plg` files (CSS/JS inlined).
- Fonts (Orbitron, Exo 2; OFL) live in `fonts/`; copy to `/boot/config/plugins/<name>/fonts/` on the flash. Install copies them into emhttp; remove keeps them.
- Install: copy `<name>.plg` to `/boot/config/plugins/` and `plugin install /boot/config/plugins/<name>.plg`. Switch themes: `plugin remove` the other one first.
- Quick iteration without reinstalling: scp the CSS/JS straight into `/usr/local/emhttp/plugins/<name>/` (and the rebuilt plg to the flash so it survives reboot).
- Hooks into every page via a `Menu="Buttons"` page (Unraid emits button pages in `<head>`).
