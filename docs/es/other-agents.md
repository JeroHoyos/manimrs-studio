# Otros agentes

[English](../other-agents.md) | **Español**

El chat de la app corre Claude Code. Pero las herramientas de ManimRS Studio son un servidor MCP,
y cualquier agente que use MCP se puede conectar: OpenCode, Codex (ChatGPT), Gemini CLI, Cursor,
VS Code y otros. El agente usa el modelo que elijas en él.

## El servidor MCP

`engine/mcp_server.py` es un servidor MCP que el agente arranca. No hace falta abrir la app. Si la
app está abierta, muestra cada diapositiva que el agente renderiza.

El comando, desde la carpeta de charlas:

```powershell
uv run --no-project manimrs-studio/engine/mcp_server.py
```

El servidor ofrece estas herramientas: `talks`, `slides`, `notes`, `render`, `view`, `place`,
`export` y `present`. Son las mismas de la app. Mira
[Las herramientas MCP de la app](claude-chat.md#las-herramientas-mcp-de-la-app). La herramienta
`show` solo existe en el chat de la app.

## Conectar un agente

Arranca el agente en la carpeta de charlas, así la ruta del comando queda bien. Si lo arrancas en
otra carpeta, escribe la ruta completa de `mcp_server.py`.

Estos ejemplos siguen el formato de configuración de cada agente. Los formatos pueden cambiar, y
estos ejemplos no se han probado con cada agente. Si uno no funciona, mira la documentación del
agente.

### OpenCode

En `opencode.json`, en la carpeta de charlas:

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

En `.codex/config.toml` de tu carpeta de usuario:

```toml
[mcp_servers.studio]
command = "uv"
args = ["run", "--no-project", "C:/talks/manimrs-studio/engine/mcp_server.py"]
```

### Gemini CLI

En `.gemini/settings.json`, en la carpeta de charlas:

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

En `.cursor/mcp.json`, en la carpeta de charlas. El contenido es el mismo que para Gemini CLI.

### VS Code

En `.vscode/mcp.json`, en la carpeta de charlas:

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

### Claude Code en una terminal

```powershell
claude mcp add studio -- uv run --no-project manimrs-studio/engine/mcp_server.py
```

## Decirle al agente el procedimiento

El servidor le da al agente un procedimiento corto: cambiar el archivo de la diapositiva,
renderizarla y mirar sus imágenes. Casi todos los agentes leen además un archivo `AGENTS.md`. Pon
las reglas de tu charla en el `AGENTS.md` de la charla: su estilo, su idioma y su estructura.

## Usar la revisión con un agente

1. Escribe las notas en *Review*, en la app, y haz clic en *Save note*.
2. Dile al agente: `Apply the changes that I requested in the talk <name>. Use the notes tool.`
3. Mira cada diapositiva en la app cuando el agente la renderice.
4. Haz clic en *Approve* cuando la diapositiva esté bien.
