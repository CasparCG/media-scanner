const express = require('express')
const pinoHttp = require('pino-http')
const PouchDB = require('pouchdb-node')
const util = require('util')
const recursiveReadDir = require('recursive-readdir')
const { getId } = require('./util')
const { formatOutput } = require('./formatter')

const recursiveReadDirAsync = util.promisify(recursiveReadDir)

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

module.exports = function ({ db, config, logger }) {
  const app = express()

  app.use(pinoHttp({ logger }))

  app.use('/db', require('express-pouchdb')(PouchDB, {
    mode: 'minimumForPouchDB'
  }))

  app.get('/cls', wrap(async (req, res) => {
    const { rows } = await db.allDocs({ include_docs: true })

    const str = rows
      .map(row => row.doc.cinf || '')
      .reduce((acc, inf) => acc + inf, '')

    res.send(formatOutput(str, 'CLS', config.http.responseFormat, config))
  }))

  app.get('/tls', wrap(async (req, res) => {
    // TODO (perf) Use scanner?
    const rows = await recursiveReadDirAsync(config.paths.template)

    const str = rows
      .filter(x => /\.(ft|wt|ct|html)$/.test(x))

    if (config.http.responseFormat === 'JSON' || config.http.responseFormat === 'XML') {
      res.send(formatOutput(str, 'TLS', config.http.responseFormat, config))
    } else {
      const data = str.map(x => `${getId(config.paths.template, x)}\r\n`)
      .reduce((acc, inf) => acc + inf, '')

      res.send(`200 TLS OK\r\n${data}\r\n`)
    }
  }))

  app.get('/fls', wrap(async (req, res) => {
    // TODO (perf) Use scanner?
    const rows = await recursiveReadDirAsync(config.paths.font)

    if (config.http.responseFormat === 'JSON' || config.http.responseFormat === 'XML') {
      res.send(formatOutput(rows, 'FLS', config.http.responseFormat, config))
    } else {
      const str = rows
        .map(x => `${getId(config.paths.font, x)}\r\n`)
        .reduce((acc, inf) => acc + inf, '')

      res.send(`200 FLS OK\r\n${str}\r\n`)
    }
  }))

  app.get('/cinf/:id', wrap(async (req, res) => {
    const { cinf } = await db.get(req.params.id.toUpperCase())
    res.send(`201 CINF OK\r\n${cinf}`)
  }))

  app.get('/thumbnail/generate', wrap(async (req, res) => {
    // TODO (fix) Force scanner to scan and wait?
    res.send(`202 THUMBNAIL GENERATE_ALL OK\r\n`)
  }))

  app.get('/thumbnail/generate/:id', wrap(async (req, res) => {
    // TODO (fix) Force scanner to scan and wait?
    res.send(`202 THUMBNAIL GENERATE OK\r\n`)
  }))

  app.get('/thumbnail', wrap(async (req, res) => {
    const { rows } = await db.allDocs({ include_docs: true })

    const str = rows
      .map(row => row.doc.tinf || '')
      .reduce((acc, inf) => acc + inf, '')

    res.send(`200 THUMBNAIL LIST OK\r\n${str}\r\n`)
  }))

  app.get('/thumbnail/:id', wrap(async (req, res) => {
    const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true })

    res.send(`201 THUMBNAIL RETRIEVE OK\r\n${_attachments['thumb.png'].data}\r\n`)
  }))

  app.use((err, req, res, next) => {
    req.log.error({ err })
    if (!res.headersSent) {
      res.statusCode = err.status || err.statusCode || 500
      res.end()
    } else {
      res.destroy()
    }
  })

  return app
}
