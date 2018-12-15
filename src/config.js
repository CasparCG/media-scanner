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
  isProduction: process.env.NODE_ENV === 'production',
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
    name: pkg.name,
    prettyPrint: process.env.NODE_ENV !== 'production'
  },
  http: {
    port: 8000,
    responseFormat: "SDL"
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
    if (result.configuration.amcp[0]['media-server'][0]['response-format'][0] !== undefined) {
      config.http.responseFormat = result.configuration.amcp[0]['media-server'][0]['response-format'][0].toUpperCase()
    }
  })
}

if (!config.scanner.path) {
  config.scanner.paths = config.paths.media
}

module.exports = config
