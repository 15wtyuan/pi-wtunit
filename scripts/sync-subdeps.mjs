#!/usr/bin/env node
/**
 * Resolve git dependency tips from package.json and refresh subdeps.lock.json.
 *
 * Why: pi update only hard-resets the top-level git package. Nested git deps
 * floating without a lock only reinstall when the meta-package HEAD moves.
 * Committing this lockfile on tip changes gives pi-wtunit a new commit so
 * `pi update --extensions` re-runs npm install and picks up nested updates.
 *
 * Usage:
 *   node scripts/sync-subdeps.mjs
 *   node scripts/sync-subdeps.mjs --check   # exit 1 if lock is stale (CI gate)
 *
 * Stdout (GitHub Actions $GITHUB_OUTPUT friendly):
 *   changed=true|false
 *   summary=bump pkg-a, pkg-b
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PKG_PATH = join(ROOT, "package.json");
const LOCK_PATH = join(ROOT, "subdeps.lock.json");
const CHECK = process.argv.includes("--check");

function parseGitDep(spec) {
	if (typeof spec !== "string" || !spec.startsWith("git+")) return null;

	const hashIdx = spec.indexOf("#");
	const rawUrl = (hashIdx === -1 ? spec : spec.slice(0, hashIdx)).replace(/^git\+/, "");
	const ref = hashIdx === -1 ? "HEAD" : spec.slice(hashIdx + 1) || "HEAD";

	// Normalize to an https URL cron can ls-remote without SSH keys.
	let url = rawUrl;
	if (url.startsWith("ssh://git@")) {
		url = url.replace(/^ssh:\/\/git@/, "https://");
	} else if (url.startsWith("git@")) {
		// git@host:path
		url = url.replace(/^git@([^:]+):/, "https://$1/");
	}

	return { spec, url, ref };
}

function lsRemote(url, ref) {
	if (/^[0-9a-f]{7,40}$/i.test(ref)) {
		return ref.toLowerCase();
	}

	const candidates =
		ref === "HEAD"
			? ["HEAD"]
			: [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`, ref];

	for (const candidate of candidates) {
		let out = "";
		try {
			out = execFileSync("git", ["ls-remote", url, candidate], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		} catch (err) {
			const msg = err?.stderr?.toString?.() || err?.message || String(err);
			throw new Error(`git ls-remote failed for ${url} ${candidate}: ${msg}`);
		}
		if (!out) continue;

		// Prefer peeled annotated-tag lines (^{}) when present.
		const lines = out.split(/\r?\n/).filter(Boolean);
		const peeled = lines.find((l) => l.includes("^{}"));
		const line = peeled || lines[0];
		const sha = line.split(/[\s\t]/)[0];
		if (sha && /^[0-9a-f]{40}$/i.test(sha)) return sha.toLowerCase();
	}

	throw new Error(`could not resolve ${url}#${ref}`);
}

function short(sha) {
	return sha.slice(0, 7);
}

function main() {
	const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
	const deps = pkg.dependencies ?? {};
	const packages = {};

	for (const [name, spec] of Object.entries(deps)) {
		const parsed = parseGitDep(spec);
		if (!parsed) {
			console.error(`[sync-subdeps] skip non-git dep: ${name}`);
			continue;
		}
		const resolved = lsRemote(parsed.url, parsed.ref);
		packages[name] = {
			spec: parsed.spec,
			url: parsed.url,
			ref: parsed.ref,
			resolved,
		};
		console.error(
			`[sync-subdeps] ${name}: ${parsed.ref} → ${short(resolved)} (${parsed.url})`,
		);
	}

	const next = {
		// Bumped whenever resolved tips change — forces a meta-package commit.
		generatedAt: new Date().toISOString(),
		packages,
	};

	const prev = existsSync(LOCK_PATH)
		? JSON.parse(readFileSync(LOCK_PATH, "utf8"))
		: null;

	const prevPkgs = prev?.packages ?? {};
	const names = new Set([...Object.keys(prevPkgs), ...Object.keys(packages)]);
	const bumps = [];
	const removed = [];
	const added = [];

	for (const name of [...names].sort()) {
		const a = prevPkgs[name]?.resolved;
		const b = packages[name]?.resolved;
		if (!a && b) {
			added.push(name);
			bumps.push(`${name} ${short(b)}`);
		} else if (a && !b) {
			removed.push(name);
			bumps.push(`${name} removed`);
		} else if (a && b && a.toLowerCase() !== b.toLowerCase()) {
			bumps.push(`${name} ${short(a)}→${short(b)}`);
		}
	}

	const changed = bumps.length > 0 || !prev;
	const summary = bumps.length
		? `bump ${bumps.join(", ")}`
		: !prev
			? "init subdeps.lock.json"
			: "no changes";

	if (CHECK) {
		if (changed) {
			console.error(`[sync-subdeps] STALE: ${summary}`);
			process.stdout.write(`changed=true\nsummary=${summary}\n`);
			process.exit(1);
		}
		console.error("[sync-subdeps] up to date");
		process.stdout.write("changed=false\nsummary=no changes\n");
		return;
	}

	if (!changed) {
		// Refresh generatedAt only when something moves — keep file stable.
		console.error("[sync-subdeps] no changes");
		process.stdout.write("changed=false\nsummary=no changes\n");
		return;
	}

	// Stable serialization (2-space, trailing newline).
	writeFileSync(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	console.error(`[sync-subdeps] wrote ${LOCK_PATH}`);
	console.error(`[sync-subdeps] ${summary}`);
	process.stdout.write(`changed=true\nsummary=${summary}\n`);
}

main();
