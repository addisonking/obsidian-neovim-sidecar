#!/usr/bin/env node
import { spawn } from "child_process";
import { existsSync, mkdirSync, symlinkSync, unlinkSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const vaultPath = process.argv[2];

if (!vaultPath) {
	console.error("usage: bun run dev:vault <path-to-vault>");
	console.error("example: bun run dev:vault ~/Documents/MyVault");
	process.exit(1);
}

const resolvedVaultPath = resolve(vaultPath);
const pluginDir = join(resolvedVaultPath, ".obsidian", "plugins", "obsidian-neovim-sidecar");

if (!existsSync(resolvedVaultPath)) {
	console.error(`error: vault path does not exist: ${resolvedVaultPath}`);
	process.exit(1);
}

const obsidianDir = join(resolvedVaultPath, ".obsidian");
if (!existsSync(obsidianDir)) {
	console.error(`error: not a valid obsidian vault (missing .obsidian): ${resolvedVaultPath}`);
	process.exit(1);
}

const pluginsDir = join(obsidianDir, "plugins");
if (!existsSync(pluginsDir)) {
	mkdirSync(pluginsDir, { recursive: true });
}

// remove existing symlink or directory
if (existsSync(pluginDir)) {
	try {
		rmSync(pluginDir, { recursive: true, force: true });
	} catch (e) {
		console.error(`error: could not remove existing plugin directory: ${e.message}`);
		process.exit(1);
	}
}

// create symlink
try {
	symlinkSync(projectRoot, pluginDir, "dir");
	console.log(`✓ symlinked ${projectRoot} -> ${pluginDir}`);
} catch (e) {
	console.error(`error: could not create symlink: ${e.message}`);
	process.exit(1);
}

// cleanup on exit
const cleanup = () => {
	try {
		if (existsSync(pluginDir)) {
			unlinkSync(pluginDir);
			console.log("\n✓ removed symlink");
		}
	} catch {
		// ignore cleanup errors
	}
};

process.on("SIGINT", () => {
	cleanup();
	process.exit(0);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(0);
});

// start esbuild watch mode
console.log("starting esbuild in watch mode...\n");
const esbuild = spawn("node", ["esbuild.config.mjs"], {
	cwd: projectRoot,
	stdio: "inherit",
});

esbuild.on("close", (code) => {
	cleanup();
	process.exit(code ?? 0);
});
