// Renders the README coverage badge from measured numbers (c8 json-summary)
// instead of a hardcoded shields.io URL, plus a copy of c8's HTML report.
// Output (gitignored):
//   coverage/badge/coverage.svg  shields-identical flat badge (badge-maker)
//   coverage/report/             c8's HTML report
// CI (test.yml) renders both on every run, publishes the badge per branch
// to gh-pages/badges/<branch>/ (README.md embeds main's) and uploads the
// report as the `coverage-report` run artifact.
//
// `--status failing` / `--status pending` render an honest placeholder badge
// (no report).
import { makeBadge } from "badge-maker";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY = join(root, "coverage", "coverage-summary.json");
const HTML = join(root, "coverage", "lcov-report");
const BADGE_DIR = join(root, "coverage", "badge");
const REPORT_DIR = join(root, "coverage", "report");
const PLACEHOLDERS = { failing: "red", pending: "yellow" };

function colorFor(pct) {
  if (pct >= 100) return "brightgreen";
  if (pct >= 90) return "green";
  if (pct >= 80) return "yellowgreen";
  if (pct >= 70) return "yellow";
  return "red";
}
function formatPercent(pct) {
  const fixed = pct.toFixed(1);
  return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}%`;
}
function parseStatus(argv) {
  const i = argv.indexOf("--status");
  if (i === -1) return null;
  const status = argv[i + 1];
  if (!(status in PLACEHOLDERS)) {
    console.error(
      `coverage-badge: --status must be one of ${Object.keys(PLACEHOLDERS).join(", ")}`,
    );
    process.exit(1);
  }
  return status;
}
function measure() {
  if (!existsSync(SUMMARY)) {
    console.error(
      "coverage-badge: missing coverage/coverage-summary.json - run `make coverage` first",
    );
    process.exit(1);
  }
  const { total } = JSON.parse(readFileSync(SUMMARY, "utf8"));
  if (!total.lines.total) {
    console.error("coverage-badge: no lines measured at all - refusing to render");
    process.exit(1);
  }
  const pct = total.lines.pct;
  return {
    message: formatPercent(pct),
    color: colorFor(pct),
    detail: `${total.lines.covered}/${total.lines.total} lines`,
  };
}
function writeReport() {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  if (!existsSync(join(HTML, "index.html"))) {
    console.error(`coverage-badge: no HTML report at ${HTML} - check .c8rc.json reporters`);
    process.exit(1);
  }
  cpSync(HTML, REPORT_DIR, { recursive: true });
}

const status = parseStatus(process.argv.slice(2));
const { message, color, detail } = status
  ? { message: status, color: PLACEHOLDERS[status], detail: "placeholder" }
  : measure();
mkdirSync(BADGE_DIR, { recursive: true });
writeFileSync(
  join(BADGE_DIR, "coverage.svg"),
  makeBadge({ label: "Coverage", message, color, style: "flat" }),
);
if (!status) writeReport();
console.log(
  `coverage-badge: ${message} (${detail}) -> coverage/badge/${status ? "" : " + coverage/report/"}`,
);
