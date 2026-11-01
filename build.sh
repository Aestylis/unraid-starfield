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
- Animated starfield in place of the header banner image
</CHANGES>
<FILE Name="&emhttp;/StarfieldHeader.page">
<INLINE>
<![CDATA[
Menu="Buttons:199"
Link="nav-starfield"
---
<link type="text/css" rel="stylesheet" href="<?autov('/plugins/starfield/starfield.css')?>">
<script src="<?autov('/plugins/starfield/starfield.js')?>"></script>
]]>
</INLINE>
</FILE>
<FILE Name="&emhttp;/starfield.css">
<INLINE>
<![CDATA[
HDR
cat starfield.css
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
<FILE Run="/bin/bash" Method="remove">
<INLINE>
rm -rf /usr/local/emhttp/plugins/starfield
echo "starfield removed"
</INLINE>
</FILE>
</PLUGIN>
FTR
} > starfield.plg
grep -c "]]>" starfield.js starfield.css || true
echo "built starfield.plg v$VER"
