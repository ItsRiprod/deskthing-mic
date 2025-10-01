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

```pwsh
# bump patch / minor / major
npm version patch -m "Release v%s"
git push origin main
git push --tags
```
