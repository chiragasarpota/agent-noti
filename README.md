# agent-noti

Audio notifications for Claude Code and Codex. Hear when your agent is done or needs your input.

Works on macOS, Linux, and Windows.

## Install

```sh
npm i -g agent-noti
```

That's it. Hooks are added to both Claude Code and Codex automatically. Restart your agent.

## What it does

| Event | Sound | Claude Code | Codex |
|---|---|---|---|
| Agent finished | `idle.mp3` | Stop | agent-turn-complete |
| Needs your input | `input.mp3` | PermissionRequest | approval-requested |

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

Replace `sounds/idle.mp3` and `sounds/input.mp3` in the package directory with your own files.

## Platform support

| OS | Audio player |
|---|---|
| macOS | `afplay` (built-in) |
| Linux | `ffplay`, `paplay`, or `mpv` |
| Windows | PowerShell MediaPlayer |

## License

MIT
