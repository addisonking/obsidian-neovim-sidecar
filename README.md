# obsidian-neovim-sidecar

opens the current obsidian file in neovim via a tmux session in your terminal emulator.

## requirements

- neovim
- tmux
- one supported terminal emulator

## supported platforms and terminals

- macOS: auto, Alacritty, kitty, WezTerm, iTerm2, Terminal.app
- Linux: auto, Alacritty, kitty, WezTerm, GNOME Terminal, Konsole, Xfce Terminal, xterm

## usage

click the ribbon icon or run the command "toggle neovim session" to start/stop.

configure your preferred terminal in plugin settings.

## install

run this in your vault directory:

```sh
mkdir -p .obsidian/plugins/obsidian-neovim-sidecar && gh release download -R addisonking/obsidian-neovim-sidecar -D .obsidian/plugins/obsidian-neovim-sidecar -p '*' --clobber
```

then enable the plugin in obsidian settings.

## watch

[Obsidian-neovim-sidecar-demo.webm](https://github.com/user-attachments/assets/e97738cd-ba99-4131-9494-b8190fa4e780)

> works nice with https://github.com/oflisback/obsidian-bridge.nvim?tab=readme-ov-file#scroll-sync-of-buffer-scrolling
