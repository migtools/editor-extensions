#!/bin/bash

# Update upstream reference in mta-build.yaml
#
# This script resolves a semantic ref (tag/branch) to the latest commit SHA
# and updates mta-build.yaml with both the SHA (for immutability) and the
# semantic ref (for human readability).
#
# Usage:
#   ./scripts/update-upstream.sh                # Use current semanticRef from mta-build.yaml
#   ./scripts/update-upstream.sh release-0.4    # Update to new semantic ref
#   ./scripts/update-upstream.sh main
#   ./scripts/update-upstream.sh v0.4.1
#
# The semantic ref is stored for documentation, but the SHA is what gets
# checked out. This gives us immutability (SHAs don't move) with traceability
# (we know it came from release-0.4).

set -e

REPO="konveyor/editor-extensions"
CONFIG_FILE="mta-build.yaml"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Error: $CONFIG_FILE not found"
  exit 1
fi

# If no argument, read semanticRef from mta-build.yaml
if [ -z "$1" ]; then
  # Use grep and sed to extract semanticRef from YAML
  SEMANTIC_REF=$(grep 'semanticRef:' "$CONFIG_FILE" | head -1 | sed 's/.*semanticRef: *//' | tr -d '"' | tr -d "'")

  if [ -z "$SEMANTIC_REF" ]; then
    echo "❌ Error: No semanticRef found in $CONFIG_FILE"
    echo ""
    echo "Usage: $0 <semantic-ref>"
    echo ""
    echo "Examples:"
    echo "  $0 release-0.4      # Get latest commit on release-0.4 branch"
    echo "  $0 main             # Get latest commit on main branch"
    echo "  $0 v0.4.1           # Get commit for v0.4.1 tag"
    exit 1
  fi

  echo "📖 Using semanticRef from $CONFIG_FILE: $SEMANTIC_REF"
else
  SEMANTIC_REF=$1
fi

echo "🔍 Resolving ref: $SEMANTIC_REF in $REPO"

# Get SHA for the ref
# For branches, use refs/heads/<branch>
# For tags, use refs/tags/<tag>
# If no prefix, try both
SHA=$(git ls-remote https://github.com/$REPO.git "$SEMANTIC_REF" | head -n 1 | cut -f1)

if [ -z "$SHA" ]; then
  # Try with refs/heads/ prefix
  SHA=$(git ls-remote https://github.com/$REPO.git "refs/heads/$SEMANTIC_REF" | cut -f1)
fi

if [ -z "$SHA" ]; then
  # Try with refs/tags/ prefix
  SHA=$(git ls-remote https://github.com/$REPO.git "refs/tags/$SEMANTIC_REF" | cut -f1)
fi

if [ -z "$SHA" ]; then
  echo "❌ Error: Could not resolve ref '$SEMANTIC_REF'"
  echo "   Make sure the ref exists in $REPO"
  echo ""
  echo "   Available branches:"
  git ls-remote --heads https://github.com/$REPO.git | sed 's/.*refs\/heads\//     /'
  echo ""
  echo "   Recent tags:"
  git ls-remote --tags https://github.com/$REPO.git | sed 's/.*refs\/tags\//     /' | tail -10
  exit 1
fi

SHA_SHORT=$(echo $SHA | cut -c1-7)

echo "✅ Resolved '$SEMANTIC_REF' to SHA: $SHA_SHORT"
echo "   Full SHA: $SHA"
echo ""

# Update mta-build.yaml - only the upstream section
# Use sed to update in place
sed -i.bak -E "s|^(  ref:).*|\1 $SHA|" "$CONFIG_FILE"
sed -i.bak -E "s|^(  semanticRef:).*|\1 $SEMANTIC_REF|" "$CONFIG_FILE"
rm -f "${CONFIG_FILE}.bak"

echo "📝 Updated $CONFIG_FILE:"
head -10 "$CONFIG_FILE"

echo ""
echo "✅ Done! Build will use:"
echo "   - SHA: $SHA (immutable)"
echo "   - Semantic ref: $SEMANTIC_REF (for documentation)"
echo ""
echo "📋 Next steps:"
echo "   git add $CONFIG_FILE"
echo "   git commit -m \"Update to upstream $SEMANTIC_REF @ $SHA_SHORT\""
echo ""
echo "💡 To test locally before committing:"
echo "   npm run pull-upstream"
