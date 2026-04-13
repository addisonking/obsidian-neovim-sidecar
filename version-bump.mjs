#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const manifestPath = new URL('./manifest.json', import.meta.url);
const versionsPath = new URL('./versions.json', import.meta.url);

const parseVersion = (value) => {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) {
		return null;
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
};

const formatVersion = ({ major, minor, patch }) => `${major}.${minor}.${patch}`;

const bumpVersion = (current, kind) => {
	if (kind === 'major') {
		return { major: current.major + 1, minor: 0, patch: 0 };
	}

	if (kind === 'minor') {
		return { major: current.major, minor: current.minor + 1, patch: 0 };
	}

	return { major: current.major, minor: current.minor, patch: current.patch + 1 };
};

const compareVersions = (a, b) => {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	return a.patch - b.patch;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
const previousVersion = manifest.version;

const currentVersion = parseVersion(manifest.version);
if (!currentVersion) {
	console.error(`invalid manifest version: ${manifest.version}`);
	process.exit(1);
}

const arg = process.argv[2] ?? 'patch';
const bumpKinds = new Set(['patch', 'minor', 'major']);

let nextVersion;
if (bumpKinds.has(arg)) {
	nextVersion = formatVersion(bumpVersion(currentVersion, arg));
} else {
	const explicit = parseVersion(arg);
	if (!explicit) {
		console.error('usage: npm run version -- [patch|minor|major|x.y.z]');
		process.exit(1);
	}

	if (compareVersions(explicit, currentVersion) <= 0) {
		console.error(`new version must be greater than ${manifest.version}`);
		process.exit(1);
	}

	nextVersion = arg;
}

manifest.version = nextVersion;
versions[nextVersion] = manifest.minAppVersion;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
writeFileSync(versionsPath, `${JSON.stringify(versions, null, '\t')}\n`);

console.log(`version bumped: ${previousVersion} -> ${nextVersion}`);
