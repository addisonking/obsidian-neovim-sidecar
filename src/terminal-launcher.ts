import { existsSync } from 'node:fs';
import { join } from 'node:path';

type SupportedPlatform = 'darwin' | 'linux';
type RuntimePlatform = string;

const RUNTIME_PROCESS = (
	globalThis as {
		process?: { env?: Record<string, string | undefined> };
	}
).process;

export type TerminalId =
	| 'auto'
	| 'alacritty'
	| 'kitty'
	| 'ghostty'
	| 'wezterm'
	| 'iterm2'
	| 'terminal';

export interface TerminalOption {
	id: TerminalId;
	label: string;
}

export interface TerminalLaunchSpec {
	terminal: TerminalId;
	command: string;
	macAppName: string | null;
	windowTitle: string | null;
}

export const SIDECAR_WINDOW_TITLE = 'obsidian-neovim-sidecar';

interface BuildTerminalLaunchSpecParams {
	platform: RuntimePlatform;
	terminal: string;
	shellPath: string;
	attachCommand: string;
}

const TERMINAL_ALIASES: Record<string, TerminalId> = {
	auto: 'auto',
	alacritty: 'alacritty',
	kitty: 'kitty',
	ghostty: 'ghostty',
	wezterm: 'wezterm',
	iterm: 'iterm2',
	iterm2: 'iterm2',
	terminal: 'terminal',
	'terminal.app': 'terminal',
};

const DARWIN_AUTO_ORDER: TerminalId[] = [
	'alacritty',
	'kitty',
	'ghostty',
	'wezterm',
	'iterm2',
	'terminal',
];

export function normalizeTerminalId(value: string | null | undefined): TerminalId {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return 'auto';
	return TERMINAL_ALIASES[normalized] ?? 'auto';
}

export function getRuntimePlatform(): RuntimePlatform {
	const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
	return platform ?? 'darwin';
}

export function getTerminalOptionsForPlatform(platform: RuntimePlatform): TerminalOption[] {
	if (platform === 'darwin') {
		return [
			{ id: 'auto', label: 'Auto' },
			{ id: 'alacritty', label: 'Alacritty' },
			{ id: 'kitty', label: 'kitty' },
			{ id: 'ghostty', label: 'Ghostty' },
			{ id: 'wezterm', label: 'WezTerm' },
			{ id: 'iterm2', label: 'iTerm2' },
			{ id: 'terminal', label: 'Terminal.app' },
		];
	}

	return [
		{ id: 'auto', label: 'Auto' },
		{ id: 'alacritty', label: 'Alacritty' },
		{ id: 'kitty', label: 'kitty' },
		{ id: 'ghostty', label: 'Ghostty' },
		{ id: 'wezterm', label: 'WezTerm' },
	];
}

export function buildTerminalLaunchSpec(
	params: BuildTerminalLaunchSpecParams
): TerminalLaunchSpec | null {
	const platform = toSupportedPlatform(params.platform);
	if (!platform) return null;

	const requested = normalizeTerminalId(params.terminal);
	const terminal = requested === 'auto' ? detectAutoTerminal(platform) : requested;

	const command =
		platform === 'darwin'
			? buildDarwinCommand(terminal, params.shellPath, params.attachCommand)
			: buildLinuxCommand(terminal, params.shellPath, params.attachCommand);

	if (!command) return null;

	return {
		terminal,
		command,
		macAppName: platform === 'darwin' ? getMacAppName(terminal) : null,
		windowTitle:
			platform === 'darwin' && ['alacritty', 'kitty', 'ghostty'].includes(terminal)
				? SIDECAR_WINDOW_TITLE
				: null,
	};
}

function toSupportedPlatform(platform: RuntimePlatform): SupportedPlatform | null {
	if (platform === 'darwin' || platform === 'linux') return platform;
	return null;
}

function detectAutoTerminal(platform: SupportedPlatform): TerminalId {
	for (const terminal of DARWIN_AUTO_ORDER) {
		if (isTerminalAvailable(platform, terminal)) return terminal;
	}
	return 'terminal';
}

