#!/bin/bash
# Build both theme plugins with their JS/CSS inlined:
#   starfield.plg  Nebula palette + page-wide starfield
#   hexgrid.plg    Ember palette (orange/grey/black) + animated hex grid
# Fonts are not inlined: they live on the flash at /boot/config/plugins/<name>/fonts/ and are copied in at install.
# Only one of the two should be installed at a time.
set -euo pipefail
cd "$(dirname "$0")"
python3 make-ember.py >/dev/null
VER=$(date +%Y.%m.%d.%H%M)

build() { # name css js page change
  local name=$1 css=$2 js=$3 page=$4 change=$5
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
]>
<PLUGIN name="&name;" author="quentin" version="&version;" min="7.0.0" icon="star">
<CHANGES>
###&version;
- $change
</CHANGES>
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
HDR
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

build starfield nebula.css starfield.js StarfieldHeader.page "Nebula theme (Starfinder tracker palette, Orbitron/Exo 2) with a page-wide animated starfield"
build hexgrid ember.css hexgrid.js HexgridHeader.page "Ember theme (orange/grey/black, Orbitron/Exo 2) with an animated hex grid background"
