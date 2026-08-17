import { execFile } from 'node:child_process';
import { type FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { MarkdownView, type Plugin, TFile } from 'obsidian';
import { buildSidecarLua, CURSOR_FILE, CURSOR_SYNC_PATHS, SUPPRESS_MS } from './sidecar-lua';

export const setSidecarLineEffect = StateEffect.define<number>();

const sidecarLineField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(decorations, tr) {
		let nextDeco = decorations.map(tr.changes);
		for (const effect of tr.effects) {
			if (effect.is(setSidecarLineEffect)) {
				if (effect.value <= 0 || effect.value > tr.state.doc.lines) {
					nextDeco = Decoration.none;
				} else {
					const line = tr.state.doc.line(effect.value);
					nextDeco = Decoration.set([
						Decoration.line({
							class: 'cm-neovim-sidecar-active-line',
						}).range(line.from),
					]);
				}
			}
		}
		return nextDeco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

interface CursorSyncDeps {
	plugin: Plugin;
	getNvimPath: () => string;
	getActiveFilePath: () => string | null;
	getVaultPath: () => string | null;
	setCurrentFile: (path: string | null) => void;
}

export class CursorSync {
	private watcher: FSWatcher | null = null;
	private suppressUntil = 0;
	private pushRaf: number | null = null;
	private pendingLine: number | null = null;
	private lastLine = -1;
	private running = false;

	constructor(private readonly deps: CursorSyncDeps) {}

	/** Registered once at load; stays inert until start() is called. */
	editorExtension(): Extension {
		return [
			sidecarLineField,
			EditorView.updateListener.of((update) => {
				if (!update.selectionSet) return;
				const head = update.state.selection.main.head;
				this.onObsidianCursorMoved(update.state.doc.lineAt(head).number);
			}),
			EditorView.domEventHandlers({
				scroll: (_event, view) => {
					this.handleObsidianScroll(view);
				},
			}),
		];
	}

	handleObsidianScroll(view: EditorView) {
		if (!this.running) return;
		try {
			const midY = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight / 2;
			const block = view.lineBlockAtHeight(midY);
			const line = view.state.doc.lineAt(block.from).number;
			this.onObsidianCursorMoved(line);
		} catch {
			const line = view.state.doc.lineAt(view.viewport.from).number;
			this.onObsidianCursorMoved(line);
		}
	}

	private onWindowScroll = (event: Event) => {
		if (!this.running) return;
		const target = event.target as HTMLElement | null;
		if (
			!target ||
			typeof target.className !== 'string' ||
			!target.className.includes('cm-scroller')
		) {
			return;
		}
		const view = this.deps.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.getMode() !== 'source') return;
		const cm = (view.editor as unknown as { cm?: EditorView }).cm;
		if (cm) {
			this.handleObsidianScroll(cm);
		}
	};

	/** Writes the Lua half and returns the path for the caller to :luafile. */
	prepare(cursorSync = false, autosave = false): string | null {
		try {
			mkdirSync(CURSOR_SYNC_PATHS.dir, { recursive: true });
			const vaultPath = this.deps.getVaultPath() ?? '';
			writeFileSync(
				CURSOR_SYNC_PATHS.lua,
				buildSidecarLua(vaultPath, cursorSync, autosave),
				'utf-8'
			);
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
			window.addEventListener('scroll', this.onWindowScroll, {
				capture: true,
				passive: true,
			});
			this.running = true;
		} catch (error) {
			console.error('[neovim-sidecar] Failed to watch cursor file:', error);
		}
	}

	stop() {
		this.watcher?.close();
		this.watcher = null;
		window.removeEventListener('scroll', this.onWindowScroll, {
			capture: true,
		} as EventListenerOptions);
		this.running = false;
		this.lastLine = -1;
		if (this.pushRaf !== null) {
			window.cancelAnimationFrame(this.pushRaf);
			this.pushRaf = null;
		}
		this.pendingLine = null;

		const view = this.deps.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = (view?.editor as unknown as { cm?: EditorView })?.cm;
		if (cm) {
			cm.dispatch({ effects: setSidecarLineEffect.of(0) });
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

	private async applyToObsidian(path: string, line: number) {
		if (Date.now() < this.suppressUntil) return;

		const currentActive = this.deps.getActiveFilePath();
		if (currentActive !== path) {
			const vaultPath = this.deps.getVaultPath();
			if (!vaultPath || !path.startsWith(vaultPath)) return;

			const relPath = path.slice(vaultPath.length).replace(/^\/+/, '');
			const file = this.deps.plugin.app.vault.getAbstractFileByPath(relPath);
			if (file instanceof TFile) {
				this.suppressUntil = Date.now() + SUPPRESS_MS;
				this.deps.setCurrentFile(path);
				const leaf = this.deps.plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file);
				this.applyCursorPosition(line);
			}
			return;
		}

		this.applyCursorPosition(line);
	}

	private applyCursorPosition(line: number) {
		const view = this.deps.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.getMode() !== 'source') return;

		const editor = view.editor;
		const target = Math.min(Math.max(line - 1, 0), editor.lastLine());
		const pos = { line: target, ch: 0 };

		const cm = (editor as unknown as { cm?: EditorView }).cm;
		if (cm) {
			cm.dispatch({
				effects: setSidecarLineEffect.of(line),
			});
		}

		if (editor.getCursor().line !== target) {
			this.suppressUntil = Date.now() + SUPPRESS_MS;
			this.lastLine = target + 1;
			editor.setCursor(pos);
		}
		editor.scrollIntoView({ from: pos, to: pos }, true);
	}

	private onObsidianCursorMoved(line: number) {
		if (!this.running) return;
		if (Date.now() < this.suppressUntil) return;
		if (line === this.lastLine) return;

		this.pendingLine = line;
		if (this.pushRaf !== null) return;

		this.pushRaf = window.requestAnimationFrame(() => {
			this.pushRaf = null;
			if (this.pendingLine !== null && this.pendingLine !== this.lastLine) {
				const target = this.pendingLine;
				this.lastLine = target;
				this.pushToNvim(target);
			}
		});
	}

	private pushToNvim(line: number) {
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
