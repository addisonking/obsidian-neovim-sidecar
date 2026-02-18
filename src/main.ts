import { Notice, Plugin, TFile } from 'obsidian';
import { exec, execSync } from 'child_process';
import { existsSync } from 'fs';
import { DEFAULT_SETTINGS, NeovimSidecarSettings, NeovimSidecarSettingTab } from './settings';

const SESSION_NAME = 'obsidian-neovim-sidecar';
const SHELL = '/bin/zsh';

export default class NeovimSidecarPlugin extends Plugin {
	settings: NeovimSidecarSettings;
	private currentFile: string | null = null;
	private sessionActive = false;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('file-code', 'Open in Neovim', () => {
			this.toggleSession();
		});

		window.addEventListener('beforeunload', this.handleBeforeUnload);

		this.addCommand({
			id: 'toggle-neovim-session',
			name: 'Toggle Neovim session',
			callback: () => {
				this.toggleSession();
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (this.sessionActive) {
					if (file) {
						this.switchToFile(file);
					} else {
						this.showEmptyBuffer();
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const file = this.app.workspace.getActiveFile();
				if (this.sessionActive && !file) {
					this.showEmptyBuffer();
				}
			})
		);

		this.addSettingTab(new NeovimSidecarSettingTab(this.app, this));
	}

	private handleBeforeUnload = () => {
		this.killSession();
	};

	onunload() {
		window.removeEventListener('beforeunload', this.handleBeforeUnload);
		this.killSession();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<NeovimSidecarSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private toggleSession() {
		if (this.sessionActive && this.isSessionRunning()) {
			this.killSession();
			new Notice('Neovim session closed');
		} else {
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				new Notice('No file is currently open');
				return;
			}
			this.startSession(file);
		}
	}

	private isSessionRunning(): boolean {
		try {
			const tmux = this.findTmuxPath();
			execSync(`${tmux} has-session -t ${SESSION_NAME} 2>/dev/null`, { shell: SHELL });
			return true;
		} catch {
			return false;
		}
	}

	private startSession(file: TFile) {
		const filePath = this.getAbsolutePath(file);
		if (!filePath) {
			new Notice('Could not determine file path');
			return;
		}

		const nvim = this.settings.nvimPath || this.findNvimPath();
		const tmux = this.findTmuxPath();
		const terminal = this.settings.terminal.toLowerCase().trim();
		const escapedPath = filePath.replace(/'/g, "'\\''");

		if (this.isSessionRunning()) {
			execSync(`${tmux} kill-session -t ${SESSION_NAME}`, { shell: SHELL });
		}

		const tmuxCmd = `${tmux} new-session -d -s ${SESSION_NAME} "${nvim} -c 'set wrap linebreak' '${escapedPath}'"`;

		exec(tmuxCmd, { shell: SHELL }, (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to start tmux session:', error);
				new Notice('Failed to start Neovim session');
				return;
			}

			this.currentFile = filePath;
			this.sessionActive = true;
			this.openTerminal(terminal);
			new Notice('Neovim session started');
		});
	}

	private openTerminal(terminal: string) {
		const tmux = this.findTmuxPath();
		const attachCmd = `${tmux} attach-session -t ${SESSION_NAME}`;
		const cmd = this.getTerminalCommand(terminal, attachCmd);

		console.debug('[neovim-sidecar] Opening terminal:', cmd);
		exec(cmd, () => {
			// focus the terminal window after a short delay to ensure it's open
			setTimeout(() => {
				this.focusTerminal(terminal);
			}, 300);
		});
	}

	private focusTerminal(terminal: string) {
		// use osascript to bring the terminal to the foreground
		const appName = this.getAppName(terminal);
		exec(`osascript -e 'tell application "${appName}" to activate'`);
	}

	private getAppName(terminal: string): string {
		switch (terminal.toLowerCase()) {
			case 'alacritty':
				return 'Alacritty';
			case 'kitty':
				return 'kitty';
			case 'wezterm':
				return 'WezTerm';
			case 'iterm':
			case 'iterm2':
				return 'iTerm';
			default:
				return 'Alacritty';
		}
	}

	private getTerminalCommand(terminal: string, attachCmd: string): string {
		// macOS terminal commands - extend this for other platforms/terminals
		switch (terminal) {
			// case 'alacritty':
			// 	return `open -na Alacritty --args -e ${SHELL} -lc "${attachCmd}"`;
			// Future terminal support:
			// case 'kitty':
			//   return `open -na kitty --args ${SHELL} -lc "${attachCmd}"`;
			// case 'wezterm':
			//   return `open -na WezTerm --args start -- ${SHELL} -lc "${attachCmd}"`;
			default:
				return `open -na Alacritty --args -e ${SHELL} -lc "${attachCmd}"`;
		}
	}

	private switchToFile(file: TFile) {
		const filePath = this.getAbsolutePath(file);
		if (!filePath || filePath === this.currentFile) return;
		if (!this.isSessionRunning()) {
			this.sessionActive = false;
			return;
		}

		const tmux = this.findTmuxPath();
		const escapedPath = filePath.replace(/ /g, '\\ ').replace(/'/g, "\\'");

		exec(
			`${tmux} send-keys -t ${SESSION_NAME} Escape ":e ${escapedPath}" Enter`,
			{ shell: SHELL },
			(error) => {
				if (error) {
					console.debug('[neovim-sidecar] Failed to switch file:', error);
				} else {
					this.currentFile = filePath;
					console.debug('[neovim-sidecar] Switched to:', filePath);
				}
			}
		);
	}

	private showEmptyBuffer() {
		if (!this.isSessionRunning()) return;
		const tmux = this.findTmuxPath();
		exec(`${tmux} send-keys -t ${SESSION_NAME} Escape ":enew" Enter`, { shell: SHELL });
		this.currentFile = null;
	}

	private killSession() {
		if (this.isSessionRunning()) {
			const tmux = this.findTmuxPath();
			try {
				execSync(`${tmux} kill-session -t ${SESSION_NAME}`, { shell: SHELL });
			} catch (e) {
				console.error('[neovim-sidecar] Failed to kill session:', e);
			}
		}
		this.sessionActive = false;
		this.currentFile = null;
	}

	private getAbsolutePath(file: TFile): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (adapter.getBasePath) {
			const basePath = adapter.getBasePath();
			return `${basePath}/${file.path}`;
		}
		return null;
	}

	private findNvimPath(): string {
		const paths = ['/opt/homebrew/bin/nvim', '/usr/local/bin/nvim', '/usr/bin/nvim'];
		for (const p of paths) {
			if (existsSync(p)) return p;
		}
		return 'nvim';
	}

	private findTmuxPath(): string {
		const paths = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
		for (const p of paths) {
			if (existsSync(p)) return p;
		}
		return 'tmux';
	}
}
