// Flips Electron fuses on the packaged binary to harden it against tampering.
// electron-builder runs afterPack before any signing step, which is the only safe
// window: flipping a fuse rewrites bytes in the executable and would invalidate a
// signature applied earlier.
//
// electron-builder already computes and embeds the app.asar hashes on every build
// (Windows: an exe resource; macOS: ElectronAsarIntegrity in the plist), but Electron
// ignores them unless EnableEmbeddedAsarIntegrityValidation is on. Turning that fuse on
// is what makes a swapped-in app.asar fail to boot instead of silently running.
//
// Run: happens automatically via the build.afterPack hook in package.json.
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const path = require('path')

// Electron only implements the asar integrity check on Windows and macOS, and hashes
// are only embedded there, so enabling it on Linux would assert against nothing.
const INTEGRITY_PLATFORMS = ['win32', 'darwin']

function electronBinary(context) {
  const { appOutDir, electronPlatformName, packager } = context
  const product = packager.appInfo.productFilename

  if (electronPlatformName === 'darwin') return path.join(appOutDir, `${product}.app`)
  if (electronPlatformName === 'win32') return path.join(appOutDir, `${product}.exe`)
  return path.join(appOutDir, packager.executableName)
}

module.exports = async function afterPack(context) {
  const target = electronBinary(context)
  const platform = context.electronPlatformName

  await flipFuses(target, {
    version: FuseVersion.V1,

    // Stop the shipped binary from being reused as a general-purpose Node interpreter.
    // Nothing in src/main relies on this: the only spawn is lich-manager launching ruby.
    [FuseV1Options.RunAsNode]: false,

    // Close the two remote-debugging doors: --inspect on a production build and
    // NODE_OPTIONS injection from the environment.
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // Refuse to boot from a loose app/ directory dropped next to the asar, which is
    // otherwise the simplest way to shadow packaged code with modified code.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    ...(INTEGRITY_PLATFORMS.includes(platform)
      ? { [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true }
      : {}),

    // Builds are unsigned (CSC_IDENTITY_AUTO_DISCOVERY=false in CI), and macOS arm64
    // needs at least an ad-hoc signature to launch at all. Flipping fuses breaks the
    // one electron-builder applied, so re-apply it here.
    resetAdHocDarwinSignature: platform === 'darwin',
  })

  // EnableCookieEncryption is deliberately left alone: switching it on re-keys the
  // cookie store, which would sign existing users out on their next update.
  console.log(`  • fuses flipped  platform=${platform} target=${path.basename(target)}`)
}
