# Other agents

The chat in the app runs Claude Code. But the tools of ManimRS Studio are an MCP server, and all
agents that use MCP can connect to it: OpenCode, Codex (ChatGPT), Gemini CLI, Cursor, VS Code and
others. The agent can use the model that you select in it.

## The MCP server

`engine/mcp_server.py` is an MCP server that the agent starts. It is not necessary to open the
app. If the app is open, it shows each slide that the agent renders.

The command, from the talks folder:

```powershell
uv run --no-project manimrs-studio/engine/mcp_server.py
```

The server gives these tools: `talks`, `slides`, `notes`, `render`, `view`, `place`, `export` and
`present`. They are the tools of the app. Refer to
[The MCP tools of the app](claude-chat.md#the-mcp-tools-of-the-app). The `show` tool is only in the
chat of the app.

## Connect an agent

Start the agent in the talks folder, thus the path in the command is correct. If you start the
agent in a different folder, write the full path of `mcp_server.py`.

These examples follow the configuration format of each agent. The formats can change. If an
example does not work, refer to the documentation of the agent.

### OpenCode

In `opencode.json`, in the talks folder:

```json
{
  "mcp": {
    "studio": {
      "type": "local",
      "command": ["uv", "run", "--no-project", "manimrs-studio/engine/mcp_server.py"],
      "enabled": true
    }
  }
}
```

### Codex (ChatGPT)

In `.codex/config.toml` of your user folder:

```toml
[mcp_servers.studio]
command = "uv"
args = ["run", "--no-project", "C:/talks/manimrs-studio/engine/mcp_server.py"]
```

### Gemini CLI

In `.gemini/settings.json`, in the talks folder:

```json
{
  "mcpServers": {
    "studio": {
      "command": "uv",
      "args": ["run", "--no-project", "manimrs-studio/engine/mcp_server.py"]
    }
  }
}
```

### Cursor

In `.cursor/mcp.json`, in the talks folder. The contents are the same as for Gemini CLI.

### VS Code

In `.vscode/mcp.json`, in the talks folder:

```json
{
  "servers": {
    "studio": {
      "command": "uv",
      "args": ["run", "--no-project", "manimrs-studio/engine/mcp_server.py"]
    }
  }
}
```

### Claude Code in a terminal

```powershell
claude mcp add studio -- uv run --no-project manimrs-studio/engine/mcp_server.py
```

## Tell the agent the procedure

The server gives the agent a short procedure: change the file of the slide, render the slide,
examine its images. Most agents also read an `AGENTS.md` file. Put the rules of your talk in the
`AGENTS.md` file of the talk: its style, its language and its structure.

## Use the review with an agent

1. Write the notes in *Review* in the app and click *Save note*.
2. Tell the agent: `Apply the changes that I requested in the talk <name>. Use the notes tool.`
3. Examine each slide in the app when the agent renders it.
4. Click *Approve* when the slide is correct.
