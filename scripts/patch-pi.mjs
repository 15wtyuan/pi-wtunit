#!/usr/bin/env node
/**
 * Apply pi-wtunit dist patches to the globally installed @earendil-works/pi-coding-agent.
 *
 * Resolution order per patch:
 *   1. patches/<id>/v<exact-version>.mjs
 *   2. patches/<id>/latest.mjs
 *
 * Idempotent: if every transform is already present, the run is a no-op.
 * Default: warn on failure (exit 0). Set PI_WTUNIT_PATCH_STRICT=1 to exit 1.
 *
 * Override install root for testing: PI_WTUNIT_PI_ROOT=/path/to/pi-coding-agent
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PATCHES_DIR = join(ROOT, "patches");
const MARKER_FILE = ".pi-wtunit-patches.json";
const STRICT = process.env.PI_WTUNIT_PATCH_STRICT === "1";
const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

function log(msg) {
	console.log(`[pi-wtunit patch] ${msg}`);
}

function warn(msg) {
	console.warn(`[pi-wtunit patch] WARN: ${msg}`);
}

function fail(msg) {
	console.error(`[pi-wtunit patch] ERROR: ${msg}`);
	if (STRICT) process.exit(1);
	process.exit(0);
}

function resolveGlobalRoot() {
	if (process.env.PI_WTUNIT_PI_ROOT) {
		return process.env.PI_WTUNIT_PI_ROOT;
	}

	// 1. npm root -g
	try {
		const npmRoot = execFileSync("npm", ["root", "-g"], {
			encoding: "utf8",
			shell: true,
		}).trim();
		const candidate = join(npmRoot, PACKAGE_NAME);
		if (existsSync(join(candidate, "package.json"))) return candidate;
	} catch {
		// fall through
	}

	// 2. Follow the `pi` binary → …/node_modules/@earendil-works/pi-coding-agent
	try {
		const whichCmd = process.platform === "win32" ? "where" : "which";
		const piPath = execFileSync(whichCmd, ["pi"], {
			encoding: "utf8",
			shell: true,
		})
			.trim()
			.split(/\r?\n/)[0];
		if (piPath) {
			// bin sits next to node_modules on npm global installs
			const candidate = join(dirname(piPath), "node_modules", PACKAGE_NAME);
			if (existsSync(join(candidate, "package.json"))) return candidate;
			// nvm-style: basedir/node_modules/...
			const candidate2 = join(dirname(piPath), "..", "lib", "node_modules", PACKAGE_NAME);
			if (existsSync(join(candidate2, "package.json"))) return candidate2;
		}
	} catch {
		// fall through
	}

	return null;
}

function listPatchIds() {
	if (!existsSync(PATCHES_DIR)) return [];
	return readdirSync(PATCHES_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
}

async function loadPatchModule(id, piVersion) {
	const dir = join(PATCHES_DIR, id);
	const exact = join(dir, `v${piVersion}.mjs`);
	const latest = join(dir, "latest.mjs");

	let path = null;
	let source = null;
	if (existsSync(exact)) {
		path = exact;
		source = `v${piVersion}`;
	} else if (existsSync(latest)) {
		path = latest;
		source = "latest";
	} else {
		return {
			error: `no patch module for ${id} matching ${piVersion} (looked for v${piVersion}.mjs and latest.mjs)`,
		};
	}

	const mod = await import(pathToFileURL(path).href);
	const patch = mod.default ?? mod.patch ?? mod;
	if (!patch || !Array.isArray(patch.files)) {
		return { error: `${path} must default-export { files: [...] }` };
	}
	return { patch: { id, ...patch, id }, source, path };
}

/**
 * Apply one file's transforms.
 * Returns { status: "applied"|"already"|"error", detail?, content? }
 */
