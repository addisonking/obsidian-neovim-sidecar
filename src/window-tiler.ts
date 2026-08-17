export type TileSide = 'left' | 'right';

const PROCESS_NAME_OVERRIDES: Record<string, string> = {
	iTerm: 'iTerm2',
};

export function getTerminalProcessName(macAppName: string): string {
	return PROCESS_NAME_OVERRIDES[macAppName] ?? macAppName;
}

export function buildTileWindowsScript(
	terminalProcessName: string,
	terminalSide: TileSide,
	windowTitle: string | null = null
): string {
	const proc = terminalProcessName;
	const termX = terminalSide === 'right' ? 'x0 + halfW' : 'x0';
	const obsX = terminalSide === 'right' ? 'x0' : 'x0 + halfW';

	const findTitled = windowTitle
		? `
			repeat with p in (every application process whose name is "${proc}")
				if exists (first window of p whose name contains "${windowTitle}") then
					set termPid to unix id of p
					exit repeat
				end if
			end repeat`
		: `
			if (exists application process "${proc}") and (exists window 1 of application process "${proc}") then set termPid to unix id of application process "${proc}"`;

	const windowSelector = windowTitle
		? `first window whose name contains "${windowTitle}"`
		: 'front window';

	return `
tell application "Finder" to set {x0, y0, x1, y1} to bounds of window of desktop
tell application "System Events"
	set mbh to 25
	try
		set mbh to height of menu bar 1 of application process "Finder"
	end try
	set halfW to ((x1 - x0) / 2) as integer
	set winH to (y1 - y0) - mbh
	set termPid to missing value
	repeat 40 times${findTitled}
		if termPid is not missing value then exit repeat
		delay 0.15
	end repeat
	if termPid is missing value and (exists application process "${proc}") and (exists window 1 of application process "${proc}") then
		set termPid to unix id of application process "${proc}"
		set useFrontWindow to true
	else
		set useFrontWindow to ${windowTitle ? 'false' : 'true'}
	end if
	if termPid is missing value then return
	tell application process "Obsidian"
		set position of front window to {${obsX}, y0 + mbh}
		set size of front window to {halfW, winH}
	end tell
	tell (first application process whose unix id is termPid)
		if useFrontWindow then
			set position of front window to {${termX}, y0 + mbh}
			set size of front window to {halfW, winH}
			try
				perform action "AXRaise" of front window
			end try
		else
			set position of (${windowSelector}) to {${termX}, y0 + mbh}
			set size of (${windowSelector}) to {halfW, winH}
			try
				perform action "AXRaise" of (${windowSelector})
			end try
		end if
	end tell
end tell
`.trim();
}

export function isAccessibilityError(message: string): boolean {
	return (
		message.includes('assistive access') ||
		message.includes('-25211') ||
		message.includes('-1719')
	);
}
