const { Menu, Tray, shell, app, ipcMain } = require('electron')
const i18n = require('i18next')
const path = require('path')
const addToIpfs = require('./add-to-ipfs')
const logger = require('./common/logger')
const store = require('./common/store')
const moveRepositoryLocation = require('./move-repository-location')
const runGarbageCollector = require('./run-gc')
const { setCustomBinary, clearCustomBinary, hasCustomBinary } = require('./custom-ipfs-binary')
const { STATUS } = require('./daemon')
const { IS_MAC, IS_WIN, VERSION, GO_IPFS_VERSION } = require('./common/consts')

const { CONFIG_KEY: SCREENSHOT_KEY, SHORTCUT: SCREENSHOT_SHORTCUT, takeScreenshot } = require('./take-screenshot')
const { CONFIG_KEY: DOWNLOAD_KEY, SHORTCUT: DOWNLOAD_SHORTCUT, downloadCid } = require('./download-cid')
const { CONFIG_KEY: AUTO_LAUNCH_KEY, isSupported: supportsLaunchAtLogin } = require('./auto-launch')
const { CONFIG_KEY: PUBSUB_KEY } = require('./enable-pubsub')
const { CONFIG_KEY: NAMESYS_PUBSUB_KEY } = require('./enable-namesys-pubsub')
const { CONFIG_KEY: AUTO_GC_KEY } = require('./automatic-gc')
const { CONFIG_KEY: IPFS_PATH_KEY } = require('./ipfs-on-path')
const { CONFIG_KEY: NPM_IPFS_KEY } = require('./npm-on-ipfs')
const { CONFIG_KEY: AUTO_LAUNCH_WEBUI_KEY } = require('./webui')

const CONFIG_KEYS = [
  AUTO_LAUNCH_KEY,
  AUTO_LAUNCH_WEBUI_KEY,
  AUTO_GC_KEY,
  IPFS_PATH_KEY,
  NPM_IPFS_KEY,
  SCREENSHOT_KEY,
  DOWNLOAD_KEY,
  PUBSUB_KEY,
  NAMESYS_PUBSUB_KEY
]

// We show them if user enabled them before, but hide when off
const DEPRECATED_KEYS = new Set([
  IPFS_PATH_KEY, // brittle, buggy, way better if user does this by hand for now
  NPM_IPFS_KEY // superseded by https://github.com/forestpm/forest
])

function buildCheckbox (key, label) {
  return {
    id: key,
    label: i18n.t(label),
    click: () => { ipcMain.emit(`toggle_${key}`) },
    type: 'checkbox',
    visible: !DEPRECATED_KEYS.has(key),
    checked: false
  }
}

