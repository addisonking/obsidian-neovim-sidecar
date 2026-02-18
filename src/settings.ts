import { App, PluginSettingTab, Setting } from 'obsidian';
import NeovimSidecarPlugin from './main';

export interface NeovimSidecarSettings {
	terminal: string;
	nvimPath: string;
}

export const DEFAULT_SETTINGS: NeovimSidecarSettings = {
	terminal: '',
	nvimPath: 'nvim',
};

export class NeovimSidecarSettingTab extends PluginSettingTab {
	plugin: NeovimSidecarPlugin;

	constructor(app: App, plugin: NeovimSidecarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Terminal')
			.setDesc('Only Alacritty is currently supported')
			.addText((text) =>
				text
					.setPlaceholder('Alacritty')
					.setValue(this.plugin.settings.terminal)
					.onChange(async (value) => {
						this.plugin.settings.terminal = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Neovim path')
			.setDesc('Path to nvim executable')
			.addText((text) =>
				text
					.setPlaceholder('/usr/local/bin/nvim')
					.setValue(this.plugin.settings.nvimPath)
					.onChange(async (value) => {
						this.plugin.settings.nvimPath = value || 'nvim';
						await this.plugin.saveSettings();
					})
			);
	}
}
