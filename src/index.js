const pino = require('pino')
const config = require('./config')
const PouchDB = require('pouchdb-node')
const scanner = require('./scanner')
const app = require('./app')

const logger = pino(Object.assign({}, config.logger, {
  serializers: {
    err: pino.stdSerializers.err
  }
}))
const db = new PouchDB('_media')

logger.info(config)

scanner({ logger, db, config })
app({ logger, db, PouchDB, config }).listen(config.http.port)
