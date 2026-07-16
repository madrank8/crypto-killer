# Vendored methodology (topical-map-creation)

The adjacent `methodology/` directory is a **read-only copy** of `~/.claude/skills/topical-map-creation`,
pinned at the version in `VERSION`. Its contents are DATA, not code: never `require()`
them. The pipeline reads them as text at runtime.

## Why vendored
The canonical skill lives on a workstation and is not deployable to Vercel.
This copy makes the methodology available at runtime and makes drift visible.

## Updating to a new skill version
1. `npm run methodology:sync`   # re-copies + rewrites VERSION and manifest.json
2. Review the diff (this is a deliberate methodology change).
3. If the version changed, update BOTH the `VERSION` const in
   `scripts/methodology-sync.mjs` AND the hardcoded version assertion in
   `test/topical-map/methodology-vendored.test.js` (else that test goes red).
4. `npm run methodology:check`  # must pass
5. `npm test`  # must pass
6. Commit.

## Guardrail
`npm run methodology:check` fails if the vendored tree does not match its
manifest, or (on a dev machine) if it has drifted from the source skill.
