#!/bin/bash

# Exit on error
set -e

# Extract version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
OUTPUT_FILE="leechee-v${VERSION}.zip"

echo "📦 Packaging Leechee v${VERSION} (allowlist only — Edge Add-ons / Chrome Web Store)..."

if ! command -v zip &> /dev/null; then
    echo "Error: 'zip' command not found."
    exit 1
fi

rm -f leechee-v*.zip

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

echo "✅ Compression complete!"
echo "Upload $OUTPUT_FILE to the Microsoft Edge Add-ons (Partner Center) or the Chrome Web Store."