function applyFileTransforms(original, transforms, markers) {
	// Already patched if every marker is present
	if (markers?.length && markers.every((m) => original.includes(m))) {
		return { status: "already", content: original };
	}

	let content = original;
	let changed = false;

	for (let i = 0; i < transforms.length; i++) {
		const t = transforms[i];
		if (!t.find || t.replace === undefined) {
			return { status: "error", detail: `transform[${i}] missing find/replace` };
		}

		// Fully applied already (replace text present, find text gone)
		if (content.includes(t.replace) && !content.includes(t.find)) {
			continue;
		}
		// Partially confusing state
		if (content.includes(t.replace) && content.includes(t.find)) {
			// both present — leave alone if replace already covers intent; skip this transform
			continue;
		}
		if (!content.includes(t.find)) {
			return {
				status: "error",
				detail: `anchor not found for transform[${i}]: ${preview(t.find)}`,
			};
		}

		const next = content.replace(t.find, t.replace);
		if (next === content) {
			return {
				status: "error",
				detail: `replace produced no change for transform[${i}]`,
			};
		}
		content = next;
		changed = true;
	}

	if (markers?.length && !markers.every((m) => content.includes(m))) {
		return {
			status: "error",
			detail: `after apply, markers missing: ${markers.filter((m) => !content.includes(m)).join(", ")}`,
		};
	}

	return { status: changed ? "applied" : "already", content };
}

function preview(s, n = 60) {
	const one = s.replace(/\s+/g, " ");
	return one.length <= n ? JSON.stringify(one) : JSON.stringify(one.slice(0, n) + "…");
}

function writeMarker(pkgRoot, piVersion, applied) {
	const path = join(pkgRoot, MARKER_FILE);
	const payload = {
		piVersion,
		applied,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function main() {
	const pkgRoot = resolveGlobalRoot();
	if (!pkgRoot) {
		fail(`could not locate global ${PACKAGE_NAME}. Install pi first, or set PI_WTUNIT_PI_ROOT.`);
		return;
	}

	const pkgJsonPath = join(pkgRoot, "package.json");
	const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
	const piVersion = pkg.version;
	log(`target: ${pkgRoot}`);
	log(`version: ${piVersion}`);

	const ids = listPatchIds();
	if (ids.length === 0) {
		log("no patches defined; nothing to do");
		return;
	}

	/** @type {Record<string, { patchSource: string, status: string }>} */
	const applied = {};
	let anyError = false;

	for (const id of ids) {
		const loaded = await loadPatchModule(id, piVersion);
		if (loaded.error) {
			warn(`${id}: ${loaded.error}`);
			anyError = true;
			continue;
		}

		const { patch, source } = loaded;
		log(`${id}: using ${source} (${loaded.path})`);

		let fileErrors = [];
		let anyApplied = false;
		let allAlready = true;

		for (const file of patch.files) {
			const abs = join(pkgRoot, file.path);
			if (!existsSync(abs)) {
				fileErrors.push(`${file.path}: file not found`);
				continue;
			}
			const original = readFileSync(abs, "utf8");
			const result = applyFileTransforms(original, file.transforms, file.markers);
			if (result.status === "error") {
				fileErrors.push(`${file.path}: ${result.detail}`);
				continue;
			}
			if (result.status === "applied") {
				writeFileSync(abs, result.content, "utf8");
				anyApplied = true;
				allAlready = false;
				log(`  applied → ${file.path}`);
			} else {
				log(`  already → ${file.path}`);
			}
		}

		if (fileErrors.length) {
			anyError = true;
			warn(`${id} failed on ${piVersion}:`);
			for (const e of fileErrors) warn(`  - ${e}`);
			warn(
				`Update patches/${id}/v${piVersion}.mjs (rebase setRenderedSession onto this pi version, rebuild, refresh anchors).`,
			);
			applied[id] = { patchSource: source, status: "error" };
			continue;
		}

		applied[id] = {
			patchSource: source,
			status: anyApplied ? "applied" : allAlready ? "already" : "applied",
		};
	}

	writeMarker(pkgRoot, piVersion, applied);

	if (anyError) {
		fail(`one or more patches failed against pi ${piVersion}`);
		return;
	}
	log("done");
}

main().catch((err) => {
	fail(err?.stack || String(err));
});
