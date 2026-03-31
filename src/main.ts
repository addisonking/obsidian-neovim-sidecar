import { Notice, Plugin, TFile } from 'obsidian';
import { exec, execSync } from 'child_process';
import { existsSync } from 'fs';
import { DEFAULT_SETTINGS, NeovimSidecarSettings, NeovimSidecarSettingTab } from './settings';
import { CopilotContext } from './copilot-context';

const SESSION_NAME = 'obsidian-neovim-sidecar';
const SHELL = '/bin/zsh';
const TEXT_FILE_EXTENSIONS = new Set([
	'md',
	'markdown',
	'txt',
	'json',
	'yaml',
	'yml',
	'toml',
	'ini',
	'csv',
	'tsv',
	'js',
	'ts',
	'jsx',
	'tsx',
	'css',
	'scss',
	'html',
	'xml',
	'sh',
	'bash',
	'zsh',
	'py',
	'go',
	'rs',
	'java',
	'c',
	'h',
	'cpp',
	'hpp',
	'sql',
	'log',
]);

export default class NeovimSidecarPlugin extends Plugin {
	settings: NeovimSidecarSettings;
	private currentFile: string | null = null;
	private sessionActive = false;
	private copilotContext: CopilotContext | null = null;
	private contextUpdateTimer: ReturnType<typeof setTimeout> | null = null;

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

		this.addCommand({
			id: 'toggle-copilot-context',
			name: 'Toggle Copilot backlink context',
			callback: () => {
				this.settings.copilotContext = !this.settings.copilotContext;
				this.saveSettings();
				this.onCopilotContextToggled(this.settings.copilotContext);
			},
		});

