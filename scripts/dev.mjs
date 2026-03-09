#!/usr/bin/env node
import { spawn } from "child_process";
import { existsSync, mkdirSync, symlinkSync, unlinkSync, rmSync, lstatSync } from "fs";
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

// symlink individual files instead of the whole project root
// this avoids exposing package.json ("type": "module") to obsidian,
// which would cause it to misinterpret the cjs main.js as esm
const pluginFiles = ["main.js", "manifest.json", "styles.css"];

// remove existing plugin directory or symlink
if (existsSync(pluginDir)) {
	try {
		if (lstatSync(pluginDir).isSymbolicLink()) {
			unlinkSync(pluginDir);
		} else {
			rmSync(pluginDir, { recursive: true, force: true });
		}
	} catch (e) {
		console.error(`error: could not remove existing plugin directory: ${e.message}`);
		process.exit(1);
	}
}

mkdirSync(pluginDir, { recursive: true });

const createdLinks = [];
for (const file of pluginFiles) {
	const src = join(projectRoot, file);
	const dest = join(pluginDir, file);
	if (!existsSync(src)) {
		if (file === "main.js") {
			console.log(`⏳ ${file} not yet built, will be created by esbuild`);
		}
		continue;
	}
	try {
		if (existsSync(dest)) unlinkSync(dest);
		symlinkSync(src, dest);
		createdLinks.push(file);
	} catch (e) {
		console.error(`error: could not symlink ${file}: ${e.message}`);
		process.exit(1);
	}
}
console.log(`✓ symlinked [${createdLinks.join(", ")}] into ${pluginDir}`);

// ensure main.js symlink exists after first build
const ensureMainJsLink = () => {
	const src = join(projectRoot, "main.js");
	const dest = join(pluginDir, "main.js");
	if (existsSync(src) && !existsSync(dest)) {
		try {
			symlinkSync(src, dest);
			console.log("✓ symlinked main.js (created by esbuild)");
		} catch {
			// ignore
		}
	}
};

const cleanup = () => {
	try {
		if (existsSync(pluginDir)) {
			rmSync(pluginDir, { recursive: true, force: true });
			console.log("\n✓ removed plugin directory");
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
const esbuildProc = spawn("node", ["esbuild.config.mjs"], {
	cwd: projectRoot,
	stdio: "inherit",
});

// after first build, ensure main.js symlink exists
const linkCheck = setInterval(() => {
	ensureMainJsLink();
	if (existsSync(join(pluginDir, "main.js"))) {
		clearInterval(linkCheck);
	}
}, 500);

esbuildProc.on("close", (code) => {
	clearInterval(linkCheck);
	cleanup();
	process.exit(code ?? 0);
});
