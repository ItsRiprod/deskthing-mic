import * as fs from "fs/promises";
import { join, resolve, dirname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import https from "https";
import { fileURLToPath } from "url";

export type InstallConfig = {
  adbPath?: string;
  clientId?: string;
  /** Skips downloading the daemon if it doesn't exist */
  skipDownload?: boolean;
  /** Override the daemon download path */
  daemonPath?: string;
  skipConf?: boolean;
  skipSuperbirdConf?: boolean;
  /** Make a custom root directory rather than where this is executed from */
  root?: string;
};

// derive a directory that works in ESM and CJS
const __dirname_fallback =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

export type InstallLogger = (
  message: string,
  error?: Error | unknown,
  code?: number
) => void;

const execFileAsync = promisify(execFile);

// wrapper that logs stdout/stderr for every execFile call
async function execFileLogged(file: string, args: string[]): Promise<void> {
  try {
    const result = (await execFileAsync(file, args)) as {
      stdout?: string;
      stderr?: string;
    };
    if (result && result.stdout) {
      console.log(`[execFile] stdout: ${String(result.stdout)}`);
    }
    if (result && result.stderr) {
      console.error(`[execFile] stderr: ${String(result.stderr)}`);
    }
  } catch (err: any) {
    // if the child process wrote to stdout/stderr before erroring, include those
    if (err && err.stdout) {
      console.log(`[execFile][error] stdout: ${String(err.stdout)}`);
    }
    if (err && err.stderr) {
      console.error(`[execFile][error] stderr: ${String(err.stderr)}`);
    }
    // rethrow so callers can handle
    throw err;
  }
}

async function checkDaemonExists(daemonPath: string): Promise<boolean> {
  try {
    await fs.access(daemonPath);
    return true;
  } catch {
    return false;
  }
}

async function downloadDaemon(daemonPath: string): Promise<void> {
  const releasesUrl =
    "https://api.github.com/repos/ItsRiprod/deskthing-mic/releases/latest";
  const userAgent = { "User-Agent": "deskthing-mic-installer" };

  // Get latest release info
  const releaseInfo: any = await new Promise((resolve, reject) => {
    https
      .get(releasesUrl, { headers: userAgent }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
        res.on("error", reject);
      })
      .on("error", reject);
  });

  // Find asset
  const asset = releaseInfo.assets.find(
    (a: any) => a.name === "deskthing-daemon"
  );
  if (!asset)
    throw new Error("deskthing-daemon asset not found in latest release");

  // Download asset
  await new Promise<void>((resolve, reject) => {
    https
      .get(asset.browser_download_url, { headers: userAgent }, (res) => {
        const fileStream = fs.open(daemonPath, "w").then((fh) => {
          res.pipe(fh.createWriteStream());
          res.on("end", () => fh.close().then(resolve));
          res.on("error", reject);
        });
      })
      .on("error", reject);
  });
}

async function pushDaemon(adbPath: string, daemonPath: string): Promise<void> {
  await execFileLogged(adbPath, [
    "push",
    daemonPath,
    "/usr/bin/deskthing-daemon",
  ]);
}

async function makeDaemonExecutable(adbPath: string): Promise<void> {
  await execFileLogged(adbPath, [
    "shell",
    "chmod",
    "+x",
    "/usr/bin/deskthing-daemon",
  ]);
}

async function pullSupervisorConf(
  adbPath: string,
  root: string
): Promise<void> {
  await execFileLogged(adbPath, [
    "pull",
    "/etc/supervisord.conf",
    join(root, "supervisord.conf"),
  ]);
}

async function updateSupervisorConf(
  skipSuperbirdConf: boolean,
  root: string
): Promise<void> {
  const confPath = resolve(root, "supervisord.conf");
  let conf = await fs.readFile(confPath, "utf-8");

  // Add deskthing-daemon program if not present
  if (!conf.includes("[program:deskthing-daemon]")) {
    conf += `
[program:deskthing-daemon]
command=/usr/bin/deskthing-daemon
autostart=true
autorestart=true
stdout_logfile=/var/log/deskthing-daemon.log
stderr_logfile=/var/log/deskthing-daemon.err
`;
  }

  if (!skipSuperbirdConf) {
    // Update superbird program
    conf = conf.replace(/\[program:superbird\][\s\S]*?(?=\n\[|$)/g, (block) => {
      let updated = block;
      updated = updated.replace(/autorestart\s*=\s*\w+/g, "autorestart=false");
      updated = updated.replace(/autostart\s*=\s*\w+/g, "autostart=false");
      if (!/autorestart\s*=/.test(updated)) updated += "\nautorestart=false";
      if (!/autostart\s*=/.test(updated)) updated += "\nautostart=false";
      return updated;
    });
  }
  await fs.writeFile(confPath, conf, "utf-8");
}

async function pushSupervisorConf(
  adbPath: string,
  root: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      adbPath,
      ["push", join(root, "supervisord.conf"), "/etc/supervisord.conf"],
      (error, stdout, stderr) => {
        if (stdout) console.log("[pushSupervisorConf] stdout:", String(stdout));
        if (stderr) console.error("[pushSupervisorConf] stderr:", String(stderr));
        if (error) {
          console.error("[pushSupervisorConf] error:", error);
          reject(error);
        } else {
          resolve();
        }
      }
    );
  });
}

