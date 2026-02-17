#!/usr/bin/env bash
set -e

DIR="$HOME/.claude/claude-notification"
SETTINGS="$HOME/.claude/settings.json"
HOOK_ID="claude-notification"

echo ""

# Remove hooks from settings.json
if [ -f "$SETTINGS" ]; then
    node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
if (s.hooks) {
    for (const event of Object.keys(s.hooks)) {
        if (Array.isArray(s.hooks[event])) {
            s.hooks[event] = s.hooks[event].filter(e => !e.metadata || e.metadata.id !== '$HOOK_ID');
            if (s.hooks[event].length === 0) delete s.hooks[event];
        }
    }
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
}
fs.writeFileSync('$SETTINGS', JSON.stringify(s, null, 2) + '\n');
"
fi

# Remove files
rm -rf "$DIR"

echo "  claude-notification uninstalled!"
echo ""
