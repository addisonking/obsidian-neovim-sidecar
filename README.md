# obsidian-neovim-sidecar

opens the current obsidian file in neovim via a tmux session in alacritty.

## requirements

- neovim
- tmux
- alacritty

## usage

click the ribbon icon or run the command "toggle neovim session" to start/stop.

## install

copy `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/obsidian-neovim-sidecar/` in your vault.
or
clone repo to vault plugins directory and run `bun run build`.