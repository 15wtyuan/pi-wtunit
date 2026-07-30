# pi-wtunit patches

Runtime patches applied to the **globally installed** `@earendil-works/pi-coding-agent` (its published `dist/`), so extensions can use APIs not yet accepted upstream.

## How it runs

`scripts/patch-pi.mjs` is wired as `postinstall`. On every install/update of this package it:

1. Locates the global `pi` install (`npm root -g` → `@earendil-works/pi-coding-agent`)
2. Reads its `package.json` version
3. For each directory under `patches/<id>/`:
   - prefers `v<exact-version>.mjs`
   - else falls back to `latest.mjs`
4. Applies surgical find/replace transforms (idempotent via markers)

Default failure mode is **warn + exit 0** so npm install is not blocked.  
Set `PI_WTUNIT_PATCH_STRICT=1` to fail hard.

Override for testing: `PI_WTUNIT_PI_ROOT=/path/to/pi-coding-agent`.

## Current patches

| id | purpose |
|----|---------|
| `setRenderedSession` | `ExtensionUIContext.setRenderedSession(session \| undefined)` — render an external `AgentSession` in the main TUI ([#7058](https://github.com/earendil-works/pi/issues/7058)) |

## Workflow when pi releases a new version

```text
1. Fork branch
   - rebase setRenderedSession onto upstream vX.Y.Z
   - npm run build in packages/coding-agent
   - compare clean official dist vs patched dist for the 4 files

2. pi-wtunit
   - copy/adjust anchors into patches/setRenderedSession/vX.Y.Z.mjs
   - point latest.mjs at the new file
   - smoke test:
       PI_WTUNIT_PI_ROOT=/path/to/clean-0.X.Y/package node scripts/patch-pi.mjs
       PI_WTUNIT_PI_ROOT=... node scripts/patch-pi.mjs   # second run → all "already"
   - commit + push

3. Machine
   - npm i -g @earendil-works/pi-coding-agent@X.Y.Z   # replaces package; old patch gone
   - update pi-wtunit (npm install / pi package update) → postinstall re-patches
```

## Patch module shape

```js
export default {
  id: "setRenderedSession",
  piVersion: "0.83.0",
  files: [
    {
      path: "dist/...",
      markers: ["unique substring proving the patch is present"],
      transforms: [
        { find: "exact anchor from clean dist", replace: "patched content" },
      ],
    },
  ],
};
```

Rules:

- Anchors must be unique exact substrings of the **clean** official dist
- `markers` must all appear after a successful apply (used for idempotency)
- Prefer small transforms; one logical change per transform

## Files touched by setRenderedSession

- `dist/core/extensions/types.d.ts`
- `dist/core/extensions/runner.js`
- `dist/modes/rpc/rpc-mode.js`
- `dist/modes/interactive/interactive-mode.js`
