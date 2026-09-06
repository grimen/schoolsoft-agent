# CI-owned branch

badges/<branch>/{coverage,unit,e2e}.svg (+ unit/e2e .json) - written by the
Badges job in .github/workflows/ci.yml (scripts/ci/publish-badges.sh) on every
CI run; a PR's directory is removed when it closes (badges-cleanup.sh).
Do not edit by hand.
