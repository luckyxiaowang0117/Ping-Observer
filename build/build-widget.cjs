const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const projectPath = path.join(root, 'widget', 'PingObserverWidget.xcodeproj');
const projectText = fs.readFileSync(path.join(projectPath, 'project.pbxproj'), 'utf8');
const configuredTeam = projectText.match(/DEVELOPMENT_TEAM = ([A-Z0-9]{10});/);
const team = process.env.PING0_TEAM_ID || process.env.DEVELOPMENT_TEAM || configuredTeam?.[1];
if (!team || !/^[A-Z0-9]{10}$/.test(team)) {
  throw new Error('macOS WidgetKit packaging needs PING0_TEAM_ID: the Team ID shown for your Apple account in Xcode. No paid developer membership is required for personal local use.');
}
const group = `${team}.group.cc.ping0.observer`;
const output = path.join(root, 'build', 'macos-widget');
const derived = path.join(root, 'build', 'widget-derived');
const developerDirs = [
  process.env.DEVELOPER_DIR,
  '/Applications/Xcode.app/Contents/Developer',
  '/Volumes/gutai/Xcode.app/Contents/Developer'
].filter(Boolean);
const developerDir = developerDirs.find(candidate => fs.existsSync(path.join(candidate, 'usr', 'bin', 'xcodebuild')));
if (!developerDir) throw new Error('Full Xcode was not found. Install Xcode or set DEVELOPER_DIR to its Contents/Developer folder.');
const xcodebuild = path.join(developerDir, 'usr', 'bin', 'xcodebuild');
const entitlementsTemplate = fs.readFileSync(path.join(root, 'build', 'entitlements.mac.plist'), 'utf8');
fs.writeFileSync(path.join(root, 'build', 'entitlements.mac.generated.plist'), entitlementsTemplate.replace('__PING0_APP_GROUP__', group));
fs.writeFileSync(path.join(root, 'build', 'generated-app-group.json'), JSON.stringify({ group }, null, 2));
fs.rmSync(output, { recursive: true, force: true });
execFileSync(xcodebuild, [
  '-project', projectPath,
  '-scheme', 'PingObserverWidget', '-configuration', 'Release', '-sdk', 'macosx',
  '-derivedDataPath', derived, 'CODE_SIGN_STYLE=Automatic', `DEVELOPMENT_TEAM=${team}`,
  `PING0_APP_GROUP=${group}`, '-allowProvisioningUpdates', 'build'
], { stdio: 'inherit', env: { ...process.env, DEVELOPER_DIR: developerDir } });
const extension = path.join(derived, 'Build', 'Products', 'Release', 'PingObserverWidget.appex');
if (!fs.existsSync(extension)) throw new Error(`Widget extension was not produced: ${extension}`);
fs.mkdirSync(output, { recursive: true });
fs.cpSync(extension, path.join(output, 'PingObserverWidget.appex'), { recursive: true });
const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
const identity = identities.match(/^\s*\d+\)\s+([A-F0-9]{40})\s+"Apple Development:/m)?.[1];
if (!identity) throw new Error('No valid Apple Development signing identity was found in the login keychain.');
const helperApp = path.join(output, 'WidgetReloadHelper.app');
const helperContents = path.join(helperApp, 'Contents');
const helperExecutable = path.join(helperContents, 'MacOS', 'WidgetReloadHelper');
fs.mkdirSync(path.dirname(helperExecutable), { recursive: true });
execFileSync(path.join(developerDir, 'Toolchains', 'XcodeDefault.xctoolchain', 'usr', 'bin', 'swiftc'), [
  '-parse-as-library', '-framework', 'AppKit', '-framework', 'WidgetKit',
  '-o', helperExecutable, path.join(root, 'widget', 'WidgetReloadHelper.swift')
], { stdio: 'inherit', env: { ...process.env, DEVELOPER_DIR: developerDir } });
const helperInfo = fs.readFileSync(path.join(root, 'widget', 'WidgetReloadHelper-Info.plist'), 'utf8');
fs.writeFileSync(path.join(helperContents, 'Info.plist'), helperInfo.replace('$(PING0_APP_GROUP)', group));
execFileSync('/usr/bin/codesign', [
  '--force', '--timestamp=none', '--options', 'runtime', '--entitlements',
  path.join(root, 'build', 'entitlements.mac.generated.plist'), '--sign', identity, helperApp
], { stdio: 'inherit' });
process.env.DEVELOPER_DIR = developerDir;
process.env.PING0_APP_GROUP = group;
process.env.CSC_NAME = process.env.CSC_NAME || identity;
execFileSync(path.join(root, 'node_modules', '.bin', 'electron-builder'), ['--mac', '--arm64', '--dir'], {
  cwd: root, stdio: 'inherit', env: process.env
});
const appBundle = path.join(root, 'dist', 'mac-arm64', 'Ping Observer.app');
const widgetBundle = path.join(appBundle, 'Contents', 'PlugIns', 'PingObserverWidget.appex');
const embeddedHelper = path.join(appBundle, 'Contents', 'Helpers', 'WidgetReloadHelper.app');
const widgetEntitlements = path.join(root, 'build', 'widget-entitlements.generated.plist');
const widgetEntitlementsTemplate = fs.readFileSync(path.join(root, 'widget', 'PingObserverWidget', 'PingObserverWidget.entitlements'), 'utf8');
fs.writeFileSync(widgetEntitlements, widgetEntitlementsTemplate.replace('$(PING0_APP_GROUP)', group));
execFileSync('/usr/bin/codesign', [
  '--force', '--timestamp=none', '--options', 'runtime', '--entitlements', widgetEntitlements, '--sign', identity, widgetBundle
], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', [
  '--force', '--timestamp=none', '--options', 'runtime', '--entitlements',
  path.join(root, 'build', 'entitlements.mac.generated.plist'), '--sign', identity, embeddedHelper
], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', [
  '--force', '--timestamp=none', '--options', 'runtime', '--entitlements',
  path.join(root, 'build', 'entitlements.mac.generated.plist'), '--sign', identity, appBundle
], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'inherit' });
console.log(`Built Ping Observer 2.0 and WidgetKit extension for ${group}`);
