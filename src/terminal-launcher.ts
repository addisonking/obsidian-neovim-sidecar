import { existsSync } from 'fs';
import { join } from 'path';

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
	| 'wezterm'
	| 'iterm2'
	| 'terminal'
	| 'gnome-terminal'
	| 'konsole'
	| 'xfce4-terminal'
	| 'xterm';

export interface TerminalOption {
	id: TerminalId;
	label: string;
}

export interface TerminalLaunchSpec {
	terminal: TerminalId;
	command: string;
	macAppName: string | null;
}

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
	wezterm: 'wezterm',
	iterm: 'iterm2',
	iterm2: 'iterm2',
	terminal: 'terminal',
	'terminal.app': 'terminal',
	'gnome-terminal': 'gnome-terminal',
	gnome: 'gnome-terminal',
	konsole: 'konsole',
	'xfce4-terminal': 'xfce4-terminal',
	xfce: 'xfce4-terminal',
	xterm: 'xterm',
};

const DARWIN_AUTO_ORDER: TerminalId[] = ['alacritty', 'kitty', 'wezterm', 'iterm2', 'terminal'];
const LINUX_AUTO_ORDER: TerminalId[] = [
	'alacritty',
	'kitty',
	'wezterm',
	'gnome-terminal',
	'konsole',
	'xfce4-terminal',
	'xterm',
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
			{ id: 'wezterm', label: 'WezTerm' },
			{ id: 'iterm2', label: 'iTerm2' },
			{ id: 'terminal', label: 'Terminal.app' },
		];
	}

	if (platform === 'linux') {
		return [
			{ id: 'auto', label: 'Auto' },
			{ id: 'alacritty', label: 'Alacritty' },
			{ id: 'kitty', label: 'kitty' },
			{ id: 'wezterm', label: 'WezTerm' },
			{ id: 'gnome-terminal', label: 'GNOME Terminal' },
			{ id: 'konsole', label: 'Konsole' },
			{ id: 'xfce4-terminal', label: 'Xfce Terminal' },
			{ id: 'xterm', label: 'xterm' },
		];
	}

	return [{ id: 'auto', label: 'Auto' }];
}

export function buildTerminalLaunchSpec(
	params: BuildTerminalLaunchSpecParams
): TerminalLaunchSpec | null {
	const platform = toSupportedPlatform(params.platform);
	if (!platform) return null;

	const requested = normalizeTerminalId(params.terminal);
	const terminal = requested === 'auto' ? detectAutoTerminal(platform) : requested;
	if (!isSupportedOnPlatform(platform, terminal)) return null;

	const command =
		platform === 'darwin'
			? buildDarwinCommand(terminal, params.shellPath, params.attachCommand)
			: buildLinuxCommand(terminal, params.shellPath, params.attachCommand);

	if (!command) return null;

	return {
		terminal,
		command,
		macAppName: platform === 'darwin' ? getMacAppName(terminal) : null,
	};
}

function toSupportedPlatform(platform: RuntimePlatform): SupportedPlatform | null {
	if (platform === 'darwin' || platform === 'linux') return platform;
	return null;
}

function detectAutoTerminal(platform: SupportedPlatform): TerminalId {
	const order = platform === 'darwin' ? DARWIN_AUTO_ORDER : LINUX_AUTO_ORDER;
	for (const terminal of order) {
		if (isTerminalAvailable(platform, terminal)) return terminal;
	}
	return platform === 'darwin' ? 'terminal' : 'xterm';
}

function isSupportedOnPlatform(platform: SupportedPlatform, terminal: TerminalId): boolean {
	if (platform === 'darwin') {
		return ['auto', 'alacritty', 'kitty', 'wezterm', 'iterm2', 'terminal'].includes(terminal);
	}
	return [
		'auto',
		'alacritty',
		'kitty',
		'wezterm',
		'gnome-terminal',
		'konsole',
		'xfce4-terminal',
		'xterm',
	].includes(terminal);
}

function isTerminalAvailable(platform: SupportedPlatform, terminal: TerminalId): boolean {
	if (platform === 'darwin') {
		switch (terminal) {
			case 'alacritty':
				return hasMacApp('Alacritty') || isBinaryAvailable('alacritty');
			case 'kitty':
				return hasMacApp('kitty') || isBinaryAvailable('kitty');
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

	switch (terminal) {
		case 'alacritty':
			return isBinaryAvailable('alacritty');
		case 'kitty':
			return isBinaryAvailable('kitty');
		case 'wezterm':
			return isBinaryAvailable('wezterm');
		case 'gnome-terminal':
			return isBinaryAvailable('gnome-terminal');
		case 'konsole':
			return isBinaryAvailable('konsole');
		case 'xfce4-terminal':
			return isBinaryAvailable('xfce4-terminal');
		case 'xterm':
			return isBinaryAvailable('xterm');
		default:
			return false;
	}
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
			return `open -na "Alacritty" --args -e "${shell}" -lc "${attach}"`;
		case 'kitty':
			return `open -na "kitty" --args "${shell}" -lc "${attach}"`;
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
		case 'wezterm':
			return `wezterm start -- "${shell}" -lc "${attach}"`;
		case 'gnome-terminal':
			return `gnome-terminal -- "${shell}" -lc "${attach}"`;
		case 'konsole':
			return `konsole -e "${shell}" -lc "${attach}"`;
		case 'xfce4-terminal':
			return `xfce4-terminal --command='${shell} -lc "${attach}"'`;
		case 'xterm':
			return `xterm -e "${shell}" -lc "${attach}"`;
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
