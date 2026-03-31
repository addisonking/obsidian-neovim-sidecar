import { App, TFile, CachedMetadata } from 'obsidian';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const CONTEXT_FILENAME = '.obsidian-copilot-context.md';

const OBSIDIAN_BEST_PRACTICES = `# Obsidian Writing Guidelines

You are assisting with writing in an Obsidian vault. Follow these conventions:

## Linking

- Use **wikilinks** to connect notes: \`[[Note Name]]\` or \`[[Note Name|display text]]\`
- Link liberally — connections between notes are the core value of Obsidian
- When mentioning a concept that has or should have its own note, link to it
- Use \`[[Note Name#Heading]]\` to link to specific sections
- Use \`[[Note Name^block-id]]\` to link to specific blocks

## Frontmatter

- Use YAML frontmatter at the top of notes for metadata:
  \`\`\`yaml
  ---
  tags:
    - topic
  aliases:
    - alternate name
  date: YYYY-MM-DD
  ---
  \`\`\`
- Tags can also be inline with \`#tag\` syntax

## Structure

- Use markdown headings (\`#\`, \`##\`, \`###\`) to organize content hierarchically
- Keep notes atomic — one idea per note when possible
- Use bullet lists and numbered lists for clarity
- Use callouts for important information: \`> [!note]\`, \`> [!warning]\`, \`> [!tip]\`

## Writing style

- Write in plain, clear language
- Prefer short paragraphs
- When referencing other notes, always use wikilinks rather than plain text
- Maintain consistency with existing note titles and tag conventions in the vault

## Backlinks and context

- Backlinks show which notes reference the current note
- When writing, consider what notes already link here and maintain thematic consistency
- Strengthen the graph by linking back to notes that reference this one when relevant
`;

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
		const sections: string[] = [OBSIDIAN_BEST_PRACTICES];

		sections.push(`---\n`);
		sections.push(`# Current note: ${file.basename}\n`);
		sections.push(`Path: \`${file.path}\`\n`);

		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter) {
			const frontmatter = cache.frontmatter as Record<string, unknown>;
			const tags = frontmatter.tags ?? frontmatter.tag;
			if (tags) {
				const tagList = Array.isArray(tags) ? tags : [tags];
				sections.push(`Tags: ${tagList.map((t: string) => `#${t}`).join(', ')}\n`);
			}
			if (frontmatter.aliases) {
				const aliases = Array.isArray(frontmatter.aliases)
					? frontmatter.aliases
					: [frontmatter.aliases];
				sections.push(`Aliases: ${aliases.join(', ')}\n`);
			}
		}

		const outgoingLinks = this.getOutgoingLinks(file, cache);
		if (outgoingLinks.length > 0) {
			sections.push(`\n## Outgoing links\n`);
			sections.push(
				`This note links to: ${outgoingLinks.map((l) => `[[${l}]]`).join(', ')}\n`
			);
		}

		const backlinks = this.getBacklinks(file);
		if (backlinks.length > 0) {
			sections.push(`\n## Backlinks\n`);
			sections.push(
				`These notes link to the current note. Consider their context when writing:\n`
			);

			for (const backlink of backlinks) {
				const excerpts = await this.getExcerpts(backlink, file);
				sections.push(`### [[${backlink.basename}]]\n`);
				if (excerpts.length > 0) {
					for (const excerpt of excerpts) {
						sections.push(`> ${excerpt}\n`);
					}
				} else {
					sections.push(`> (linked from ${backlink.path})\n`);
				}
			}
		} else {
			sections.push(`\n## Backlinks\n`);
			sections.push(`No other notes link to this note yet.\n`);
		}

		return sections.join('\n');
	}

	private getOutgoingLinks(file: TFile, cache: CachedMetadata | null): string[] {
		if (!cache?.links) return [];
		const seen = new Set<string>();
		for (const link of cache.links) {
			const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
			const name = resolved ? resolved.basename : link.link;
			seen.add(name);
		}
		return [...seen];
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
