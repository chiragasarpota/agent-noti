#!/usr/bin/env bash
set -e

CDN="https://your-cdn-url.b-cdn.net/claude-notification"
DIR="$HOME/.claude/claude-notification"
SETTINGS="$HOME/.claude/settings.json"
HOOK_ID="claude-notification"

echo ""
echo "  Installing claude-notification..."
echo ""

# 1. Download files
mkdir -p "$DIR/sounds"
curl -fsSL "$CDN/sounds/idle.mp3" -o "$DIR/sounds/idle.mp3"
curl -fsSL "$CDN/sounds/input.mp3" -o "$DIR/sounds/input.mp3"

# 2. Add hooks to settings.json
if [ ! -f "$SETTINGS" ]; then
    echo '{}' > "$SETTINGS"
fi

node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
if (!s.hooks) s.hooks = {};

const ID = '$HOOK_ID';
const dir = '$DIR/sounds';

// Remove existing claude-notification hooks
for (const event of Object.keys(s.hooks)) {
    if (Array.isArray(s.hooks[event])) {
        s.hooks[event] = s.hooks[event].filter(e => !e.metadata || e.metadata.id !== ID);
        if (s.hooks[event].length === 0) delete s.hooks[event];
    }
}

// Add hooks
const idle = { type: 'command', command: 'afplay \"' + dir + '/idle.mp3\" &' };
const input = { type: 'command', command: 'afplay \"' + dir + '/input.mp3\" &' };

s.hooks.Stop = [...(s.hooks.Stop || []), { hooks: [idle], metadata: { id: ID } }];
s.hooks.PermissionRequest = [...(s.hooks.PermissionRequest || []), { hooks: [input], metadata: { id: ID } }];

fs.writeFileSync('$SETTINGS', JSON.stringify(s, null, 2) + '\n');
"

echo "  claude-notification installed!"
echo ""
echo "  Restart Claude Code to activate."
echo "  Sounds saved to ~/.claude/claude-notification/sounds/"
echo ""
echo "  To uninstall:"
echo "    curl -fsSL $CDN/uninstall.sh | bash"
echo ""