async function restartSupervisorCTL(adbPath: string): Promise<void> {
  await execFileLogged(adbPath, ["shell", "supervisorctl", "reread"]);
  await execFileLogged(adbPath, ["shell", "supervisorctl", "update"]);
  await execFileLogged(adbPath, ["shell", "supervisorctl", "start", "deskthing-daemon"]);
  await execFileLogged(adbPath, ["shell", "supervisorctl", "restart", "superbird"]);
}

async function cleanupFiles(daemonPath: string, root: string): Promise<void> {
  const confPath = resolve(root, "supervisord.conf");
  await fs.unlink(confPath);

  // cleanup daemon if it was downloaded
  try {
    await fs.access(daemonPath);
    await fs.unlink(daemonPath);
  } catch {
    // File doesn't exist, nothing to clean up
  }
}

/**
 * Installs the deskthing-daemon.
 * @param config The installation configuration.
 * @param logger The logger function.
 */
export async function install(
  config: InstallConfig,
  logger: InstallLogger
): Promise<void> {
  const {
    adbPath = "adb",
    root = resolve(__dirname_fallback, "../lib/"),
    skipDownload = false,
    skipConf = false,
    skipSuperbirdConf = false,
  } = config;

  let daemonPath = config.daemonPath;

  if (!daemonPath) {
    daemonPath = resolve(root, "deskthing-daemon");
  }

  logger("Starting installation of deskthing-daemon...");

  try {
    if (!(await checkDaemonExists(daemonPath))) {
      if (skipDownload) {
        throw new Error(
          "deskthing-daemon does not exist and download is skipped."
        );
      }

      logger("Downloading deskthing-daemon...");
      await downloadDaemon(daemonPath);
    }
    logger("Pushing deskthing-daemon to device...");
    await pushDaemon(adbPath, daemonPath);
    logger("Setting execute permissions on deskthing-daemon...");
    await makeDaemonExecutable(adbPath);
    if (!skipConf) {
      logger("Configuring supervisord to manage deskthing-daemon...");
      await pullSupervisorConf(adbPath, root);
      logger("Updating supervisord.conf to include deskthing-daemon...");
      await updateSupervisorConf(skipSuperbirdConf, root);
      logger("Pushing updated supervisord.conf to device...");
      await pushSupervisorConf(adbPath, root);
      logger("Restarting supervisor to apply new configuration...");
      await restartSupervisorCTL(adbPath);
    } else {
      logger("Skipping supervisor configuration update as per config.");
    }
  } catch (error) {
    logger("Installation failed.", error);
    throw error;
  } finally {
    logger("Cleaning up temporary files...");
    await cleanupFiles(daemonPath, root);
  }
}
export async function uninstall(
  config: InstallConfig,
  logger: InstallLogger
): Promise<void> {
  const {
    adbPath = "adb",
    root = resolve(__dirname_fallback, "../lib/"),
    skipConf = false,
    daemonPath: providedDaemonPath,
  } = config;

  const daemonPath = providedDaemonPath ?? resolve(root, "deskthing-daemon");

  logger("Starting uninstallation of deskthing-daemon...");

  try {
    if (!skipConf) {
      logger("Stopping deskthing-daemon via supervisorctl...");
      try {
        await execFileLogged(adbPath, [
          "shell",
          "supervisorctl",
          "stop",
          "deskthing-daemon",
        ]);
      } catch (e) {
        // stopping may fail if it's not running; continue
        logger("Warning stopping deskthing-daemon failed (may not be running).", e);
      }

      logger("Pulling supervisord.conf from device...");
      await pullSupervisorConf(adbPath, root);

      logger("Removing [program:deskthing-daemon] block from supervisord.conf...");
      const confPath = resolve(root, "supervisord.conf");
      let conf = await fs.readFile(confPath, "utf-8");
      // remove the program block for deskthing-daemon
      conf = conf.replace(/\[program:deskthing-daemon\][\s\S]*?(?=\n\[|$)/g, "");
      await fs.writeFile(confPath, conf, "utf-8");

      logger("Pushing updated supervisord.conf to device...");
      await pushSupervisorConf(adbPath, root);

      logger("Reloading supervisor configuration...");
      await execFileLogged(adbPath, ["shell", "supervisorctl", "reread"]);
      await execFileLogged(adbPath, ["shell", "supervisorctl", "update"]);
    } else {
      logger("Skipping supervisor configuration changes as per config.");
    }

    logger("Removing deskthing-daemon binary from device...");
    try {
      await execFileLogged(adbPath, ["shell", "rm", "-f", "/usr/bin/deskthing-daemon"]);
    } catch (e) {
      // if removal fails, log but continue to cleanup local files
      logger("Failed to remove deskthing-daemon from device.", e);
    }
  } catch (error) {
    logger("Uninstallation failed.", error);
    throw error;
  } finally {
    logger("Cleaning up temporary files...");
    // attempt to remove local pulled supervisord.conf and local daemon (if present)
    try {
      await cleanupFiles(daemonPath, root);
    } catch (e) {
      logger("Cleanup failed.", e);
    }
  }
}
