# Releasing Story Writer

A release is ALL of these steps, done end to end without asking for
confirmation at each one. Never hand any step back to the user or claim it
is out of reach — every step works from this folder with `$GITHUB_PAT`.

1. `npm test` passes; `bash build.sh` builds `dist/plugin.wasm`.
2. Bump `package.json` + `package-lock.json` (`npm version X.Y.Z --no-git-tag-version`);
   commit `Release vX.Y.Z`; push `HEAD:main`; tag `vX.Y.Z` and push the tag.
3. GitHub release `vX.Y.Z` on firestar/peckboard-story-writer with the wasm
   attached as `story-writer.wasm`
   (`GH_TOKEN=$GITHUB_PAT gh release create ...`; use `--notes-file`).
4. Update the `story-writer` entry in PeckBoard/creative-flows `registry.json`
   via the GitHub contents API (`$GITHUB_PAT`): `version`, `url`
   (`.../releases/download/vX.Y.Z/story-writer.wasm`), `sha256` of the
   DOWNLOADED release asset, and `min_peckboard` (raise it whenever the
   manifest uses a newer core feature — e.g. `type: "model"` settings need
   0.1.130). Commit message `Story Writer vX.Y.Z`.

The release is not done until step 4 is committed.
