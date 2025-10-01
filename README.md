# deskthing-mic
A simple NPM package for setting up and using a mic on the car thing


Setting this up takes a little bit of configuration, whether that be in a postinstall setup for adb commands or what

You can run
```ts
import { install, InstallConfig } from @deskthing/microphone/utils

const config: InstallConfig = {
  adbPath: 'C:/path/to/adb.exe',
  clientId: 'ADBclientIdString'
}

const loggingCallback = (message: string) => {
  console.log(message)
}

install(config, loggingCallback)
```

The intended location for this would be in a postinstall.js type scenario for configuring the car thing after installation. If the adbPath is blank, the program will try and just use env variables. If clientId is blank, the program will attempt to use the default ADB device - but this WILL fail if there is more than one client connected and is not recommended

## Publishing

This project uses a CI workflow to build artifacts and publish the package to npm when a GitHub release matching the package version is published.

Recommended safe release steps (manual):

1. Bump version and create tag (this creates a commit and a tag):

```pwsh
# bump patch / minor / major
npm version patch -m "Release v%s"
git push origin main
git push --tags
```

2. Create and publish a GitHub release for the tag (this triggers CI):

```pwsh
# using GitHub CLI
gh release create v$(node -p "require('./package.json').version") --title "v$(node -p \"require('./package.json').version\")" --notes "Release notes"
```

3. CI will run and:

- Build JS bundles and types.
- Cross-compile the Go daemon into `dist/lib/deskthing-daemon-<arch>`.
- Publish the npm package (requires `NPM_TOKEN` secret in repo settings).
- Attach the built daemon files to the GitHub release.

Dry-run and manual flow

- To test the build without publishing, run the workflow manually from GitHub Actions with `dry_run = true` (default), or via gh CLI:

```pwsh
gh workflow run release-publish.yml --ref main --field dry_run=true
```

- To have the workflow create the release and publish in one run (use carefully):

```pwsh
gh workflow run release-publish.yml --ref main --field create_release=true --field publish=true --field dry_run=false
```

Notes

- The CI checks that the release tag is `v` + `package.json` version before publishing to npm. Keep those in sync.
- Add `NPM_TOKEN` to repository secrets before attempting CI publishes.
- Running `npm publish` locally will also run `prepublishOnly` which builds the artifacts first.
