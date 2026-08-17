# Neovim Sidecar

Opens the current Obsidian file in Neovim via a tmux session in your terminal emulator with real-time bi-directional scroll synchronization, live line highlighting, and automatic window tiling.

## Requirements

- Neovim (`nvim`)
- tmux
- Supported terminal emulator

## Supported Platforms and Terminals

- **macOS**: Auto, Alacritty, kitty, Ghostty, WezTerm, iTerm2, Terminal.app
- **Linux**: Auto, Alacritty, kitty, Ghostty, WezTerm

## Usage

* Click the ribbon icon or run the command `Toggle Neovim session` to start/stop.
* Configure your preferred terminal, window tiling side, and sync options in plugin settings.

### Cursor & Scroll Sync

Enable **Sync cursor position** in plugin settings to keep Obsidian and Neovim on the same line at up to 120Hz display refresh rate. Move or scroll in either one, and the other follows with active line highlighting.

## Installation

### Via BRAT (Recommended for Beta Testing)
1. Install the [BRAT](https://github.com/TfTHacker/obsidian-42-brat) plugin in Obsidian.
2. Add `addisonking/obsidian-neovim-sidecar` to BRAT.

### Manual / CLI
Run this in your vault directory:

```sh
mkdir -p .obsidian/plugins/neovim-sidecar && gh release download -R addisonking/obsidian-neovim-sidecar -D .obsidian/plugins/neovim-sidecar -p '*' --clobber
```

then enable the plugin in obsidian settings.

## watch

[Obsidian-neovim-sidecar-demo.webm](https://github.com/user-attachments/assets/e97738cd-ba99-4131-9494-b8190fa4e780)

> as of 1.10.0 cursor sync is built in, so you no longer need
> [obsidian-bridge.nvim](https://github.com/oflisback/obsidian-bridge.nvim) for it.
> that plugin also needs the local rest api plugin; this one talks to neovim directly.
