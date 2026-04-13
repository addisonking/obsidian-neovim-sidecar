import { App, PluginSettingTab, Setting } from 'obsidian';
import NeovimSidecarPlugin from './main';
import {
	getRuntimePlatform,
	getTerminalOptionsForPlatform,
	normalizeTerminalId,
} from './terminal-launcher';

export interface NeovimSidecarSettings {
	terminal: string;
	nvimPath: string;
	openOnStartup: boolean;
	autosave: boolean;
}

export const DEFAULT_SETTINGS: NeovimSidecarSettings = {
	terminal: 'auto',
	nvimPath: 'nvim',
	openOnStartup: false,
	autosave: false,
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
		const terminalOptions = getTerminalOptionsForPlatform(getRuntimePlatform());
		const terminalValue = normalizeTerminalId(this.plugin.settings.terminal);

		new Setting(containerEl)
			.setName('Terminal')
			.setDesc('Choose the terminal used to attach to the tmux sidecar session')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(
						Object.fromEntries(
							terminalOptions.map((option) => [option.id, option.label])
						)
					)
					.setValue(terminalValue)
					.onChange(async (value) => {
						this.plugin.settings.terminal = normalizeTerminalId(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Neovim path')
			.setDesc('Path to editor executable (nvim recommended, vim and nano supported)')
			.addText((text) =>
				text
					.setPlaceholder('/usr/local/bin/nvim')
					.setValue(this.plugin.settings.nvimPath)
					.onChange(async (value) => {
						this.plugin.settings.nvimPath = value || 'nvim';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Open on startup')
			.setDesc('Open Neovim automatically on startup')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Autosave in Neovim')
			.setDesc('Save automatically for real-time preview')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autosave).onChange(async (value) => {
					this.plugin.settings.autosave = value;
					await this.plugin.saveSettings();
					this.plugin.onAutosaveToggled(value);
				})
			);
	}
}
