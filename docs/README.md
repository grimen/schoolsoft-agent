# Documentation

**New here? [Start with the parent setup guide](getting-started/README.md).**
It helps you choose an assistant, connect SchoolSoft and check your first answer.

| What you want to do                            | Where to go                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Get started or fix a setup problem             | [Getting started](getting-started/README.md) · [Computer basics](getting-started/computer-basics.md) · [Troubleshooting](getting-started/troubleshooting.md) |
| Connect a particular AI assistant              | [Integrations](integrations/README.md) · [Support matrix](integrations/support-matrix.md)                                                                    |
| Run your own connector server                  | [Deployment choices](deployment/README.md) · [Connector setup](deployment/connector.md)                                                                      |
| Look up a tool, command or API                 | [Reference](reference/README.md)                                                                                                                             |
| Contribute code or publish a release           | [Development](development/README.md)                                                                                                                         |
| Read design decisions and implementation plans | [Planning archive](planning/README.md)                                                                                                                       |

Integration guides describe **which assistant you use**. Deployment guides describe
**where your connector runs**. For example, use the ChatGPT integration guide to
check the client requirements, then the Hostinger deployment guide if that is
where you want to run your server.

## Where new documentation belongs

- `getting-started/`: beginner onboarding, computer basics and troubleshooting.
- `integrations/`: assistant-specific setup; product families such as `claude/`
  and `openai/` have subfolders. Cross-client compatibility lives here too.
- `deployment/`: parent-owned hosting, networking, persistence and server recovery.
- `reference/`: tool and command contracts, plus SchoolSoft API findings.
- `development/`: architecture, engineering workflows and releases.
- `planning/`: dated specs and plans; these record intent and history, not setup instructions.
- `diagrams/` and `assets/`: shared illustrations, kept separate from guides.

Each guide has one canonical location. Link to it from another section rather
than copying its instructions. Keep relative links working when moving a page.
