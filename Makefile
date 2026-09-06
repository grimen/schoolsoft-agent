# schoolsoft-agent — every crucial command lives here. `make help` lists them.
SHELL := /bin/bash
.DEFAULT_GOAL := help
TSX := ./node_modules/.bin/tsx
NODE_MIN := 22

.PHONY: help setup build typecheck fmt fmt-check boundaries test coverage check e2e docs skills mcpb plugin-validate login status logout configure doctor release clean \
        install-claude install-opencode install-hermes install-openclaw install-pi

help: ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "\nUsage: make <target>\n\n"} /^[a-zA-Z_-]+:.*?##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0,5)}' $(MAKEFILE_LIST)

##@ Development
setup: ## Check node version and install dependencies
	@node -e "process.exit(+process.versions.node.split('.')[0] >= $(NODE_MIN) ? 0 : 1)" || (echo "node >= $(NODE_MIN) required (found $$(node -v))"; exit 1)
	npm ci

build: ## Compile TypeScript to dist/
	npm run build

typecheck: ## Typecheck src, tests and scripts
	npm run typecheck

fmt: ## Format with prettier
	npm run fmt

fmt-check: ## Verify formatting
	npm run fmt:check

boundaries: ## Enforce core/adapter import rules
	npm run boundaries

test: ## Unit + boundary + functional + packaging tests (no network)
	npm test

coverage: ## Tests with coverage thresholds
	npm run coverage

check: typecheck fmt-check boundaries coverage ## Everything CI runs (no network)

e2e: build ## Live tests against SchoolSoft (needs config + one BankID login)
	npm run test:e2e

clean: ## Remove build output
	rm -rf dist coverage

##@ Generated artifacts
docs: ## Regenerate command/tool reference docs from the operation registry
	npm run docs

skills: build ## Build per-host skill folders into dist/skills/
	npm run skills

mcpb: build skills ## Build the Claude Desktop bundle (dist/schoolsoft-agent.mcpb)
	npx -y @anthropic-ai/mcpb pack plugins/mcpb dist/schoolsoft-agent.mcpb

plugin-validate: ## Validate every host manifest and skill folder
	npm run plugin:validate

##@ Use it
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

##@ Local host registration (development)
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

##@ Release
release: check ## Bump version (V=patch|minor|major|x.y.z), publish to npm, push tags
	@test -n "$(V)" || (echo "usage: make release V=patch|minor|major|x.y.z"; exit 1)
	npm version $(V) -m "chore(release): %s"
	npm publish --provenance --access public
	git push --follow-tags
