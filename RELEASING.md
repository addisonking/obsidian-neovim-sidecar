# releasing

## how to release

1. update `version` in `manifest.json`
2. bump version: `npm run version -- patch` (or `minor`, `major`, `x.y.z`)
3. commit: `git add -A && git commit -m "chore: bump version to X.Y.Z"`
4. tag and push: `git tag X.X.X && git push origin X.X.X && git push`

the github actions workflow will automatically:

- build the plugin with bun
- create a release with the tag name
- upload `main.js`, `manifest.json`, and `styles.css` as assets

## workflow

the release workflow is defined in `.github/workflows/release.yml`. it triggers on any tag push.
