#!/usr/bin/env bash
# Download the preview's bundled libraries into assets/.
# Usage: scripts/update-assets.sh          download every file
#        scripts/update-assets.sh --check  fail if a file differs from its pinned version
set -euo pipefail

# Keep in sync with the "Bundled assets" list in the README.
GITHUB_MARKDOWN_CSS=5.5.1
HIGHLIGHT_JS=11.9.0
MARKED=12.0.2
MERMAID=10.9.1

CDN=https://cdn.jsdelivr.net/npm
HLJS=$CDN/@highlightjs/cdn-assets@$HIGHLIGHT_JS
FILES=(
  "github-markdown.min.css $CDN/github-markdown-css@$GITHUB_MARKDOWN_CSS/github-markdown.min.css"
  "highlight.min.js $HLJS/highlight.min.js"
  "github.min.css $HLJS/styles/github.min.css"
  "github-dark.min.css $HLJS/styles/github-dark.min.css"
  "marked.min.js $CDN/marked@$MARKED/marked.min.js"
  "mermaid.min.js $CDN/mermaid@$MERMAID/dist/mermaid.min.js"
)

cd "$(dirname "$0")/../assets"
status=0
for entry in "${FILES[@]}"; do
  read -r file url <<<"$entry"
  if [ "${1:-}" = --check ]; then
    if curl -fsSL "$url" | cmp -s - "$file"; then echo "ok      $file"; else echo "differs $file ($url)"; status=1; fi
  else
    curl -fsSL -o "$file" "$url" && echo "updated $file"
  fi
done
exit $status
