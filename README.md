# obsidian-neovim-sidecar

opens the current obsidian file in neovim via a tmux session in alacritty.

## requirements

- neovim
- tmux
- alacritty

## usage

click the ribbon icon or run the command "toggle neovim session" to start/stop.

## install

run this in your vault directory:

```sh
mkdir -p .obsidian/plugins/obsidian-neovim-sidecar && cd .obsidian/plugins/obsidian-neovim-sidecar && curl -LO https://github.com/addisonking/obsidian-neovim-sidecar/releases/latest/download/main.js && curl -LO https://github.com/addisonking/obsidian-neovim-sidecar/releases/latest/download/manifest.json && curl -LO https://github.com/addisonking/obsidian-neovim-sidecar/releases/latest/download/styles.css
```

then enable the plugin in obsidian settings.
