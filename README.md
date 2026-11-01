# unraid-starfield

Nebula theme for the Unraid webGui (palette + Orbitron/Exo 2 from the Starfinder tracker) with a page-wide animated parallax starfield (ported from starfinder_campaign_tracker/src/fx/starfield.ts).

- Edit `starfield.js` / `nebula.css`, then `./build.sh` to produce `starfield.plg` (files inlined).
- Install: copy to `/boot/config/plugins/starfield.plg` and run `plugin install /boot/config/plugins/starfield.plg` (persists across reboots).
- Remove: Plugins page, or `plugin remove starfield.plg`.
- Hooks into every page via a `Menu="Buttons"` page (Unraid emits button pages in <head>); targets `#header`.
- Fonts (OFL) live in `fonts/`; install copies them to `/boot/config/plugins/starfield/fonts/` (the .plg copies them into emhttp at boot).
