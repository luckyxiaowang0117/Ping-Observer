const { app, BrowserWindow, powerMonitor, ipcMain, shell, session, Menu, Tray, nativeImage, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const isWindows = process.platform === 'win32';
const legacyDataRoot = path.join(app.getPath('desktop'), 'IP', 'ping', 'data');
const defaultUserDataPath = app.getPath('userData');
let dataRoot = legacyDataRoot;
let userDataRoot = path.join(dataRoot, 'app-data');
if (isWindows) {
  if (app.isPackaged) {
    const installDirectory = path.dirname(app.getPath('exe'));
    const writeProbe = path.join(installDirectory, `.ping-observer-write-${process.pid}`);
    try {
      fs.writeFileSync(writeProbe, '');
      fs.rmSync(writeProbe, { force: true });
      dataRoot = path.join(installDirectory, 'data');
      userDataRoot = path.join(dataRoot, 'app-data');
    } catch (error) {
      try { fs.rmSync(writeProbe, { force: true }); } catch {}
      console.warn('Install directory is not writable; using the Windows user data folder:', error.message);
      dataRoot = path.join(defaultUserDataPath, 'data');
      userDataRoot = defaultUserDataPath;
    }
  } else {
    dataRoot = path.join(defaultUserDataPath, 'data');
    userDataRoot = defaultUserDataPath;
  }
}
app.setPath('userData', userDataRoot);
const stateFile = path.join(dataRoot, 'state.json');
const PING0_PARTITION = 'persist:ping0-source';
const PING0_GEO_URL = 'https://ping0.cc/geo';
const ALLOWED_INTERVALS = [5, 10, 15, 30, 60, 120];
let mainWindow;
let floatingWindow;
let tray;
let sourceWindow;
let ping0Session;
let refreshTimer;
let windowDragOffset;
let lastRefreshAt = 0;
let lastAttemptAt = 0;
let refreshing = false;
let isQuitting = false;
let floatingReady = false;
let floatingBoundsTimer;
const hasSingleInstance = !isWindows || app.requestSingleInstanceLock();
let state = {
  settings: { autoRefresh: true, intervalMinutes: 30, floatingEnabled: true, floatingAlwaysOnTop: true, floatingBounds: null },
  current: null,
  history: [],
  source: { status: 'idle', detail: '' },
  networkRoute: { label: '系统代理', resolved: '' }
};

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state = { ...state, ...saved, settings: { ...state.settings, ...(saved.settings || {}) }, source: { ...state.source, ...(saved.source || {}) } };
    if (!saved.networkRoute?.resolved) {
      if (state.current) {
        state.current = null;
        state.source = { status: 'loading', detail: '网络检测已切换到系统代理，正在重新获取当前 IP' };
      }
      state.history = (state.history || []).map(item => ({ ...item, networkRoute: item.networkRoute || 'legacy' }));
    }
    lastRefreshAt = Number(state.current?.checkedAt || 0);
  } catch {}
}
function removeEmptyLegacyParents() {
  for (const parent of [path.dirname(legacyDataRoot), path.dirname(path.dirname(legacyDataRoot))]) {
    try { fs.rmdirSync(parent); } catch {}
  }
}
function migrateLegacyData() {
  if (!isWindows || path.resolve(legacyDataRoot) === path.resolve(dataRoot) || !fs.existsSync(legacyDataRoot)) return;
  try {
    if (!fs.existsSync(dataRoot)) {
      try {
        fs.renameSync(legacyDataRoot, dataRoot);
        removeEmptyLegacyParents();
        return;
      } catch {}
    }

    fs.mkdirSync(dataRoot, { recursive: true });
    const oldStateFile = path.join(legacyDataRoot, 'state.json');
    if (fs.existsSync(stateFile) || !fs.existsSync(oldStateFile)) return;
    fs.copyFileSync(oldStateFile, stateFile);

    const oldUserData = path.join(legacyDataRoot, 'app-data');
    if (fs.existsSync(oldUserData)) {
      fs.cpSync(oldUserData, userDataRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter: source => !['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(path.basename(source))
      });
    }
    fs.rmSync(legacyDataRoot, { recursive: true, force: true });
    removeEmptyLegacyParents();
  } catch (error) {
    console.warn('Unable to migrate data from the old Desktop/IP folder:', error.message);
  }
}
function saveState() {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  publishWidgetSnapshot();
}
function publishWidgetSnapshot() {
  if (process.platform !== 'darwin') return;
  let group = process.env.PING0_APP_GROUP;
  if (!group && app.isPackaged) {
    try { group = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'app-group-id.json'), 'utf8')).group; } catch {}
  }
  if (!group || !/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(group)) return;
  try {
    const payload = { current: state.current, updatedAt: Date.now() };
    const helperPath = app.isPackaged
      ? path.join(path.dirname(process.resourcesPath), 'Helpers', 'WidgetReloadHelper.app', 'Contents', 'MacOS', 'WidgetReloadHelper')
      : path.join(__dirname, '..', 'build', 'macos-widget', 'WidgetReloadHelper.app', 'Contents', 'MacOS', 'WidgetReloadHelper');
    const helper = spawn(helperPath, [], { stdio: ['pipe', 'ignore', 'pipe'] });
    let helperError = '';
    helper.stderr.on('data', data => { helperError += data.toString(); });
    helper.once('spawn', () => helper.stdin.end(JSON.stringify(payload)));
    helper.on('error', error => console.warn('Unable to start widget sync helper:', error.message));
    helper.on('close', code => {
      if (code !== 0) console.warn('Unable to update widget snapshot:', helperError.trim() || `helper exited ${code}`);
    });
  } catch (error) {
    console.warn('Unable to update widget snapshot:', error.message);
  }
}
function publish() {
  for (const win of [mainWindow, floatingWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('state:update', state);
  }
  updateTrayMenu();
}
function routeLabel(route) {
  if (/\bSOCKS\b/i.test(route)) return 'SOCKS 代理';
  if (/\bPROXY\b/i.test(route)) return 'HTTP 代理';
  if (/\bDIRECT\b/i.test(route)) return '系统直连';
  return '系统代理';
}
async function configureNetworkSession() {
  ping0Session = session.fromPartition(PING0_PARTITION);
  await ping0Session.setProxy({ mode: 'system' });
  const resolved = await ping0Session.resolveProxy(PING0_GEO_URL);
  state.networkRoute = { label: routeLabel(resolved), resolved };
  saveState();
}
async function getGeo() {
  if (!ping0Session) throw new Error('系统代理网络会话尚未就绪');
  const response = await ping0Session.fetch(PING0_GEO_URL, {
    headers: { 'User-Agent': 'PingObserver/1.0 (desktop; https://ping0.cc)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`ping0.cc responded ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  if (lines.length < 4) throw new Error('ping0.cc did not return the expected IP details');
  return { ip: lines[0], location: lines[1], asn: lines[2], org: lines[3] };
}
function parseDetailText(text) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const typeMatch = clean.match(/(?:IP\s*类型|IP类型)[^\n]{0,40}\n+\s*(IDC\s*机房\s*IP|家庭宽带\s*IP|IDC机房IP|家庭宽带IP)/i);
  const riskMatch = clean.match(/风控值[^\n]{0,50}\n+\s*(\d{1,3})\s*%?\s*([^\n]{0,20})/i);
  const sharedMatch = clean.match(/共享人数[^\n]{0,50}\n+\s*(1\s*[-–~至]\s*10|10\s*[-–~至]\s*100|100\s*[-–~至]\s*1000|1000\s*[-–~至]\s*10000|10000\s*\+?)([^\n]{0,25})/i);
  return {
    ipType: typeMatch ? typeMatch[1].replace(/\s+/g,'') : null,
    riskValue: riskMatch ? Number(riskMatch[1]) : null,
    riskLabel: riskMatch ? riskMatch[2].trim() : null,
    sharedUsers: sharedMatch ? (sharedMatch[1].replace(/\s/g,'') + sharedMatch[2].trim()) : null,
    challenge: /turnstile|captcha|安全验证|人机验证|just a moment|checking your browser/i.test(clean)
  };
}
function getSourceWindow() {
  if (sourceWindow && !sourceWindow.isDestroyed()) return sourceWindow;
  sourceWindow = new BrowserWindow({
    width: 1080, height: 760, minWidth: 860, minHeight: 620,
    title: 'Ping0 查询页面', show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: PING0_PARTITION }
  });
  sourceWindow.on('closed', () => { sourceWindow = null; });
  sourceWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  return sourceWindow;
}
async function fetchWebsiteDetails(ip) {
  const win = getSourceWindow();
  state.source = { status: 'loading', detail: '正在读取 ping0.cc 查询页面' };
  publish();
  try {
    await Promise.race([
      win.loadURL(`https://ip.ping0.cc/ip/${encodeURIComponent(ip)}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('页面响应超时')), 26000))
    ]);
    await new Promise(resolve => setTimeout(resolve, 2600));
    const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    const parsed = parseDetailText(String(text || ''));
    if (parsed.challenge) {
      state.source = { status: 'verification', detail: 'ping0.cc 要求安全验证。请在弹出的页面完成验证，再返回应用点击“立即检测”。' };
      win.show(); win.focus();
      return parsed;
    }
    const gotAtLeastOne = parsed.ipType || parsed.riskValue !== null || parsed.sharedUsers;
    state.source = gotAtLeastOne
      ? { status: 'ok', detail: `数据读取自 ping0.cc；取 IP 与详情均使用${state.networkRoute.label}` }
      : { status: 'unavailable', detail: '页面未提供可读取的风控值或 IP 类型' };
    return parsed;
  } catch (error) {
    state.source = { status: 'unavailable', detail: error.message || '无法读取 ping0.cc 查询页面' };
    return { ipType: null, riskValue: null, riskLabel: null, sharedUsers: null, challenge: false };
  }
}
async function refreshNow() {
  if (refreshing) return state;
  refreshing = true;
  lastAttemptAt = Date.now();
  state.source = { status: 'loading', detail: '正在连接 ping0.cc' };
  publish();
  try {
    const geo = await getGeo();
    const detail = await fetchWebsiteDetails(geo.ip);
    const current = { ...geo, ...detail, checkedAt: Date.now() };
    const prev = state.current;
    const changed = !prev || prev.ip !== current.ip || prev.riskValue !== current.riskValue || prev.ipType !== current.ipType;
    state.current = current;
    if (changed) state.history.unshift({ checkedAt: current.checkedAt, ip: current.ip, riskValue: current.riskValue, ipType: current.ipType, networkRoute: 'system' });
    state.history = state.history.slice(0, 336);
    lastRefreshAt = Date.now();
    saveState();
  } catch (error) {
    state.source = { status: 'error', detail: error.message || '连接失败' };
    state.error = error.message || '连接失败';
  } finally {
    refreshing = false;
    publish();
  }
  return state;
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!state.settings.autoRefresh) return;
  const intervalMs = Math.max(1, Number(state.settings.intervalMinutes) || 30) * 60 * 1000;
  const lastCheck = Math.max(lastRefreshAt, lastAttemptAt);
  const elapsed = Date.now() - lastCheck;
  const delay = lastCheck ? Math.max(1000, intervalMs - elapsed) : 1000;
  refreshTimer = setTimeout(async () => { await refreshNow(); scheduleRefresh(); }, delay);
}
function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const titleBarOptions = process.platform === 'darwin'
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 18 } }
    : {};
  mainWindow = new BrowserWindow({
    width: 920, height: 670, minWidth: 700, minHeight: 560,
    title: 'Ping Observer', backgroundColor: '#f4f5ef', ...titleBarOptions,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.on('close', event => {
    if (isWindows && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('did-finish-load', () => publish());
  return mainWindow;
}

function getFloatingBounds() {
  const saved = state.settings.floatingBounds;
  const width = 340;
  const height = 244;
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return { x: workArea.x + workArea.width - width - 22, y: workArea.y + workArea.height - height - 22, width, height };
  }
  const display = screen.getDisplayNearestPoint({ x: saved.x + width / 2, y: saved.y + height / 2 });
  const area = display.workArea;
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height
  };
}

function persistFloatingBounds() {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const { x, y, width, height } = floatingWindow.getBounds();
  state.settings.floatingBounds = { x, y, width, height };
  clearTimeout(floatingBoundsTimer);
  floatingBoundsTimer = setTimeout(saveState, 350);
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow;
  const bounds = getFloatingBounds();
  floatingWindow = new BrowserWindow({
    ...bounds,
    title: 'Ping Observer 悬浮窗',
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: state.settings.floatingAlwaysOnTop !== false,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  floatingReady = false;
  floatingWindow.loadFile(path.join(__dirname, 'floating.html'));
  floatingWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  floatingWindow.webContents.on('did-finish-load', () => publish());
  floatingWindow.on('move', persistFloatingBounds);
  floatingWindow.once('ready-to-show', () => {
    floatingReady = true;
    if (state.settings.floatingEnabled && floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.show();
  });
  floatingWindow.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      persistFloatingBounds();
      floatingWindow.hide();
      state.settings.floatingEnabled = false;
      saveState();
      publish();
    }
  });
  floatingWindow.on('closed', () => { floatingWindow = null; });
  return floatingWindow;
}

function setFloatingVisible(visible) {
  state.settings.floatingEnabled = Boolean(visible);
  if (visible) {
    const win = createFloatingWindow();
    if (floatingReady) win.show();
  } else if (floatingWindow && !floatingWindow.isDestroyed()) {
    persistFloatingBounds();
    floatingWindow.hide();
  }
  saveState();
  publish();
  return state.settings.floatingEnabled;
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开 Ping Observer', click: () => createWindow() },
    { label: state.settings.floatingEnabled ? '隐藏悬浮窗' : '显示悬浮窗', click: () => setFloatingVisible(!state.settings.floatingEnabled) },
    { label: '悬浮窗保持置顶', type: 'checkbox', checked: state.settings.floatingAlwaysOnTop !== false, click: item => {
      state.settings.floatingAlwaysOnTop = item.checked;
      if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.setAlwaysOnTop(item.checked);
      saveState(); publish();
    } },
    { type: 'separator' },
    { label: state.settings.autoRefresh ? '暂停自动更新' : '开启自动更新', click: () => {
      state.settings.autoRefresh = !state.settings.autoRefresh;
      saveState(); scheduleRefresh(); publish();
    } },
    { label: '立即检测', click: () => refreshNow() },
    { type: 'separator' },
    { label: '退出 Ping Observer', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('Ping Observer');
  tray.on('click', () => createWindow());
  updateTrayMenu();
}

ipcMain.handle('state:get', () => state);
ipcMain.handle('refresh:now', () => refreshNow());
ipcMain.handle('window:show-main', () => { createWindow(); return true; });
ipcMain.handle('floating:set-visible', (_event, visible) => setFloatingVisible(visible));
ipcMain.handle('floating:toggle', () => setFloatingVisible(!state.settings.floatingEnabled));
ipcMain.handle('settings:auto-refresh', (_event, enabled) => {
  state.settings.autoRefresh = Boolean(enabled);
  saveState(); scheduleRefresh(); publish(); return state;
});
ipcMain.handle('settings:interval', (_event, minutes) => {
  const value = Number(minutes);
  if (!ALLOWED_INTERVALS.includes(value)) return state;
  state.settings.intervalMinutes = value;
  saveState(); scheduleRefresh(); publish(); return state;
});
ipcMain.handle('source:open', async () => {
  const ip = state.current?.ip;
  if (!ip) return false;
  const win = getSourceWindow();
  await win.loadURL(`https://ip.ping0.cc/ip/${encodeURIComponent(ip)}`);
  win.show(); win.focus();
  return true;
});
ipcMain.handle('link:open', (_event, url) => {
  if (url === 'https://ping0.cc' || url === 'https://ping0.cc/ip/faq') return shell.openExternal(url);
  return false;
});
ipcMain.on('window:drag-begin', (event, point) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const bounds = mainWindow.getBounds();
  windowDragOffset = { x: Number(point?.screenX) - bounds.x, y: Number(point?.screenY) - bounds.y };
});
ipcMain.on('window:drag-move', (event, point) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !windowDragOffset) return;
  const x = Math.round(Number(point?.screenX) - windowDragOffset.x);
  const y = Math.round(Number(point?.screenY) - windowDragOffset.y);
  if (Number.isFinite(x) && Number.isFinite(y)) mainWindow.setPosition(x, y, false);
});
ipcMain.on('window:drag-end', event => {
  if (mainWindow && event.sender === mainWindow.webContents) windowDragOffset = null;
});

if (isWindows && !hasSingleInstance) app.quit();
if (isWindows && hasSingleInstance) app.on('second-instance', () => createWindow());

app.whenReady().then(() => {
  if (isWindows && !hasSingleInstance) return;
  migrateLegacyData();
  loadState();
  createWindow();
  if (isWindows) {
    createTray();
    if (state.settings.floatingEnabled) createFloatingWindow();
  }
  configureNetworkSession().then(() => {
    scheduleRefresh();
    if (state.settings.autoRefresh || !state.current) refreshNow();
    else publish();
  }).catch(error => {
    state.source = { status: 'error', detail: `无法启用系统代理：${error.message}` };
    state.error = state.source.detail;
    publish();
  });
  powerMonitor.on('resume', () => {
    const now = Date.now();
    const last = Math.max(lastRefreshAt, lastAttemptAt);
    const intervalMs = (Number(state.settings.intervalMinutes) || 30) * 60 * 1000;
    if (state.settings.autoRefresh && now - last >= intervalMs) refreshNow();
  });
  app.on('activate', () => {
    if (isWindows) createWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('before-quit', () => { isQuitting = true; saveState(); clearTimeout(refreshTimer); clearTimeout(floatingBoundsTimer); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !isWindows) app.quit(); });
