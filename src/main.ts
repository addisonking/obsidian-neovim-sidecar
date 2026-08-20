import { exec, execFile, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Notice, Plugin, TFile } from 'obsidian';
import { CursorSync } from './cursor-sync';
import { DEFAULT_SETTINGS, type NeovimSidecarSettings, NeovimSidecarSettingTab } from './settings';
import { CURSOR_SYNC_PATHS } from './sidecar-lua';
import {
	buildTerminalLaunchSpec,
	getRuntimePlatform,
	normalizeTerminalId,
	SIDECAR_WINDOW_TITLE,
} from './terminal-launcher';
import {
	buildTileWindowsScript,
	getTerminalProcessName,
	isAccessibilityError,
} from './window-tiler';

const SESSION_NAME = 'obsidian-neovim-sidecar';
const RUNTIME_PROCESS = (
	globalThis as { process?: { platform?: string; env?: Record<string, string | undefined> } }
).process;
const PLATFORM = getRuntimePlatform();
const SHELL_ENV = RUNTIME_PROCESS?.env?.SHELL;
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
	private readonly shellPath = SHELL_ENV || (PLATFORM === 'linux' ? '/bin/bash' : '/bin/zsh');
	private currentFile: string | null = null;
	private sessionActive = false;
	private lastTerminalAppName: string | null = null;
	private cursorSync: CursorSync;

	async onload() {
		await this.loadSettings();

		this.cursorSync = new CursorSync({
			plugin: this,
			getNvimPath: () => this.resolveNvimPath(),
			getActiveFilePath: () => {
				const file = this.app.workspace.getActiveFile();
				return file ? this.getAbsolutePath(file) : null;
			},
			getVaultPath: () => this.getVaultPath(),
			setCurrentFile: (path: string | null) => {
				this.currentFile = path;
			},
		});

		this.registerEditorExtension(this.cursorSync.editorExtension());

		this.addRibbonIcon('file-code', 'Open in Neovim', () => {
			this.toggleSession();
		});

		this.addCommand({
			id: 'toggle-neovim-session',
			name: 'Toggle Neovim session',
			callback: () => this.toggleSession(),
		});

		this.addCommand({
			id: 'restart-neovim-session',
			name: 'Restart Neovim session',
			callback: () => this.restartSession(),
		});

		this.addCommand({
			id: 'tile-windows',
			name: 'Tile windows side by side',
			callback: () => this.tileWindows(this.lastTerminalAppName),
		});

		this.addCommand({
			id: 'toggle-autosave',
			name: 'Toggle autosave',
			callback: () => {
				this.settings.autosave = !this.settings.autosave;
				this.saveSettings();
				this.onAutosaveToggled(this.settings.autosave);
			},
		});

		this.addCommand({
			id: 'toggle-cursor-sync',
			name: 'Toggle cursor sync',
			callback: () => {
				this.settings.cursorSync = !this.settings.cursorSync;
				this.saveSettings();
				this.onCursorSyncToggled(this.settings.cursorSync);
			},
		});

		this.addSettingTab(new NeovimSidecarSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (this.isSessionRunning()) {
					if (file) {
						this.switchToFile(file);
					} else {
						this.showEmptyBuffer();
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (this.isSessionRunning() && file instanceof TFile) {
					this.handleFileDeleted(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (this.isSessionRunning() && file instanceof TFile) {
					this.handleFileRenamed(file, oldPath);
				}
			})
		);

		window.addEventListener('beforeunload', this.handleBeforeUnload);

		if (this.settings.openOnStartup) {
			this.app.workspace.onLayoutReady(() => {
				this.startSession();
			});
		}
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

	onAutosaveToggled(enabled: boolean) {
		this.configureAutosaveInEditor(enabled);
		new Notice(enabled ? 'Autosave enabled' : 'Autosave disabled');
	}

	onCursorSyncToggled(enabled: boolean) {
		if (enabled && !this.sessionActive) {
			new Notice('Cursor sync enabled (starts with session)');
			return;
		}

		this.configureCursorSyncInEditor(enabled);
		new Notice(enabled ? 'Cursor sync enabled' : 'Cursor sync disabled');
	}

	private configureCursorSyncInEditor(enabled: boolean) {
		if (!this.isSessionRunning()) return;

		if (!enabled) {
			this.cursorSync.stop();
			this.sendNvimRpcExpr('v:lua.ObsidianSidecarSetCursorSync(0)');
			return;
		}

		this.cursorSync.prepare(this.settings.cursorSync, this.settings.autosave);
		this.sendNvimRpcExpr('v:lua.ObsidianSidecarSetCursorSync(1)', (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to configure cursor sync:', error);
				return;
			}
			this.cursorSync.start();
		});
	}

	private configureAutosaveInEditor(enabled: boolean) {
		if (!this.isSessionRunning()) return;
		this.sendNvimRpcExpr(`v:lua.ObsidianSidecarSetAutosave(${enabled ? 1 : 0})`, (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to configure autosave:', error);
			}
		});
	}

	private sendNvimRpcExpr(
		expr: string,
		callback?: (error: Error | null, result?: string) => void
	) {
		const nvim = this.resolveNvimPath();
		const args = ['--server', CURSOR_SYNC_PATHS.socket, '--remote-expr', expr];
		execFile(nvim, args, (error, stdout) => {
			if (callback) {
				callback(error, stdout ? stdout.trim() : undefined);
			}
		});
	}

	private toggleSession() {
		const sessionRunning = this.isSessionRunning();

		if (this.sessionActive && sessionRunning) {
			if (!this.isClientAttached()) {
				const terminal = normalizeTerminalId(this.settings.terminal);
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

	private restartSession() {
		this.killSession();
		this.startSession(this.app.workspace.getActiveFile());
		new Notice('Neovim session restarted');
	}

	private isSessionRunning(): boolean {
		try {
			const tmux = this.findTmuxPath();
			execSync(`${tmux} has-session -t ${SESSION_NAME} 2>/dev/null`, {
				shell: this.shellPath,
			});
			return true;
		} catch {
			return false;
		}
	}

	private isClientAttached(): boolean {
		try {
			const tmux = this.findTmuxPath();
			const result = execSync(`${tmux} list-clients -t ${SESSION_NAME} 2>/dev/null`, {
				shell: this.shellPath,
				encoding: 'utf-8',
			}).trim();
			return result.length > 0;
		} catch {
			return false;
		}
	}

	private startSession(file: TFile | null = null) {
		const targetFile = file || this.app.workspace.getActiveFile();
		const initialFile = targetFile && this.isTextFile(targetFile) ? targetFile : null;
		const filePath = initialFile ? this.getAbsolutePath(initialFile) : null;

		const editor = this.resolveNvimPath();
		const tmux = this.findTmuxPath();
		const terminal = normalizeTerminalId(this.settings.terminal);

		const vaultPath = this.getVaultPath();
		const escapedVaultPath = vaultPath ? vaultPath.replace(/'/g, "'\\''") : '';

		console.debug('[neovim-sidecar] startSession:', {
			filePath,
			editor,
			tmux,
			terminal,
			vaultPath,
			editorExists: existsSync(editor),
			tmuxExists: existsSync(tmux),
		});

		if (this.isSessionRunning()) {
			console.debug('[neovim-sidecar] killing existing session');
			execSync(`${tmux} kill-session -t ${SESSION_NAME}`, { shell: this.shellPath });
		}

		let luaArg = '';
		const luaPath = this.cursorSync.prepare(this.settings.cursorSync, this.settings.autosave);
		if (luaPath) {
			const escapedLua = luaPath.replace(/'/g, "'\\''");
			luaArg = ` -c \\"luafile '${escapedLua}'\\"`;
		}

		const cdCmd = vaultPath ? `cd '${escapedVaultPath}' && ` : '';
		let fileArg = '';
		if (filePath) {
			const escapedPath = filePath.replace(/'/g, "'\\''");
			const escapedPathDQ = escapedPath.replace(/"/g, '\\\\\\"');
			fileArg = ` \\"${escapedPathDQ}\\"`;
		}
		const editorArgs = ` --listen \\"${CURSOR_SYNC_PATHS.socket}\\" -c \\"set wrap linebreak\\"`;
		const innerCmd = `${cdCmd}${editor}${editorArgs}${luaArg}${fileArg}`;
		const tmuxCmd = `${tmux} new-session -d -s ${SESSION_NAME} "${this.shellPath} -li -c '${innerCmd}'"`;

		console.debug('[neovim-sidecar] tmux command:', tmuxCmd);

		exec(tmuxCmd, { shell: this.shellPath }, (error, stdout, stderr) => {
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
			if (this.settings.cursorSync) {
				this.cursorSync.start();
			}
			this.openTerminal(terminal);
			new Notice('Neovim session started');
		});
	}

	private openTerminal(terminal: string) {
		const tmux = this.findTmuxPath();
		const attachCmd = `exec ${tmux} attach-session -t ${SESSION_NAME}`;
		const launchSpec = buildTerminalLaunchSpec({
			platform: PLATFORM,
			terminal,
			shellPath: this.shellPath,
			attachCommand: attachCmd,
		});

		if (!launchSpec) {
			new Notice('Unsupported platform or terminal. Check plugin settings.');
			return;
		}

		this.lastTerminalAppName = launchSpec.macAppName;
		console.debug('[neovim-sidecar] opening terminal:', launchSpec.command);
		exec(launchSpec.command, { shell: this.shellPath }, (error, stdout, stderr) => {
			if (error) {
				console.error('[neovim-sidecar] terminal open error:', error.message);
				console.error('[neovim-sidecar] terminal stderr:', stderr);
				new Notice('Failed to launch terminal. Check plugin settings.');
			}
			if (stdout) console.debug('[neovim-sidecar] terminal stdout:', stdout);
			setTimeout(() => {
				this.focusTerminal(launchSpec.macAppName);
				this.tileWindows(launchSpec.macAppName);
			}, 300);
		});
	}

	private focusTerminal(appName: string | null) {
		if (PLATFORM !== 'darwin' || !appName) {
			return;
		}
		exec(`osascript -e 'tell application "${appName}" to activate'`);
	}

	onTileSettingsChanged() {
		if (!this.sessionActive || !this.isSessionRunning() || !this.isClientAttached()) {
			return;
		}
		this.tileWindows(this.lastTerminalAppName);
	}

	private tileWindows(appName: string | null) {
		if (PLATFORM !== 'darwin' || !appName || !this.settings.tileWindows) {
			return;
		}

		const script = buildTileWindowsScript(
			getTerminalProcessName(appName),
			this.settings.tileSide
		);
		const command = `osascript -e '${script.replace(/'/g, "'\\''")}'`;

		console.debug('[neovim-sidecar] tiling windows:', command);
		exec(command, (error, _stdout, stderr) => {
			if (!error) return;
			console.error('[neovim-sidecar] tiling failed:', error.message, stderr);
			if (isAccessibilityError(`${error.message} ${stderr}`)) {
				new Notice(
					'Window tiling needs accessibility permission. Grant it under privacy and security settings, then try again.',
					10000
				);
			} else {
				new Notice('Failed to tile windows. See console for details.');
			}
		});
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

		const expr = `v:lua.ObsidianSidecarOpenFile('${filePath.replace(/'/g, "''")}')`;
		this.sendNvimRpcExpr(expr, (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to switch file via RPC:', error);
			} else {
				this.currentFile = filePath;
				console.debug('[neovim-sidecar] Switched to:', filePath);
			}
		});
	}

	private showEmptyBuffer() {
		if (!this.isSessionRunning()) return;
		this.sendNvimRpcExpr('v:lua.ObsidianSidecarShowEmptyBuffer()', (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to show empty buffer via RPC:', error);
			} else {
				this.currentFile = null;
			}
		});
	}

	private handleFileDeleted(file: TFile) {
		const filePath = this.getAbsolutePath(file);
		if (!filePath) return;

		if (this.currentFile === filePath) {
			this.currentFile = null;
		}

		const expr = `v:lua.ObsidianSidecarCloseFile('${filePath.replace(/'/g, "''")}')`;
		this.sendNvimRpcExpr(expr);
	}

	private handleFileRenamed(file: TFile, oldPath: string) {
		const newPath = this.getAbsolutePath(file);
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		const basePath = adapter.getBasePath ? adapter.getBasePath() : null;
		const oldFullPath = basePath ? `${basePath}/${oldPath}` : null;
		if (!newPath || !oldFullPath) return;

		if (this.currentFile === oldFullPath) {
			this.currentFile = newPath;
		}

		const expr = `v:lua.ObsidianSidecarRenameFile('${oldFullPath.replace(/'/g, "''")}', '${newPath.replace(/'/g, "''")}')`;
		this.sendNvimRpcExpr(expr);
	}

	private killSession() {
		if (this.isSessionRunning()) {
			const tmux = this.findTmuxPath();
			try {
				execSync(`${tmux} kill-session -t ${SESSION_NAME}`, { shell: this.shellPath });
			} catch (e) {
				console.error('[neovim-sidecar] Failed to kill session:', e);
			}
		}
		if (this.lastTerminalAppName) {
			this.closeTerminalWindow(this.lastTerminalAppName);
		}
		this.cursorSync.stop();
		this.sessionActive = false;
		this.currentFile = null;
	}

	private closeTerminalWindow(appName: string) {
		if (PLATFORM !== 'darwin' || !appName) return;
		const script = `
tell application "System Events"
	if exists (application process "${appName}") then
		tell application process "${appName}"
			repeat with w in (every window whose name contains "${SIDECAR_WINDOW_TITLE}")
				try
					close w
				end try
			end repeat
		end tell
	end if
end tell
		`.trim();
		try {
			exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
		} catch {}
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

	private resolveNvimPath(): string {
		const configured = this.settings.nvimPath?.trim();
		if (!configured) {
			return this.findNvimPath();
		}
		if (configured.includes('/')) {
			return existsSync(configured) ? configured : this.findNvimPath();
		}
		return configured;
	}

	private findTmuxPath(): string {
		const paths = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
		for (const p of paths) {
			if (existsSync(p)) return p;
		}
		return 'tmux';
	}
}
