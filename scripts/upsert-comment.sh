#!/bin/sh
# Keeps one Preview comment on a pull request: updates the comment that carries
# $COMMENT_MARKER, or adds it. With --keep, leaves an existing one alone.
#   sh scripts/upsert-comment.sh <pr number> <body> [--keep]
# Needs GH_TOKEN, GITHUB_REPOSITORY and COMMENT_MARKER (deploy.yml sets them).
set -eu
pr=$1
body=$2
keep=${3:-}

id=$(gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"$COMMENT_MARKER\")) | .id" | head -n 1)

if [ -z "$id" ]; then
  gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" --silent
elif [ "$keep" != --keep ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" --silent
fi
