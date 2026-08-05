import { execFile } from 'node:child_process';
import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { EditorView } from '@codemirror/view';
import { MarkdownView, type Plugin } from 'obsidian';
import {
	buildSidecarLua,
	CURSOR_FILE,
	CURSOR_SYNC_PATHS,
	DEBOUNCE_MS,
	SUPPRESS_MS,
} from './sidecar-lua';

interface CursorSyncDeps {
	plugin: Plugin;
	getNvimPath: () => string;
	getActiveFilePath: () => string | null;
}

export class CursorSync {
	private watcher: FSWatcher | null = null;
	private suppressUntil = 0;
	private pushTimer: number | null = null;
	private lastLine = -1;
	private running = false;

	constructor(private readonly deps: CursorSyncDeps) {}

	/** Registered once at load; stays inert until start() is called. */
	editorExtension() {
		return EditorView.updateListener.of((update) => {
			if (!update.selectionSet) return;
			const head = update.state.selection.main.head;
			this.onObsidianCursorMoved(update.state.doc.lineAt(head).number);
		});
	}

	/** Writes the Lua half and returns the path for the caller to :luafile. */
	prepare(): string | null {
		try {
			mkdirSync(CURSOR_SYNC_PATHS.dir, { recursive: true });
			writeFileSync(CURSOR_SYNC_PATHS.lua, buildSidecarLua(), 'utf-8');
			return CURSOR_SYNC_PATHS.lua;
		} catch (error) {
			console.error('[neovim-sidecar] Failed to write cursor sync script:', error);
			return null;
		}
	}

	start() {
		if (this.running) return;
		try {
			mkdirSync(CURSOR_SYNC_PATHS.dir, { recursive: true });
			// Watch the directory, not the file: Neovim's writefile replaces the
			// inode, which silently detaches a file-level watch after one update.
			this.watcher = watch(CURSOR_SYNC_PATHS.dir, (_event, filename) => {
				if (filename === CURSOR_FILE) this.readFromNvim();
			});
			this.running = true;
		} catch (error) {
			console.error('[neovim-sidecar] Failed to watch cursor file:', error);
		}
	}

	stop() {
		this.watcher?.close();
		this.watcher = null;
		this.running = false;
		this.lastLine = -1;
		if (this.pushTimer !== null) {
			window.clearTimeout(this.pushTimer);
			this.pushTimer = null;
		}
	}

	private readFromNvim() {
		let raw: string;
		try {
			raw = readFileSync(CURSOR_SYNC_PATHS.cursor, 'utf-8');
		} catch {
			return;
		}

		const [path, lineText] = raw.split('\n');
		const line = Number.parseInt(lineText ?? '', 10);
		if (!path || Number.isNaN(line)) return;
		this.applyToObsidian(path, line);
	}

	private applyToObsidian(path: string, line: number) {
		if (Date.now() < this.suppressUntil) return;
		if (this.deps.getActiveFilePath() !== path) return;

		const view = this.deps.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.getMode() !== 'source') return;

		const editor = view.editor;
		const target = Math.min(Math.max(line - 1, 0), editor.lastLine());
		if (editor.getCursor().line === target) return;

		this.suppressUntil = Date.now() + SUPPRESS_MS;
		this.lastLine = target + 1;
		const pos = { line: target, ch: 0 };
		editor.setCursor(pos);
		editor.scrollIntoView({ from: pos, to: pos }, true);
	}

	private onObsidianCursorMoved(line: number) {
		if (!this.running) return;
		if (Date.now() < this.suppressUntil) return;
		if (line === this.lastLine) return;

		this.lastLine = line;
		if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
		this.pushTimer = window.setTimeout(() => this.pushToNvim(line), DEBOUNCE_MS);
	}

	private pushToNvim(line: number) {
		this.pushTimer = null;
		const path = this.deps.getActiveFilePath();
		if (!path) return;

		// execFile takes an argv array, so the path needs no shell quoting --
		// only Vimscript's own '' escape for single quotes inside a literal.
		const expr = `v:lua.ObsidianSidecarSetCursor(${line}, '${path.replace(/'/g, "''")}')`;
		const args = ['--server', CURSOR_SYNC_PATHS.socket, '--remote-expr', expr];

		execFile(this.deps.getNvimPath(), args, (error) => {
			if (error) {
				console.debug('[neovim-sidecar] Failed to push cursor:', error.message);
			}
		});
	}
}