// Notes on this: we are only supporting accelerators on macOS for now because
// they natively work as soon as the menu opens. They don't work like that on Windows
// or other OSes and must be registered globally. They still collide with global
// accelerator. Please see ../utils/setup-global-shortcut.js for more info.
function buildMenu (ctx, peerCount = 0) {
  return Menu.buildFromTemplate([
    ...[
      ['ipfsIsStarting', 'yellow'],
      ['ipfsIsRunning', 'green'],
      ['ipfsIsStopping', 'yellow'],
      ['ipfsIsNotRunning', 'gray'],
      ['ipfsHasErrored', 'red'],
      ['runningWithGC', 'yellow'],
      ['runningWhileCheckingForUpdate', 'yellow']
    ].map(([status, color]) => ({
      id: status,
      label: i18n.t(status),
      visible: false,
      enabled: false,
      icon: path.resolve(path.join(__dirname, `../assets/icons/status/${color}.png`))
    })),
    {
      id: 'peerCount',
      label: i18n.t('peerCount', { peerCount }),
      enabled: false
    },
    {
      id: 'restartIpfs',
      label: i18n.t('restart'),
      click: () => { ctx.restartIpfs() },
      visible: false,
      accelerator: IS_MAC ? 'Command+R' : null
    },
    {
      id: 'startIpfs',
      label: i18n.t('start'),
      click: () => { ctx.startIpfs() },
      visible: false
    },
    {
      id: 'stopIpfs',
      label: i18n.t('stop'),
      click: () => { ctx.stopIpfs() },
      visible: false
    },
    { type: 'separator' },
    {
      id: 'webuiStatus',
      label: i18n.t('status'),
      click: () => { ctx.launchWebUI('/') }
    },
    {
      id: 'webuiFiles',
      label: i18n.t('files'),
      click: () => { ctx.launchWebUI('/files') }
    },
    {
      id: 'webuiPeers',
      label: i18n.t('peers'),
      click: () => { ctx.launchWebUI('/peers') }
    },
    { type: 'separator' },
    {
      id: 'takeScreenshot',
      label: i18n.t('takeScreenshot'),
      click: () => { takeScreenshot(ctx) },
      accelerator: IS_MAC ? SCREENSHOT_SHORTCUT : null,
      enabled: false
    },
    {
      id: 'downloadCid',
      label: i18n.t('downloadCid'),
      click: () => { downloadCid(ctx) },
      accelerator: IS_MAC ? DOWNLOAD_SHORTCUT : null,
      enabled: false
    },
    { type: 'separator' },
    {
      label: IS_MAC ? i18n.t('settings.preferences') : i18n.t('settings.settings'),
      submenu: [
        {
          id: 'webuiNodeSettings',
          label: i18n.t('settings.openNodeSettings'),
          click: () => { ctx.launchWebUI('/settings') }
        },
        { type: 'separator' },
        {
          label: i18n.t('settings.appPreferences'),
          enabled: false
        },
        buildCheckbox(AUTO_LAUNCH_KEY, 'settings.launchOnStartup'),
        buildCheckbox(AUTO_LAUNCH_WEBUI_KEY, 'settings.openWebUIAtLaunch'),
        buildCheckbox(AUTO_GC_KEY, 'settings.automaticGC'),
        buildCheckbox(IPFS_PATH_KEY, 'settings.ipfsCommandLineTools'),
        buildCheckbox(SCREENSHOT_KEY, 'settings.takeScreenshotShortcut'),
        buildCheckbox(DOWNLOAD_KEY, 'settings.downloadHashShortcut'),
        { type: 'separator' },
        {
          label: i18n.t('settings.experiments'),
          enabled: false
        },
        buildCheckbox(PUBSUB_KEY, 'settings.pubsub'),
        buildCheckbox(NAMESYS_PUBSUB_KEY, 'settings.namesysPubsub'),
        buildCheckbox(NPM_IPFS_KEY, 'settings.npmOnIpfs')
      ]
    },
    {
      label: i18n.t('advanced'),
      submenu: [
        {
          label: i18n.t('openLogsDir'),
          click: () => { shell.openPath(app.getPath('userData')) }
        },
        {
          label: i18n.t('openRepoDir'),
          click: () => { shell.openPath(store.get('ipfsConfig.path')) }
        },
        {
          label: i18n.t('openConfigFile'),
          click: () => { shell.openPath(store.path) }
        },
        { type: 'separator' },
        {
          id: 'runGarbageCollector',
          label: i18n.t('runGarbageCollector'),
          click: () => { runGarbageCollector(ctx) },
          enabled: false
        },
        { type: 'separator' },
        {
          id: 'moveRepositoryLocation',
          label: i18n.t('moveRepositoryLocation'),
          click: () => { moveRepositoryLocation(ctx) }
        },
        {
          id: 'setCustomBinary',
          label: i18n.t('setCustomIpfsBinary'),
          click: () => { setCustomBinary(ctx) },
          visible: false
        },
        {
          id: 'clearCustomBinary',
          label: i18n.t('clearCustomIpfsBinary'),
          click: () => { clearCustomBinary(ctx) },
          visible: false
        }
      ]
    },
    {
      label: i18n.t('about'),
      submenu: [
        {
          label: i18n.t('versions'),
          enabled: false
        },
        {
          label: `ipfs-desktop ${VERSION}`,
          click: () => { shell.openExternal(`https://github.com/ipfs-shipyard/ipfs-desktop/releases/v${VERSION}`) }
        },
        {
          label: hasCustomBinary()
            ? i18n.t('customIpfsBinary')
            : `go-ipfs ${GO_IPFS_VERSION}`,
          click: () => { shell.openExternal(`https://github.com/ipfs/go-ipfs/releases/v${GO_IPFS_VERSION}`) }
        },
        { type: 'separator' },
        {
          id: 'checkForUpdates',
          label: i18n.t('checkForUpdates'),
          click: () => { ctx.manualCheckForUpdates() }
        },
        {
          id: 'checkingForUpdates',
          label: i18n.t('checkingForUpdates'),
          enabled: false
        },
        { type: 'separator' },
        {
          label: i18n.t('viewOnGitHub'),
          click: () => { shell.openExternal('https://github.com/ipfs-shipyard/ipfs-desktop/blob/master/README.md') }
        },
        {
          label: i18n.t('helpUsTranslate'),
          click: () => { shell.openExternal('https://www.transifex.com/ipfs/public/') }
        }
      ]
    },
    {
      label: i18n.t('quit'),
      click: () => { app.quit() },
      accelerator: IS_MAC ? 'Command+Q' : null
    }
  ])
}

