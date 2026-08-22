#!/usr/bin/env bash
#
# Publish a notes-free snapshot of the code to the PUBLIC mirror (DormApp).
#
# Why a script and not .gitignore: .gitignore is per-repository, not per-remote.
# Listing these files there would untrack them from amanew-residence as well —
# deleting the project's own status board and instructions from the private repo
# that needs them. Git has no "push everything except X to this one remote", so
# the mirror is built as a snapshot instead.
#
# It pushes a SINGLE ORPHAN COMMIT, deliberately. A force-push of the current
# branch would remove the notes from the tip and leave every earlier copy of
# them readable in the public history, which is not removing them. One commit
# with no parents means there is no history to read.
#
#   ./scripts/sync-public.sh            # show what would be published
#   ./scripts/sync-public.sh --push     # actually publish
#
# What stays private, and why each one:
#   PROGRESS.md                     operational runbook for a live system
#   CLAUDE.md                       same, plus how to work on it
#   AMANEW_MASTER_DOCUMENT.md       §18 is the deployment topology
#   docs/                           the LINE and tenant-access plans
#   Amanew_*.md                     the archived specs
#   .github/                        the deploy workflow — excluded so that a
#                                   push to the mirror CANNOT start a deploy,
#                                   whatever secrets that repo does or does not
#                                   have. This is the belt-and-braces on
#                                   "update the files, deploy nothing".
set -euo pipefail

REMOTE="${REMOTE:-personal}"
BRANCH="${BRANCH:-main}"

EXCLUDE=(
  PROGRESS.md
  CLAUDE.md
  AMANEW_MASTER_DOCUMENT.md
  Amanew_Business_Rules_FINAL_1.md
  Amanew_Design_Handoff_v1.0.md
  docs
  .github
)

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty — commit or stash first, so the mirror matches a real commit." >&2
  exit 1
fi

SRC_SHA="$(git rev-parse --short HEAD)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Tracked files only: git archive never sees an untracked .env or a build dir.
git archive HEAD | tar -x -C "$TMP"
for path in "${EXCLUDE[@]}"; do rm -rf "${TMP:?}/$path"; done

# The README is shared with the private repo, where its links to CLAUDE.md and
# the specs are correct and worth having. Here they would be 404s, so the
# snapshot's copy drops them and says where they went — rather than keeping a
# second README in the repo and letting the two drift.
python3 - "$TMP/README.md" <<'PYEOF'
import re, sys
path = sys.argv[1]
withheld = ('CLAUDE.md', 'PROGRESS.md', 'AMANEW_MASTER_DOCUMENT.md',
            'Amanew_Business_Rules', 'Amanew_Design_Handoff', 'docs/')
lines = [l for l in open(path, encoding='utf-8').read().split('\n')
         if not any(w in l for w in withheld)]
text = re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).rstrip() + '\n'
text += ('\n---\n\nThis is a code mirror. The project notes, the specification and the '
         'deployment\nconfiguration live in the private repository and are deliberately not '
         'published here.\n')
open(path, 'w', encoding='utf-8').write(text)
PYEOF

echo "Publishing $(find "$TMP" -type f | wc -l) files from $SRC_SHA to $REMOTE/$BRANCH"
echo "Withheld:"
for path in "${EXCLUDE[@]}"; do echo "  - $path"; done

# Nothing withheld may survive inside what is published — a spec quoted whole
# into another file would defeat the point of withholding it.
RUNBOOK_MARKERS='Next session starts here|Decisions & deviations log'
# (This script is skipped: it necessarily contains the patterns it searches for,
# and would otherwise flag itself — which it did, first run.)
LEAKED="$(grep -rlE "$RUNBOOK_MARKERS" "$TMP" 2>/dev/null | grep -v 'scripts/sync-public.sh' || true)"
if [ -n "$LEAKED" ]; then
  echo "REFUSING: runbook text found inside a file that would be published:" >&2
  echo "$LEAKED" >&2
  exit 1
fi

if [ "${1:-}" != "--push" ]; then
  echo
  echo "Dry run. Re-run with --push to publish."
  exit 0
fi

git -C "$TMP" init -q -b "$BRANCH"
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Amanew Smart Management System — code snapshot ($SRC_SHA)

Source of truth is the private repository; this mirror carries the code only.
Project notes, specs and the deploy workflow are deliberately not published."

git -C "$TMP" remote add target "$(git remote get-url "$REMOTE")"
git -C "$TMP" push --force target "$BRANCH:$BRANCH"
echo "Published."
