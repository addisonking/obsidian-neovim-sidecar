import { App, TFile, CachedMetadata } from 'obsidian';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const CONTEXT_FILENAME = '.obsidian-copilot-context.md';

export class CopilotContext {
	private app: App;
	private contextFilePath: string | null = null;

	constructor(app: App) {
		this.app = app;
	}

	getContextFilePath(): string | null {
		return this.contextFilePath;
	}

	getContextFileName(): string {
		return CONTEXT_FILENAME;
	}

	async updateContext(file: TFile): Promise<void> {
		const vaultPath = this.getVaultPath();
		if (!vaultPath) return;

		this.contextFilePath = `${vaultPath}/${CONTEXT_FILENAME}`;
		const content = await this.buildContextContent(file);
		writeFileSync(this.contextFilePath, content, 'utf-8');
	}

	cleanup(): void {
		if (this.contextFilePath && existsSync(this.contextFilePath)) {
			try {
				unlinkSync(this.contextFilePath);
			} catch (e) {
				console.error('[neovim-sidecar] Failed to clean up context file:', e);
			}
		}
		this.contextFilePath = null;
	}

	private async buildContextContent(file: TFile): Promise<string> {
		const backlinks = this.getBacklinks(file);
		const lines: string[] = [
			`<!-- Copilot Context: Backlinks for "${file.basename}" -->`,
			'<!-- This buffer provides context for AI code completion. Do not edit. -->',
			'',
			`# Context for ${file.basename}`,
			'',
		];

		if (backlinks.length === 0) {
			lines.push('No backlinks found for this note.');
			return lines.join('\n');
		}

		lines.push('## Backlinks', '');

		for (const backlink of backlinks) {
			const excerpts = await this.getExcerpts(backlink, file);
			lines.push(`### [[${backlink.basename}]]`, '');

			if (excerpts.length > 0) {
				for (const excerpt of excerpts) {
					lines.push(`> ${excerpt}`, '');
				}
			} else {
				lines.push(`> (linked from ${backlink.path})`, '');
			}
		}

		return lines.join('\n');
	}

	private getBacklinks(file: TFile): TFile[] {
		const backlinks: TFile[] = [];
		const resolvedLinks = this.app.metadataCache.resolvedLinks;

		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			if (file.path in links) {
				const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
				if (sourceFile instanceof TFile) {
					backlinks.push(sourceFile);
				}
			}
		}

		return backlinks;
	}

	private async getExcerpts(source: TFile, target: TFile): Promise<string[]> {
		const excerpts: string[] = [];

		try {
			const content = await this.app.vault.cachedRead(source);
			const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(source);

			if (!cache?.links) return excerpts;

			const targetLinks = cache.links.filter((link) => {
				const resolved = this.app.metadataCache.getFirstLinkpathDest(
					link.link,
					source.path
				);
				return resolved?.path === target.path;
			});

			const lines = content.split('\n');

			for (const link of targetLinks) {
				const linkLine = link.position.start.line;
				const start = Math.max(0, linkLine - 2);
				const end = Math.min(lines.length, linkLine + 3);
				const excerpt = lines
					.slice(start, end)
					.map((l) => l.trim())
					.filter((l) => l.length > 0)
					.join(' ');

				if (excerpt.length > 0) {
					const truncated =
						excerpt.length > 500 ? excerpt.substring(0, 500) + '...' : excerpt;
					excerpts.push(truncated);
				}
			}
		} catch (e) {
			console.debug('[neovim-sidecar] Failed to read backlink source:', source.path, e);
		}

		return excerpts;
	}

	private getVaultPath(): string | null {
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		if (adapter.getBasePath) {
			return adapter.getBasePath();
		}
		return null;
	}
}