		if (this.settings.copilotContext) {
			this.copilotContext = new CopilotContext(this.app);
		}

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (this.sessionActive) {
					if (file && this.isTextFile(file)) {
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

		if (this.settings.openOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				const file = this.app.workspace.getActiveFile();
				this.startSession(file);
			});
		}
	}

	private handleBeforeUnload = () => {
		this.killSession();
	};

	onunload() {
		window.removeEventListener('beforeunload', this.handleBeforeUnload);
		this.cleanupCopilotContext();
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

	onCopilotContextToggled(enabled: boolean) {
		if (enabled) {
			this.copilotContext = new CopilotContext(this.app);
			const file = this.app.workspace.getActiveFile();
			if (file && this.sessionActive) {
				this.debouncedContextUpdate(file);
			}
			new Notice('Copilot backlink context enabled');
		} else {
			this.cleanupCopilotContext();
			new Notice('Copilot backlink context disabled');
		}
	}

	private debouncedContextUpdate(file: TFile) {
		if (this.contextUpdateTimer) {
			clearTimeout(this.contextUpdateTimer);
		}
		this.contextUpdateTimer = setTimeout(() => {
			this.updateCopilotContext(file);
			this.contextUpdateTimer = null;
		}, 300);
	}

	private async updateCopilotContext(file: TFile) {
		if (!this.copilotContext || !this.sessionActive) return;

		try {
			await this.copilotContext.updateContext(file);
			this.loadContextBufferInNvim();
			console.debug('[neovim-sidecar] Copilot context updated for:', file.basename);
		} catch (e) {
			console.error('[neovim-sidecar] Failed to update copilot context:', e);
		}
	}

	private loadContextBufferInNvim() {
		if (!this.copilotContext || !this.isSessionRunning()) return;

		const contextFile = this.copilotContext.getContextFileName();
		const tmux = this.findTmuxPath();

		exec(
			`${tmux} send-keys -t ${SESSION_NAME} Escape ":badd ${contextFile} | checktime" Enter`,
			{ shell: SHELL },
			(error) => {
				if (error) {
					console.debug('[neovim-sidecar] Failed to load context buffer:', error);
				}
			}
		);
	}

	private unloadContextBufferFromNvim() {
		if (!this.copilotContext || !this.isSessionRunning()) return;

		const contextFile = this.copilotContext.getContextFileName();
		const tmux = this.findTmuxPath();

		exec(
			`${tmux} send-keys -t ${SESSION_NAME} Escape ":silent! bdelete ${contextFile}" Enter`,
			{ shell: SHELL }
		);
	}

	private cleanupCopilotContext() {
		if (this.contextUpdateTimer) {
			clearTimeout(this.contextUpdateTimer);
			this.contextUpdateTimer = null;
		}
		if (this.copilotContext) {
			this.unloadContextBufferFromNvim();
			this.copilotContext.cleanup();
			this.copilotContext = null;
		}
	}

	private toggleSession() {
		const sessionRunning = this.isSessionRunning();

		if (this.sessionActive && sessionRunning) {
			if (!this.isClientAttached()) {
				const terminal = this.settings.terminal.toLowerCase().trim();
				this.openTerminal(terminal);
				new Notice('Neovim session reattached');
				return;
			}
			this.killSession();
			new Notice('Neovim session closed');
		} else {
			if (sessionRunning) {
				this.killSession();
			}
			if (!sessionRunning) {
				this.sessionActive = false;
			}
			const file = this.app.workspace.getActiveFile();
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

	private isClientAttached(): boolean {
		try {
			const tmux = this.findTmuxPath();
			const result = execSync(`${tmux} list-clients -t ${SESSION_NAME} 2>/dev/null`, {
				shell: SHELL,
				encoding: 'utf-8',
			}).trim();
			return result.length > 0;
		} catch {
			return false;
		}
	}

	private startSession(file: TFile | null) {
		const initialFile = file && this.isTextFile(file) ? file : null;
		const filePath = initialFile ? this.getAbsolutePath(initialFile) : null;

		const nvim = this.settings.nvimPath || this.findNvimPath();
		const tmux = this.findTmuxPath();
		const terminal = this.settings.terminal.toLowerCase().trim();

		const vaultPath = this.getVaultPath();
		const escapedVaultPath = vaultPath ? vaultPath.replace(/'/g, "'\\''") : '';

		console.debug('[neovim-sidecar] startSession:', {
			filePath,
			nvim,
			tmux,
			terminal,
			vaultPath,
			nvimExists: existsSync(nvim),
			tmuxExists: existsSync(tmux),
		});

		if (this.isSessionRunning()) {
			console.debug('[neovim-sidecar] killing existing session');
			execSync(`${tmux} kill-session -t ${SESSION_NAME}`, { shell: SHELL });
		}

		const cdCmd = vaultPath ? `cd '${escapedVaultPath}' && ` : '';
		let fileArg = '';
		if (filePath) {
			const escapedPath = filePath.replace(/'/g, "'\\''");
			const escapedPathDQ = escapedPath.replace(/"/g, '\\\\\\"');
			fileArg = ` \\"${escapedPathDQ}\\"`;
		}
		const innerCmd = `${cdCmd}${nvim} -c \\"set wrap linebreak\\"${fileArg}`;
		const tmuxCmd = `${tmux} new-session -d -s ${SESSION_NAME} "${SHELL} -li -c '${innerCmd}'"`;

		console.debug('[neovim-sidecar] tmux command:', tmuxCmd);

		exec(tmuxCmd, { shell: SHELL }, (error, stdout, stderr) => {
			if (error) {
				console.error('[neovim-sidecar] tmux new-session failed:', error.message);
				console.error('[neovim-sidecar] stderr:', stderr);
				new Notice('Failed to start Neovim session');
				return;
			}

			if (stdout) console.debug('[neovim-sidecar] tmux stdout:', stdout);
			if (stderr) console.warn('[neovim-sidecar] tmux stderr:', stderr);

			const running = this.isSessionRunning();
			console.debug('[neovim-sidecar] session created, isRunning:', running);

			if (!running) {
				console.error('[neovim-sidecar] tmux session was created but immediately exited');
				new Notice('Neovim session failed to start (exited immediately)');
				return;
			}

			this.currentFile = filePath;
			this.sessionActive = true;
			this.openTerminal(terminal);
			new Notice('Neovim session started');

			if (this.copilotContext && initialFile) {
				this.debouncedContextUpdate(initialFile);
			}
		});
	}

	private openTerminal(terminal: string) {
		const tmux = this.findTmuxPath();
		const attachCmd = `${tmux} attach-session -t ${SESSION_NAME}`;
		const cmd = this.getTerminalCommand(terminal, attachCmd);

		console.debug('[neovim-sidecar] opening terminal:', cmd);
		exec(cmd, (error, stdout, stderr) => {
			if (error) {
				console.error('[neovim-sidecar] terminal open error:', error.message);
				console.error('[neovim-sidecar] terminal stderr:', stderr);
			}
			if (stdout) console.debug('[neovim-sidecar] terminal stdout:', stdout);
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
		if (!this.isTextFile(file)) {
			this.showEmptyBuffer();
			return;
		}

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

		if (this.copilotContext) {
			this.debouncedContextUpdate(file);
		}
	}

	private showEmptyBuffer() {
		if (!this.isSessionRunning()) return;
		const tmux = this.findTmuxPath();
		exec(`${tmux} send-keys -t ${SESSION_NAME} Escape ":enew" Enter`, { shell: SHELL });
		this.currentFile = null;
	}

	private killSession() {
		if (this.copilotContext) {
			this.copilotContext.cleanup();
		}
		if (this.contextUpdateTimer) {
			clearTimeout(this.contextUpdateTimer);
			this.contextUpdateTimer = null;
		}
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

	private isTextFile(file: TFile): boolean {
		return TEXT_FILE_EXTENSIONS.has(file.extension.toLowerCase());
	}

	private getVaultPath(): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (adapter.getBasePath) {
			return adapter.getBasePath();
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
