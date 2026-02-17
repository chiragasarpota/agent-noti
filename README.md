# agent-noti

Audio notifications for Claude Code. Hear when Claude is done or needs your input.

Works on macOS, Linux, and Windows.

## Install

```sh
npm install -g agent-noti
```

That's it. Hooks are added automatically. Restart Claude Code.

## What it does

- **Claude finishes** → plays `idle.mp3`
- **Claude needs input** (permission request) → plays `input.mp3`

## Commands

```sh
agent-noti test        # Play both sounds
agent-noti install     # Re-add hooks (if needed)
agent-noti uninstall   # Remove hooks
```

## Uninstall

```sh
npm uninstall -g agent-noti
```

Hooks are removed automatically.

## Custom sounds

Replace the mp3 files in the package's `sounds/` directory:

```sh
agent-noti test  # find where sounds are located
```

## Platform support

| OS | Audio player |
|---|---|
| macOS | `afplay` (built-in) |
| Linux | `ffplay`, `paplay`, or `mpv` |
| Windows | PowerShell MediaPlayer |

## License

MIT
