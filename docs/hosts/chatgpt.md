# ChatGPT

**Not yet.** ChatGPT connects to tools through remote servers on the internet; it cannot start a program on your computer. This project currently runs only on your own machine, which is also why your children's data never leaves it except to SchoolSoft and the assistant you talk to.

A hosted version (a remote MCP transport with per-user storage) is on the [roadmap](../../README.md#roadmap). It will need a careful design for where sessions are stored, so it is a separate piece of work.

## What works today

Any of the assistants in [Get started](README.md) run locally: Claude Desktop is the closest to the ChatGPT experience for non-technical users. If you use ChatGPT on the same computer, you can still use the command-line tool directly for quick questions:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
npx -y schoolsoft-agent login
npx -y schoolsoft-agent get-schedule --pretty
```

Every command is listed in the [command reference](../reference/commands.md).