function isTerminalAvailable(platform: SupportedPlatform, terminal: TerminalId): boolean {
	if (platform === 'darwin') {
		switch (terminal) {
			case 'alacritty':
				return hasMacApp('Alacritty') || isBinaryAvailable('alacritty');
			case 'kitty':
				return hasMacApp('kitty') || isBinaryAvailable('kitty');
			case 'ghostty':
				return hasMacApp('Ghostty') || isBinaryAvailable('ghostty');
			case 'wezterm':
				return hasMacApp('WezTerm') || isBinaryAvailable('wezterm');
			case 'iterm2':
				return hasMacApp('iTerm') || hasMacApp('iTerm2');
			case 'terminal':
				return hasMacApp('Terminal');
			default:
				return false;
		}
	}

	return isBinaryAvailable(terminal);
}

function isBinaryAvailable(binaryName: string): boolean {
	const pathDirs = (RUNTIME_PROCESS?.env?.PATH ?? '').split(':').filter(Boolean);
	const candidates = new Set([
		...pathDirs,
		'/usr/local/bin',
		'/usr/bin',
		'/bin',
		'/opt/homebrew/bin',
	]);
	for (const dir of candidates) {
		if (existsSync(join(dir, binaryName))) return true;
	}
	return false;
}

function hasMacApp(appName: string): boolean {
	const roots = [
		'/Applications',
		'/Applications/Utilities',
		'/System/Applications',
		'/System/Applications/Utilities',
	];
	const home = RUNTIME_PROCESS?.env?.HOME;
	if (home) roots.push(join(home, 'Applications'));
	for (const root of roots) {
		if (existsSync(join(root, `${appName}.app`))) return true;
	}
	return false;
}

function buildDarwinCommand(
	terminal: TerminalId,
	shellPath: string,
	attachCommand: string
): string | null {
	const shell = escapeDoubleQuoted(shellPath);
	const attach = escapeDoubleQuoted(attachCommand);

	switch (terminal) {
		case 'alacritty':
			return `open -na "Alacritty" --args -T "${SIDECAR_WINDOW_TITLE}" -o window.dynamic_title=false -e "${shell}" -lc "${attach}"`;
		case 'kitty':
			return `open -na "kitty" --args --title "${SIDECAR_WINDOW_TITLE}" "${shell}" -lc "${attach}"`;
		case 'ghostty':
			return `open -na "Ghostty" --args --title="${SIDECAR_WINDOW_TITLE}" -e "${shell} -lc '${attach}'"`;
		case 'wezterm':
			return `open -na "WezTerm" --args start -- "${shell}" -lc "${attach}"`;
		case 'iterm2': {
			const script = escapeAppleScript(attachCommand);
			return `osascript -e 'tell application "iTerm" to activate' -e 'tell application "iTerm" to create window with default profile command "${script}"'`;
		}
		case 'terminal': {
			const script = escapeAppleScript(attachCommand);
			return `osascript -e 'tell application "Terminal" to do script "${script}"' -e 'tell application "Terminal" to activate'`;
		}
		default:
			return null;
	}
}

function buildLinuxCommand(
	terminal: TerminalId,
	shellPath: string,
	attachCommand: string
): string | null {
	const shell = escapeDoubleQuoted(shellPath);
	const attach = escapeDoubleQuoted(attachCommand);

	switch (terminal) {
		case 'alacritty':
			return `alacritty -e "${shell}" -lc "${attach}"`;
		case 'kitty':
			return `kitty "${shell}" -lc "${attach}"`;
		case 'ghostty':
			return `ghostty -e "${shell}" -lc "${attach}"`;
		case 'wezterm':
			return `wezterm start -- "${shell}" -lc "${attach}"`;
		default:
			return null;
	}
}

function getMacAppName(terminal: TerminalId): string | null {
	switch (terminal) {
		case 'alacritty':
			return 'Alacritty';
		case 'kitty':
			return 'kitty';
		case 'ghostty':
			return 'Ghostty';
		case 'wezterm':
			return 'WezTerm';
		case 'iterm2':
			return 'iTerm';
		case 'terminal':
			return 'Terminal';
		default:
			return null;
	}
}

function escapeDoubleQuoted(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\$/g, '\\$')
		.replace(/`/g, '\\`');
}

function escapeAppleScript(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
