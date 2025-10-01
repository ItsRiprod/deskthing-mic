export type InstallConfig = {
  adbPath?: string
  clientId?: string
}

export type InstallLogger = (message: string) => void

/**
 * install performs post-install configuration steps for the DeskThing microphone.
 *
 * Outline (not implemented):
 * 1) Validate `adbPath` and `clientId` inputs.
 * 2) Ensure adb is available (or fall back to env PATH).
 * 3) Configure ADB client and push any required files.
 * 4) Optionally register a SupervisorCTL service or other system hooks.
 * 5) Log progress via the provided `logger` callback.
 *
 * Implementations should throw or reject with an Error on failure.
 */
export async function install(config: InstallConfig, logger?: InstallLogger): Promise<void> {
  const { adbPath = 'adb', clientId = 'default_client' } = config

  // make it executable
  // adb shell chmod +x /usr/bin/deskthing-daemon

  // update supervisor config
  // adb push ./supervisord.conf /etc/

  // pull supervisor conf to modify it
  // adb pull /etc/supervisord.conf ./supervisord.conf

  // push the daemon to /usr/bin/deskthing-daemon
  // adb push ./deskthing-daemon /usr/bin/deskthing-daemon
}

export default install
