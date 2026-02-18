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
mkdir -p .obsidian/plugins/obsidian-neovim-sidecar && gh release download -R addisonking/obsidian-neovim-sidecar -D .obsidian/plugins/obsidian-neovim-sidecar -p '*' --clobber
```

then enable the plugin in obsidian settings.

## watch

https://github.com/user-attachments/assets/6f785211-3b38-4811-b3b7-bd743446d730

> works nice with https://github.com/oflisback/obsidian-bridge.nvim?tab=readme-ov-file#scroll-sync-of-buffer-scrolling
