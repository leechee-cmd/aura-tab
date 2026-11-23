#!/bin/bash

# Exit on error
set -e

# Extract version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
OUTPUT_FILE="lychee-v${VERSION}.zip"

echo "📦 Packaging Lychee Tab v${VERSION} (allowlist only — Edge Add-ons / Chrome Web Store)..."

rm -f lychee-v*.zip

if command -v zip &> /dev/null; then
    # Allowlist: runtime files only (manifest, new tab page, service worker, i18n, CSS, JS, store assets).
    # Excludes by omission: .git, .github, tests, node_modules, docs, tooling, dev assets (e.g. assets/other).
    zip -r "$OUTPUT_FILE" \
        manifest.json \
        favicon-offscreen.html \
        newtab.html \
        background-worker.js \
        LICENSE \
        PRIVACY.md \
        styles \
        scripts \
        _locales \
        assets/backgrounds \
        assets/icons \
        assets/changelog.json \
        -x "*.DS_Store" \
        -x "**/.DS_Store"
elif command -v python &> /dev/null || command -v python3 &> /dev/null; then
    PY_BIN=$(command -v python || command -v python3)
    "$PY_BIN" - <<'PY'
import zipfile, os, sys

version = [l for l in open('manifest.json', encoding='utf-8') if '"version"' in l][0].split(':')[1].strip('", \n\r')
out = f"lychee-v{version}.zip"
allow = ['manifest.json', 'favicon-offscreen.html', 'newtab.html', 'background-worker.js', 'LICENSE', 'PRIVACY.md', 'styles', 'scripts', '_locales', 'assets/backgrounds', 'assets/icons', 'assets/changelog.json']

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for item in allow:
        if os.path.isfile(item):
            zf.write(item, item)
        elif os.path.isdir(item):
            for root, dirs, files in os.walk(item):
                for f in files:
                    if f == '.DS_Store': continue
                    full = os.path.join(root, f)
                    zf.write(full, os.path.relpath(full, '.').replace(os.sep, '/'))
print("Packaged via Python successfully.")
PY
else
    echo "Error: Neither 'zip' nor 'python' found."
    exit 1
fi

echo "✅ Compression complete!"
echo "Upload $OUTPUT_FILE to the Microsoft Edge Add-ons (Partner Center) or the Chrome Web Store."
