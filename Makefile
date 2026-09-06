# schoolsoft-agent - every crucial command lives here (house convention, see
# blinkbitcoin/esign). Run `make` or `make help` to list targets.
SHELL := /bin/bash
.DEFAULT_GOAL := help
TSX := ./node_modules/.bin/tsx
NODE_MIN := 22
MERMAID_CLI := @mermaid-js/mermaid-cli@11.16.0

# ---------- Setup ----------

setup: ## Check node version, npm ci (also installs git hooks via lefthook)
	@node -e "process.exit(+process.versions.node.split('.')[0] >= $(NODE_MIN) ? 0 : 1)" || (echo "node >= $(NODE_MIN) required (found $$(node -v))"; exit 1)
	npm ci

install: setup ## Alias for setup

hooks: ## (Re)install the lefthook git hooks
	npx lefthook install

# ---------- Quality gates (cheap first; CI runs them in this order) ----------

lint: ## oxlint over src, test, scripts
	npm run lint

typecheck: ## TypeScript across src, tests and scripts
	npm run typecheck

format: ## Format everything with prettier
	npm run fmt

format-check: ## Check formatting without writing
	npm run fmt:check

boundaries: ## Enforce core/adapter import rules (scripts/check-boundaries.ts)
	npm run boundaries

check-code: lint typecheck format-check boundaries ## Lint + typecheck + format check + import boundaries

