// Conventional Commits (https://www.conventionalcommits.org) - enforced on
// every commit by the lefthook commit-msg hook and, in CI, on the PR's commits
// and title (.github/workflows/checks.yml + commitlint.yml). Squash merges
// take the PR title, so that is the line that reaches main and the line
// release-please reads to pick the version. See CONTRIBUTING.md.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Scopes are optional; when used, keep to the area names so history and
    // the changelog stay greppable.
    "scope-enum": [
      2,
      "always",
      [
        "core", // src/core
        "mcp", // src/mcp
        "cli", // src/cli
        "skill", // skills/
        "plugins", // plugins/ (host packaging)
        "http", // src/http (remote transport, future)
        "e2e", // test/e2e
        "ci", // .github/, scripts/ci
        "deps",
        "deps-dev",
        "docs",
        "release",
      ],
    ],
    // Dependabot group titles and imperative subjects run long; keep the
    // conventional default but allow a little slack over 72.
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 100],
  },
};