const on = 'on'
const off = 'off'

function icon (color) {
  const dir = path.resolve(path.join(__dirname, '../assets/icons/tray'))

  if (!IS_MAC) {
    return path.join(dir, `${color}-big.png`)
  }

  return path.join(dir, `${color}-22Template.png`)
}

module.exports = function (ctx) {
  logger.info('[tray] starting')
  const tray = new Tray(icon(off))
  let menu = null

  const state = {
    status: null,
    gcRunning: false,
    isUpdating: false,
    peerCount: 0
  }

  // macOS tray drop files
  tray.on('drop-files', async (_, files) => {
    await addToIpfs(ctx, files)
    ctx.launchWebUI('/files', { focus: false })
  })

  const popupMenu = (event) => {
    // https://github.com/ipfs-shipyard/ipfs-desktop/issues/1762 ¯\_(ツ)_/¯
    if (event && typeof event.preventDefault === 'function') event.preventDefault()

    tray.popUpContextMenu()
  }

  if (!IS_MAC) {
    // Show the context menu on left click on other
    // platforms than macOS.
    tray.on('click', popupMenu)
  }
  tray.on('right-click', popupMenu)
  tray.on('double-click', () => ctx.launchWebUI('/'))

  const fetchPeers = () => {
    // If the daemon is running, send a request to retrieve the number
    // of connected peers. Emit 'peerCountFetched' event upon retrieval.
    if (state.status === STATUS.STARTING_FINISHED && ctx.getIpfsd) {
      ctx.getIpfsd().then((daemon) => {
        daemon.api.swarm.peers().then((value) => {
          ipcMain.emit('peerCountFetched', Array.isArray(value) ? value.length : 0)
        })
      })
    } else {
      ipcMain.emit('peerCountFetched', 0)
    }
  }

  const setupMenu = () => {
    menu = buildMenu(ctx, state.peerCount)

    tray.setContextMenu(menu)
    tray.setToolTip(i18n.t('peerCount', { peerCount: state.peerCount }))

    menu.on('menu-will-show', () => { ipcMain.emit('menubar-will-open') })
    menu.on('menu-will-close', () => { ipcMain.emit('menubar-will-close') })
    updateMenu()
  }

  const updateMenu = () => {
    const { status, gcRunning, isUpdating } = state
    const errored = status === STATUS.STARTING_FAILED || status === STATUS.STOPPING_FAILED

    menu.getMenuItemById('ipfsIsStarting').visible = status === STATUS.STARTING_STARTED && !gcRunning && !isUpdating
    menu.getMenuItemById('ipfsIsRunning').visible = status === STATUS.STARTING_FINISHED && !gcRunning && !isUpdating
    menu.getMenuItemById('ipfsIsStopping').visible = status === STATUS.STOPPING_STARTED && !gcRunning && !isUpdating
    menu.getMenuItemById('ipfsIsNotRunning').visible = status === STATUS.STOPPING_FINISHED && !gcRunning && !isUpdating
    menu.getMenuItemById('ipfsHasErrored').visible = errored && !gcRunning && !isUpdating
    menu.getMenuItemById('peerCount').visible = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('runningWithGC').visible = gcRunning
    menu.getMenuItemById('runningWhileCheckingForUpdate').visible = isUpdating

    menu.getMenuItemById('startIpfs').visible = status === STATUS.STOPPING_FINISHED
    menu.getMenuItemById('stopIpfs').visible = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('restartIpfs').visible = (status === STATUS.STARTING_FINISHED || errored)

    menu.getMenuItemById('webuiStatus').enabled = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('webuiFiles').enabled = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('webuiPeers').enabled = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('webuiNodeSettings').enabled = status === STATUS.STARTING_FINISHED

    menu.getMenuItemById('startIpfs').enabled = !gcRunning
    menu.getMenuItemById('stopIpfs').enabled = !gcRunning
    menu.getMenuItemById('restartIpfs').enabled = !gcRunning

    menu.getMenuItemById(AUTO_LAUNCH_KEY).enabled = supportsLaunchAtLogin()
    menu.getMenuItemById('takeScreenshot').enabled = status === STATUS.STARTING_FINISHED
    menu.getMenuItemById('downloadCid').enabled = status === STATUS.STARTING_FINISHED

    menu.getMenuItemById('moveRepositoryLocation').enabled = !gcRunning && status !== STATUS.STOPPING_STARTED
    menu.getMenuItemById('runGarbageCollector').enabled = menu.getMenuItemById('ipfsIsRunning').visible && !gcRunning

    menu.getMenuItemById('setCustomBinary').visible = !hasCustomBinary()
    menu.getMenuItemById('clearCustomBinary').visible = hasCustomBinary()

    menu.getMenuItemById('checkForUpdates').enabled = !isUpdating
    menu.getMenuItemById('checkForUpdates').visible = !isUpdating
    menu.getMenuItemById('checkingForUpdates').visible = isUpdating

    if (status === STATUS.STARTING_FINISHED) {
      tray.setImage(icon(on))
    } else {
      tray.setImage(icon(off))
    }

    // Update configuration checkboxes.
    for (const key of CONFIG_KEYS) {
      const enabled = store.get(key, false)
      menu.getMenuItemById(key).checked = enabled
      menu.getMenuItemById(key).visible = !DEPRECATED_KEYS.has(key) || enabled
    }

    if (!IS_MAC && !IS_WIN) {
      // On Linux, in order for changes made to individual MenuItems to take effect,
      // you have to call setContextMenu again - https://electronjs.org/docs/api/tray
      tray.setContextMenu(menu)
      tray.setToolTip(i18n.t('peerCount', { peerCount: state.peerCount }))
    }
  }

  ipcMain.on('menubar-will-open', () => {
    fetchPeers()
    setupMenu()
  })

  ipcMain.on('ipfsd', status => {
    state.status = status
    updateMenu()
  })

  ipcMain.on('gcRunning', () => {
    state.gcRunning = true
    updateMenu()
  })

  ipcMain.on('gcEnded', () => {
    state.gcRunning = false
    updateMenu()
  })

  ipcMain.on('updating', () => {
    state.isUpdating = true
    updateMenu()
  })

  ipcMain.on('updatingEnded', () => {
    state.isUpdating = false
    updateMenu()
  })

  ipcMain.on('peerCountFetched', peerCount => {
    // When a new peer count is retrieved, rebuild the menu and update
    // the tray tooltip with the new number if necessary.
    if (typeof peerCount === 'number' && peerCount !== state.peerCount) {
      state.peerCount = peerCount
      tray.setToolTip(i18n.t('peerCount', { peerCount: state.peerCount }))
    }
  })

  ipcMain.on('configUpdated', () => { updateMenu() })
  ipcMain.on('languageUpdated', () => { setupMenu() })

  setupMenu()

  // Trigger peer count refresh using event available on specific platform
  const platformSupportsMouseMoveEvent = IS_MAC || IS_WIN
  if (platformSupportsMouseMoveEvent) {
    tray.on('mouse-move', fetchPeers)
  } else {
    /* TODO: what to do on Linux?
     - 'mouse-move' event is mac and windows only
     - When app indicator is used on Linux, the 'click' events are ignored.
     */
  }

  ctx.tray = tray
  logger.info('[tray] started')
}
