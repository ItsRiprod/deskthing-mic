# DeskThing-Mic

A lightweight NPM package for configuring and utilizing a microphone on the Car Thing device or other websites.

## Getting Started

### Installation

To install the package, run:

```sh
npm install @deskthing/microphone
```

### Daemon Configuration

After installation, configure the daemon on your Car Thing device. This can be accomplished by executing the `install` script from `@deskthing/microphone/utils`. Ensure that [ADB](https://developer.android.com/studio/command-line/adb) is installed and available in your system's PATH. If ADB is already in your PATH, you may omit the `adbPath` option.

#### Example Implementation

```ts
import { install, InstallConfig } from '@deskthing/microphone/utils';

const config: InstallConfig = {
  adbPath: 'C:/path/to/adb.exe',
  clientId: 'ADBclientIdString'
};

const loggingCallback = (message: string) => {
  console.log(message);
};

install(config, loggingCallback);
```

> **Note:**  
> It is recommended to run this script as part of a `postinstall.js` process to automate Car Thing configuration after package installation.  
> - If `adbPath` is omitted, the program will attempt to use the system environment variables.  
> - If `clientId` is omitted, the default ADB device will be used. This may fail if multiple clients are connected.

## Usage

Below are basic usage examples for the `@deskthing/microphone` package.

### Importing the Package

```ts
import { audioManager, MicConfig } from '@deskthing/microphone';
```

### Configuring and Starting the Microphone

```ts
const micConfig: MicConfig = {
  sampleRate: 16000,
  channelCount: 1,
  bytesPerSample: 2,
  secondsPerChunk: 1,
};

// Configure the microphone
audioManager.configureMic(micConfig);

// Start capturing audio
audioManager.openMic();

// Stop capturing audio
audioManager.closeMic();
```

### Listening for Audio Packets

Audio packets are provided as `ArrayBuffer` objects. The first 44 bytes contain WAV headers with channel, rate, and other metadata.

```ts
audioManager.onAudioPacket((packet: ArrayBuffer) => {
  // Handle the raw audio packet (e.g., send to server, analyze, etc.)
  console.log('Received audio packet:', packet);
});
```

### Listening for Microphone State Changes

```ts
audioManager.onMicStateChange((state) => {
  console.log('Mic state changed:', state);
});
```

### Retrying the Audio Backend

This may be necessary for debugging purposes.

```ts
await audioManager.retryBackend();
```

These examples demonstrate how to configure the microphone, manage audio capture, and listen for audio data or state changes. For advanced usage, refer to the API documentation or review the source code.

## Features

- [x] Web microphone fallback
- [x] Daemon support
- [x] Supervisor configuration
- [x] Post-install process
- [x] Automatic reconnection
- [ ] Additional features coming soon

## Publishing

This project uses a CI workflow to build artifacts and publish the package to npm when a GitHub release matching the package version is created.

```sh
# Bump patch / minor / major version
npm version patch -m "Release v%s"
git push origin main
git push --tags
```
