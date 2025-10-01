import { build } from 'esbuild'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

const root = process.cwd()
const outdir = path.join(root, 'dist')
const libDir = path.join(outdir, 'lib')

async function run() {
  // Clean dist to ensure a fresh build
  try {
    if (fs.existsSync(outdir)) {
      fs.rmSync(outdir, { recursive: true, force: true })
    }
    fs.mkdirSync(libDir, { recursive: true })
  } catch (err) {
    console.error('Failed to prepare dist directory', err)
    process.exit(1)
  }

  await build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2020'],
    sourcemap: true,
    outdir,
    splitting: false,
    minify: false,
    logLevel: 'info'
  })

  // Build utils entry as a separate small bundle (no other server logic)
  await build({
    entryPoints: [path.join(root, 'src', 'utils', 'index.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2020'],
    sourcemap: true,
    outbase: path.join(root, 'src', 'utils'),
    outdir: path.join(outdir, 'utils'),
    splitting: false,
    minify: false,
    logLevel: 'info'
  })

  // Emit declaration files with tsc
  try {
    execSync('npx tsc -p tsconfig.json --emitDeclarationOnly', { stdio: 'inherit' })
  } catch (err) {
    console.error('Failed to emit declaration files', err)
    process.exit(1)
  }

  // Build Go daemon and place binary under dist/lib/deskthing-daemon
  try {
    // Allow overriding target via env, default to linux/arm64
    const goTargetOS = process.env.GO_TARGET_OS || 'linux'
    const goTargetArch = process.env.GO_TARGET_ARCH || 'arm64'
    const archSuffix = `${goTargetOS}-${goTargetArch}`
    const outBin = path.join(libDir, `deskthing-daemon`)
    console.log('Building Go daemon for', archSuffix, 'into', outBin)
    // Build within the daemon directory so go uses the daemon/go.mod file.
    // Pass GOOS/GOARCH through the environment so cross-compilation is used.
    execSync(`go build -o "${outBin}"`, {
      stdio: 'inherit',
      cwd: path.join(root, 'daemon'),
      env: { ...process.env, GOOS: goTargetOS, GOARCH: goTargetArch },
    })
  } catch (err) {
    console.error('Failed to build Go daemon (is Go installed and GOPATH/module correct?)', err)
    process.exit(1)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
