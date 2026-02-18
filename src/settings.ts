import {App, PluginSettingTab, Setting} from "obsidian";
import NeovimSidecarPlugin from "./main";

export interface NeovimSidecarSettings {
	terminal: string;
	nvimPath: string;
}

export const DEFAULT_SETTINGS: NeovimSidecarSettings = {
	terminal: '',
	nvimPath: 'nvim'
}

export class NeovimSidecarSettingTab extends PluginSettingTab {
	plugin: NeovimSidecarPlugin;

	constructor(app: App, plugin: NeovimSidecarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Obsidian Neovim Sidecar Settings'});

		new Setting(containerEl)
			.setName('Terminal')
			.setDesc('Terminal to use (currently only alacritty is supported)')
			.addText(text => text
				.setPlaceholder('alacritty')
				.setValue(this.plugin.settings.terminal)
				.onChange(async (value) => {
					this.plugin.settings.terminal = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Neovim path')
			.setDesc('Path to nvim executable (default: nvim)')
			.addText(text => text
				.setPlaceholder('nvim')
				.setValue(this.plugin.settings.nvimPath)
				.onChange(async (value) => {
					this.plugin.settings.nvimPath = value || 'nvim';
					await this.plugin.saveSettings();
				}));
	}
}
