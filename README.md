# agent-noti

Audio notifications for Claude Code and Codex. Hear when your agent is done or needs your input.

Works on macOS, Linux, and Windows.

## Install

```sh
npm i -g agent-noti
```

That's it. Hooks are added automatically and the interactive sound picker launches so you can choose a theme. Restart your agent.

## What it does

| Event | Sound | Claude Code | Codex |
|---|---|---|---|
| Agent finished | idle sound | Stop | agent-turn-complete |
| Needs your input | input sound | PermissionRequest | approval-requested |

## Sound themes

Each theme includes a separate idle and input sound.

| Theme | Description |
|---|---|
| default | Original notification |
| cow | Moo! |
| goose | Honk! |
| duck | Quack quack |
| car | Vroom vroom |
| slide-whistle | Wheee! |
| video-game | Retro gaming |
| digital-glass | Sleek & modern |

## Commands

```sh
agent-noti install        # Add hooks + pick theme     (i)
agent-noti uninstall      # Remove hooks
agent-noti test           # Play current sounds         (t)
agent-noti sounds         # List available themes        (s)
agent-noti pick           # Interactive sound picker     (p)
agent-noti add-custom     # Use your own sound files     (ac)
agent-noti volume <1-10>  # Set volume level             (v)
agent-noti mute           # Mute notifications           (m)
agent-noti unmute         # Unmute notifications         (u)
agent-noti reset          # Reset everything             (r)
```

Every command has a short alias shown in parentheses — e.g. `agent-noti v 5` instead of `agent-noti volume 5`.

## Interactive picker

```
agent-noti pick
```

Navigate with arrow keys, preview sounds before selecting:

- **Up / Down** — navigate themes
- **Left** — play idle sound
- **Right** — play input sound
- **Enter** — select theme
- **q** — quit

The picker also includes **+ Add custom** at the bottom, which walks you through importing your own sound files. Once added, your custom sounds appear in the picker below default.

## Custom sounds

Run `agent-noti add-custom` (or select **+ Add custom** in the picker) for an interactive flow:

1. Choose idle sound — enter a file path or skip (use default)
2. Choose input sound — enter a file path, use same as idle, or skip

Custom files are copied to `~/.agent-noti/sounds/` so they persist across package updates.

## Volume & mute

```sh
agent-noti volume 5   # Set volume 1-10
agent-noti volume     # Show current volume
agent-noti mute       # Silence all notifications
agent-noti unmute     # Re-enable notifications
```

Setting volume while muted auto-unmutes. Volume works across all platforms.

## Config

All settings are stored in `~/.agent-noti/config.json`:

```json
{
  "idle": "cow",
  "input": "cow",
  "volume": 10,
  "muted": false
}
```

## Uninstall

```sh
npm uninstall -g agent-noti
```

Hooks are removed automatically.

## Platform support

| OS | Audio player |
|---|---|
| macOS | `afplay` (built-in) |
| Linux | `ffplay`, `paplay`, or `mpv` (tries in order) |
| Windows | PowerShell MediaPlayer |

## License

MIT
