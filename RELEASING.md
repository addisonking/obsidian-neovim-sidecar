# releasing

## how to release

1. bump version: `bun run version patch` (or `minor`, `major`, `x.y.z`)

   this rewrites `manifest.json` and adds the new entry to `versions.json`.

2. commit: `git add -A && git commit -m "chore: bump version to X.Y.Z"`
3. tag and push: `git tag X.Y.Z && git push origin master && git push origin X.Y.Z`

the github actions workflow will automatically:

- build the plugin with bun
- create a release with the tag name
- upload `main.js`, `manifest.json`, and `styles.css` as assets

## workflow

the release workflow is defined in `.github/workflows/release.yml`. it triggers on any tag push.
