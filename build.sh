#!/bin/bash
# Build both theme plugins with their JS/CSS inlined:
#   starfield.plg  Nebula palette + page-wide starfield
#   hexgrid.plg    Ember palette (orange/grey/black) + animated hex grid
#   parity.plg     Array palette (Unraid brand red->orange, Unraid's own fonts) + live disk-array background
# Fonts are not inlined: Unraid downloads them from GitHub to /boot/config/plugins/<name>/fonts/ (once) and the
# install step copies them into emhttp (parity uses Unraid's bundled fonts and needs none).
# Only one theme can be installed at a time (install refuses otherwise).
THEMES="starfield hexgrid parity"
set -euo pipefail
cd "$(dirname "$0")"
GIT_URL="https://raw.githubusercontent.com/Aestylis/unraid-starfield/main"
python3 make-themes.py >/dev/null
VER=$(date +%Y.%m.%d.%H%M)

build() { # name css js page change icon fonts(yes|no)
  local name=$1 css=$2 js=$3 page=$4 change=$5 icon=$6 fonts=$7
  local others=""; for t in $THEMES; do [ "$t" != "$name" ] && others="$others $t"; done
  for f in "$css" "$js"; do
    if grep -q "]]>" "$f"; then echo "$f contains ]]>" >&2; exit 1; fi
  done
  {
  cat <<HDR
<?xml version='1.0' standalone='yes'?>
<!DOCTYPE PLUGIN [
<!ENTITY name "$name">
<!ENTITY version "$VER">
<!ENTITY emhttp "/usr/local/emhttp/plugins/&name;">
<!ENTITY gitURL "$GIT_URL">
<!ENTITY pluginURL "&gitURL;/&name;.plg">
]>
<PLUGIN name="&name;" author="Aestylis" version="&version;" min="7.3.0" icon="$icon" pluginURL="&pluginURL;" support="https://github.com/Aestylis/unraid-starfield/issues">
<CHANGES>
###&version;
- $change
</CHANGES>
<FILE Run="/bin/bash">
<INLINE>
for t in$others; do
  if [ -d /usr/local/emhttp/plugins/\$t ]; then
    echo "The \$t theme plugin is installed. Remove it first: only one of ${THEMES// //} can be active."
    exit 1
  fi
done
</INLINE>
</FILE>
HDR
  if [ "$fonts" = yes ]; then cat <<FONTS
<FILE Name="/boot/config/plugins/&name;/fonts/exo-2-latin-400-normal.woff2">
<URL>&gitURL;/fonts/exo-2-latin-400-normal.woff2</URL>
<MD5>bc006d0366eafacfa60e11d6fbf480a9</MD5>
</FILE>
<FILE Name="/boot/config/plugins/&name;/fonts/exo-2-latin-600-normal.woff2">
<URL>&gitURL;/fonts/exo-2-latin-600-normal.woff2</URL>
<MD5>e5f13258dcb3c76874ea7c7388e00b27</MD5>
</FILE>
<FILE Name="/boot/config/plugins/&name;/fonts/orbitron-latin-500-normal.woff2">
<URL>&gitURL;/fonts/orbitron-latin-500-normal.woff2</URL>
<MD5>1967d90b0a095e7bab678006d8e1492d</MD5>
</FILE>
<FILE Name="/boot/config/plugins/&name;/fonts/orbitron-latin-700-normal.woff2">
<URL>&gitURL;/fonts/orbitron-latin-700-normal.woff2</URL>
<MD5>42434321bd798551eb8f4873f76e6b43</MD5>
</FILE>
FONTS
  fi
  cat <<HDR2
<FILE Name="&emhttp;/$page">
<INLINE>
<![CDATA[
Menu="Buttons:199"
Link="nav-starfield"
---
<link type="text/css" rel="stylesheet" href="<?autov('/plugins/$name/$css')?>">
<script src="<?autov('/plugins/$name/$js')?>"></script>
]]>
</INLINE>
</FILE>
<FILE Name="&emhttp;/$css">
<INLINE>
<![CDATA[
HDR2
  cat "$css"
  cat <<MID
]]>
</INLINE>
</FILE>
<FILE Name="&emhttp;/$js">
<INLINE>
<![CDATA[
MID
  cat "$js"
  cat <<FTR
]]>
</INLINE>
</FILE>
<FILE Run="/bin/bash">
<INLINE>
mkdir -p /usr/local/emhttp/plugins/$name/fonts
cp /boot/config/plugins/$name/fonts/*.woff2 /usr/local/emhttp/plugins/$name/fonts/ 2>/dev/null
chmod -R a+rX /usr/local/emhttp/plugins/$name
echo "$name: \$(ls /usr/local/emhttp/plugins/$name/fonts | wc -l) fonts installed"
</INLINE>
</FILE>
<FILE Run="/bin/bash" Method="remove">
<INLINE>
# fonts on the flash are kept so a reinstall works
rm -rf /usr/local/emhttp/plugins/$name
echo "$name removed"
</INLINE>
</FILE>
</PLUGIN>
FTR
  } > "$name.plg"
  xmllint --noout "$name.plg"
  echo "built $name.plg v$VER"
}

build starfield nebula.css starfield.js StarfieldHeader.page "Nebula theme (violet, Orbitron/Exo 2) with a page-wide animated starfield" star yes
build hexgrid ember.css hexgrid.js HexgridHeader.page "Ember theme (orange/grey/black, Orbitron/Exo 2) with an animated hex grid background" th yes
build parity array.css parity.js ParityHeader.page "Array theme (Unraid brand red/orange, Unraid fonts) with a live disk-array background" hdd-o no
