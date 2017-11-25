import winston from 'winston'
import path from 'path'
import fs from 'fs'
import os from 'os'
import isDev from 'electron-is-dev'
import {app} from 'electron'

const isProduction = !isDev
const currentURL = (name) => `file://${__dirname}/views/${name}.html`
const ipfsPathFile = path.join(app.getPath('appData'), 'ipfs-electron-app-node-path')

// Icons
const logoDir = path.resolve(__dirname, '../node_modules/ipfs-logo')
const logoIce = path.resolve(logoDir, 'raster-generated/ipfs-logo-512-ice.png')
const logoMenuBar = path.resolve(logoDir, 'platform-icons/osx-menu-bar.png')
const trayIcon = (os.platform() === 'darwin') ? logoMenuBar : logoIce

const ipfsPath = (() => {
  let pathIPFS
  try {
    pathIPFS = fs.readFileSync(ipfsPathFile, 'utf-8')
  } catch (e) {
    pathIPFS = process.env.IPFS_PATH ||
      (process.env.HOME || process.env.USERPROFILE) + '/.ipfs'
  }

  return pathIPFS
})()

// Sets up the Logger
export const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      handleExceptions: false
    }),
    new winston.transports.File({
      filename: path.join(__dirname, 'app.log'),
      handleExceptions: false
    })
  ]
})

// Default settings for new windows
const window = {
  icon: logoIce,
  title: 'IPFS Dashboard',
  autoHideMenuBar: true,
  width: 800,
  height: 500,
  webPreferences: {
    webSecurity: false
  }
}

// Configuration for the MenuBar
const menubar = {
  dir: __dirname,
  width: 300,
  height: 400,
  index: `file://${__dirname}/views/menubar.html`,
  icon: trayIcon,
  tooltip: 'Your IPFS instance',
  alwaysOnTop: true,
  preloadWindow: true,
  resizable: false,
  skipTaskbar: true,
  webPreferences: {
    nodeIntegration: true,
    webSecurity: false
  }
}

export default {
  isProduction,
  logger,
  menubar,
  window,
  webuiPath: '/webui',
  ipfsPath,
  ipfsPathFile,
  urls: {
    welcome: currentURL('welcome'),
    settings: currentURL('settings')
  }
}
