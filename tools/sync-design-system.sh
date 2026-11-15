#!/bin/sh
# Copies the brand book's generated tokens and component styles into packages/design-system so every app reads the same values.
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
cp "$HERE/../../drive/brand/book/tokens.css" "$HERE/packages/design-system/tokens.css"
cp "$HERE/../../drive/brand/book/components.css" "$HERE/packages/design-system/components.css"
echo "design system synced from ~/Desktop/drive/brand/book"
