#!/bin/sh
# Prints the Preview name for a branch: https://<name>-krdm-band.krdm.workers.dev.
# Lowercase letters, digits and dashes, at most 40 characters (a hostname label
# is at most 63, and "-krdm-band" takes 10). Used by .github/workflows/deploy.yml.
#   sh scripts/preview-name.sh feat/Discounts   →  feat-discounts
printf %s "$1" | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//' | cut -c1-40 | sed -E 's/-+$//'
