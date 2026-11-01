# unraid-starfield

Animated parallax starfield in place of the Unraid header banner image (ported from starfinder_campaign_tracker/src/fx/starfield.ts).

- Edit `starfield.js` / `starfield.css`, then `./build.sh` to produce `starfield.plg` (files inlined).
- Install: copy to `/boot/config/plugins/starfield.plg` and run `plugin install /boot/config/plugins/starfield.plg` (persists across reboots).
- Remove: Plugins page, or `plugin remove starfield.plg`.
- Hooks into every page via a `Menu="Buttons"` page (Unraid emits button pages in <head>); targets `#header`.
