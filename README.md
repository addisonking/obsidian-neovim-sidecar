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
mkdir -p .obsidian/plugins/obsidian-neovim-sidecar && gh release download -R addisonking/obsidian-neovim-sidecar -D .obsidian/plugins/obsidian-neovim-sidecar -p '*'
```

then enable the plugin in obsidian settings.
