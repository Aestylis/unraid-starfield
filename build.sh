#!/bin/bash
# Assemble starfield.plg with the JS/CSS inlined.
set -euo pipefail
cd "$(dirname "$0")"
VER=$(date +%Y.%m.%d.%H%M)
{
cat <<HDR
<?xml version='1.0' standalone='yes'?>
<!DOCTYPE PLUGIN [
<!ENTITY name "starfield">
<!ENTITY version "$VER">
<!ENTITY emhttp "/usr/local/emhttp/plugins/&name;">
]>
<PLUGIN name="&name;" author="quentin" version="&version;" min="7.0.0" icon="star">
<CHANGES>
###&version;
- Nebula theme (Starfinder tracker palette, Orbitron/Exo 2) with a page-wide animated starfield
</CHANGES>
<FILE Name="&emhttp;/StarfieldHeader.page">
<INLINE>
<![CDATA[
Menu="Buttons:199"
Link="nav-starfield"
---
<link type="text/css" rel="stylesheet" href="<?autov('/plugins/starfield/nebula.css')?>">
<script src="<?autov('/plugins/starfield/starfield.js')?>"></script>
]]>
</INLINE>
</FILE>
<FILE Name="&emhttp;/nebula.css">
<INLINE>
<![CDATA[
HDR
cat nebula.css
cat <<MID
]]>
</INLINE>
</FILE>
<FILE Name="&emhttp;/starfield.js">
<INLINE>
<![CDATA[
MID
cat starfield.js
cat <<'FTR'
]]>
</INLINE>
</FILE>
<FILE Run="/bin/bash">
<INLINE>
mkdir -p /usr/local/emhttp/plugins/starfield/fonts
cp /boot/config/plugins/starfield/fonts/*.woff2 /usr/local/emhttp/plugins/starfield/fonts/ 2>/dev/null
chmod -R a+rX /usr/local/emhttp/plugins/starfield
rm -f /usr/local/emhttp/plugins/starfield/starfield.css
echo "starfield: $(ls /usr/local/emhttp/plugins/starfield/fonts | wc -l) fonts installed"
</INLINE>
</FILE>
<FILE Run="/bin/bash" Method="remove">
<INLINE>
rm -rf /usr/local/emhttp/plugins/starfield /boot/config/plugins/starfield
echo "starfield removed"
</INLINE>
</FILE>
</PLUGIN>
FTR
} > starfield.plg
grep -c "]]>" starfield.js nebula.css || true
echo "built starfield.plg v$VER"
