#!/bin/bash
# === Priory SmartShift Auto-Push Script ===
# Adds, commits, pushes, and tags a new version automatically.

# Step 1: Stage and commit
git add .
git commit -m "Quick push from Codespace ✅"

# Step 2: Push the latest commit
git push origin main

# Step 3: Auto-increment version tag
# Find the latest tag (or start at v1.0.0 if none exists)
latest_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "v1.0.0")

# Extract numeric parts and increment the patch version
IFS='.' read -r major minor patch <<< "${latest_tag//v/}"
next_tag="v${major}.${minor}.$((patch + 1))"

# Create and push the new tag
git tag -a "$next_tag" -m "Auto-tagged version $next_tag"
git push origin "$next_tag"

echo "✅ Code pushed and tagged as $next_tag"
