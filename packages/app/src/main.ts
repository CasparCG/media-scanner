import { MediaScanner, MediaScannerAPI } from '@helper/media-scanner'
import { OgrafServer } from '@helper/ograf-server'
import { initializeLogger } from './logger.js'
import { HTTPServer } from './http-server.js'
import { getConfig } from './config.js'

const config = getConfig()
const logger = initializeLogger(config)

const mediaScanner = new MediaScanner(logger, config)
const mediaScannerApi = new MediaScannerAPI(config, mediaScanner.db)
const ografServer = new OgrafServer(config)
const httpServer = new HTTPServer(config, logger, mediaScannerApi, ografServer)

console.log('Media scanner API running on http://localhost:' + httpServer.port)
