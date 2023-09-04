const nconf = require('nconf')
const pkg = require('../package.json')
const fs = require('fs')
const xml2js = require('xml2js')
const path = require('path')

const defaults = {
  caspar: {
    config: './casparcg.config'
  },
  paths: {
    template: './template',
    media: './media',
    font: './font',
    ffmpeg: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    ffprobe: process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  },
  scanner: {
    paths: null
    // Note: See https://www.npmjs.com/package/chokidar#api.
  },
  thumbnails: {
    width: 256,
    height: -1
  },
  metadata: {
    fieldOrder: false, // This is an expensive check, as it requires decoding the beginning of the video
    fieldOrderScanDuration: 200 // Frames. Note: Needs sufficient motion (Not titlecard)
  },
  isProduction: process.env.NODE_ENV === 'production',
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
    name: pkg.name,
    print: process.env.NODE_ENV !== 'production'
  },
  http: {
    port: 8000,
    host: undefined
  }
}

const config = nconf
  .argv()
  .env('__')
  .defaults(defaults)
  .get()

if (config.caspar && config.caspar.config) {
  const parser = new xml2js.Parser()
  const data = fs.readFileSync(config.caspar.config)
  parser.parseString(data, (err, result) => {
    if (err) {
      throw err
    }
    for (const path in result.configuration.paths[0]) {
      config.paths[path.split('-')[0]] = result.configuration.paths[0][path][0]
    }
  })
}

if (!config.scanner.path) {
  config.scanner.paths = config.paths.media
}

module.exports = config