shellcheck: ## shellcheck every repo shell script (scripts/**, skills/**)
	shellcheck -x scripts/*.sh scripts/*/*.sh skills/schoolsoft/scripts/*.sh

check-ci: shellcheck ## Lint the CI itself: actionlint (workflows) + shellcheck (scripts)
	actionlint

audit: ## Dependency audit (audit-ci.jsonc allowlist)
	npx audit-ci --config audit-ci.jsonc

diagrams-check: ## Fail if docs/diagrams/README.md is stale relative to src/*.mmd (what CI runs)
	bash scripts/ci/diagrams-check.sh

docs-check: ## Warn when architecture-relevant changes ship without a docs/ update; fail on stale diagram SVGs
	bash scripts/ci/docs-freshness.sh

plugin-validate: ## Validate every host manifest and the skill folder
	npm run plugin:validate

unit: ## Unit + boundary + functional + packaging tests (no network)
	npm test

coverage: ## Same tests with coverage thresholds (json-summary + html under coverage/)
	npm run coverage

coverage-badge: ## Render the README coverage badge + HTML report from the last `make coverage`
	npm run coverage:badge

test: unit check-code ## Unit tests + code checks

check: check-code plugin-validate coverage ## Everything the Checks + Unit stages run (no network)

build: ## Compile TypeScript to dist/
	npm run build

check-package: build ## Package shape (publint) + pack/install smoke of the tarball
	npm run check:package
	bash scripts/pack-smoke.sh

# ---------- E2E ----------

e2e-artifact: build skills mcpb-stage ## Shipped-artifact E2E without SchoolSoft: stdio smoke, CLI spawn, staged mcpb (what CI's E2E stage runs)
	bash scripts/e2e/artifact-smoke.sh

e2e: build ## Live E2E against SchoolSoft (needs `configure` + one BankID login; never in CI)
	npm run test:e2e

login: build ## Interactive BankID login (opens your browser)
	node dist/cli/index.js login

status: build ## Show session status
	node dist/cli/index.js auth-status

logout: build ## Clear the stored session
	node dist/cli/index.js logout

configure: build ## Interactive configuration (find your school)
	node dist/cli/index.js configure

doctor: build ## Diagnose environment, config, session and connectivity
	node dist/cli/index.js doctor

# ---------- Generated artifacts ----------

docs: ## Regenerate command/tool reference docs from the operation registry
	npm run docs

diagrams: ## Render docs/diagrams/dist/*.svg from src/*.mmd (pinned mermaid-cli) + reassemble the diagrams page
	for f in docs/diagrams/src/*.mmd; do \
		npx --yes $(MERMAID_CLI) -i "$$f" \
			-o "docs/diagrams/dist/$$(basename "$$f" .mmd).svg" \
			--backgroundColor white --quiet || exit 1; \
	done
	node scripts/assemble-diagrams.mjs

skills: build ## Build per-host skill folders into dist/skills/ (+ the committed Claude copy)
	npm run skills

mcpb-stage: build ## Stage the Claude Desktop bundle directory (dist/mcpb)
	$(TSX) scripts/build-mcpb.ts

mcpb: mcpb-stage ## Pack the Claude Desktop bundle (dist/schoolsoft-agent.mcpb)
	npx -y @anthropic-ai/mcpb pack dist/mcpb dist/schoolsoft-agent.mcpb

# ---------- Local host registration (development) ----------

install-claude: skills ## Register this checkout's marketplace with Claude Code
	claude plugin marketplace add ./plugins/claude || true
	@echo "Now: /plugin install schoolsoft-mcp@schoolsoft-agent  or  /plugin install schoolsoft-skill@schoolsoft-agent"

install-opencode: skills ## Copy the skill into ./.agents/skills and print the opencode.json MCP snippet
	mkdir -p .agents/skills && rm -rf .agents/skills/schoolsoft && cp -R dist/skills/opencode/schoolsoft .agents/skills/schoolsoft
	@echo "Add to opencode.json:" && cat plugins/opencode/opencode.json

install-hermes: skills ## Copy the skill into ~/.hermes/skills/education/schoolsoft
	mkdir -p ~/.hermes/skills/education && rm -rf ~/.hermes/skills/education/schoolsoft && cp -R dist/skills/hermes/schoolsoft ~/.hermes/skills/education/schoolsoft

install-openclaw: skills ## Copy the skill into ~/.openclaw/skills/schoolsoft
	mkdir -p ~/.openclaw/skills && rm -rf ~/.openclaw/skills/schoolsoft && cp -R dist/skills/openclaw/schoolsoft ~/.openclaw/skills/schoolsoft

install-pi: skills ## Copy the skill into ~/.pi/agent/skills/schoolsoft
	mkdir -p ~/.pi/agent/skills && rm -rf ~/.pi/agent/skills/schoolsoft && cp -R dist/skills/pi/schoolsoft ~/.pi/agent/skills/schoolsoft

# ---------- Release ----------

release: ## Merge the open release PR (release-please opens it after a feat/fix lands on main); needs one approval first
	@pr=$$(gh pr list --state open --label 'autorelease: pending' --json number,title -q '.[0] | "\(.number) \(.title)"'); \
	test -n "$$pr" || { echo "no open release PR: one appears after a feat/fix/perf commit reaches main (docs/releasing.md)"; exit 1; }; \
	echo "merging #$$pr"; gh pr merge "$${pr%% *}" --squash

release-rc: ## Hand-cut a prerelease-suffixed tag that ships under next: make release-rc V=X.Y.Z-rc.1
	@test -n "$(V)" || { echo "usage: make release-rc V=X.Y.Z-rc.1"; exit 1; }
	@case "$(V)" in *-*) ;; *) echo "V must carry a prerelease suffix (X.Y.Z-rc.1); stable versions go through the release PR"; exit 1 ;; esac
	gh release create "v$(V)" --target main --title "v$(V)" --prerelease --notes "Prerelease $(V) - see CHANGELOG.md on main for the pending changes."

version: ## Show what CI would publish for HEAD (prerelease), or for a tag: make version TAG=vX.Y.Z
	@DRY_RUN=1 EVENT=$(if $(TAG),release,push) TAG=$(TAG) bash scripts/release/resolve-version.sh

registry-smoke: ## Install a published version from npm and assert the consumer contract: make registry-smoke V=X.Y.Z
	@test -n "$(V)" || { echo "usage: make registry-smoke V=X.Y.Z"; exit 1; }
	bash scripts/release/registry-smoke.sh "$(V)"

# ---------- Housekeeping ----------

clean: ## Remove build output and caches
	rm -rf dist coverage

help: ## List available targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: setup install hooks lint typecheck format format-check boundaries check-code shellcheck check-ci audit \
	diagrams-check docs-check plugin-validate unit coverage coverage-badge test check build check-package \
	e2e-artifact e2e login status logout configure doctor docs diagrams skills mcpb-stage mcpb \
	install-claude install-opencode install-hermes install-openclaw install-pi \
	release release-rc version registry-smoke clean help
