# Vendored methodology (topical-map-creation)

These files are a **read-only copy** of `~/.claude/skills/topical-map-creation`,
pinned at the version in `VERSION`. They are DATA, not code: never `require()`
them. The pipeline reads them as text at runtime.

## Why vendored
The canonical skill lives on a workstation and is not deployable to Vercel.
This copy makes the methodology available at runtime and makes drift visible.

## Updating to a new skill version
1. `npm run methodology:sync`   # re-copies + rewrites VERSION and manifest.json
2. Review the diff (this is a deliberate methodology change).
3. Update `scripts/methodology-sync.mjs` VERSION const if the version changed.
4. `npm run methodology:check`  # must pass
5. Commit.

## Guardrail
`npm run methodology:check` fails if the vendored tree does not match its
manifest, or (on a dev machine) if it has drifted from the source skill.
