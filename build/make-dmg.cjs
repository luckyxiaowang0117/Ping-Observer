const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const appName = 'Ping Observer.app';
const appPath = path.join(root, 'dist', 'mac-arm64', appName);
const stage = path.join(root, 'dist', 'dmg-staging');
const output = path.join(root, 'dist', `Ping-Observer-${version}-macOS-arm64.dmg`);
if (!fs.existsSync(appPath)) throw new Error(`Packaged app missing: ${appPath}`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
// Keep Electron's internal framework symlinks relative to the app bundle.
fs.cpSync(appPath, path.join(stage, appName), { recursive: true, verbatimSymlinks: true });
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
fs.rmSync(output, { force: true });
execFileSync('/usr/bin/hdiutil', ['create', '-volname', `Ping Observer ${version}`, '-srcfolder', stage, '-ov', '-format', 'UDZO', output], { stdio: 'inherit' });
console.log(`Created ${output}`);
