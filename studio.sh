#!/bin/sh
# ManimRS Studio from a terminal on Linux: "sh studio.sh" opens the panel, "sh studio.sh help"
# lists the commands.
exec uv run --no-project --quiet "$(dirname "$0")/engine/studio.py" "$@"
