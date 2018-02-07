const express = require('express')
const pinoHttp = require('pino-http')
const util = require('util')
const recursiveReadDir = require('recursive-readdir')
const { getId } = require('./util')

const recursiveReadDirAsync = util.promisify(recursiveReadDir)

module.exports = function ({ db, config, logger }) {
  const app = express()

  app.use(pinoHttp({ logger }))

  app.get('/cls', async (req, res, next) => {
    try {
      const { rows } = await db.allDocs({ include_docs: true })

      const str = rows
        .map(row => row.doc.cinf || '')
        .reduce((acc, cinf) => acc + cinf, '')

      res.send(`200 CLS OK\r\n${str}\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/tls', async (req, res, next) => {
    try {
      // TODO (perf) Use scanner?
      let str = ''
      for (const templatePath of await recursiveReadDirAsync(config.paths.template)) {
        if (/\.(ft|wt|ct|html)$/.test(templatePath)) {
          str += `${getId(config.paths.template, templatePath)}\r\n`
        }
      }
      res.send(`200 TLS OK\r\n${str}\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/fls', async (req, res, next) => {
    try {
      // TODO (perf) Use scanner?
      let str = ''
      for (const fontPath of await recursiveReadDirAsync(config.paths.fonts)) {
        str += `${getId(config.paths.fonts, fontPath)}\r\n`
      }
      res.send(`200 FLS OK\r\n${str}\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/cinf/:id', async (req, res, next) => {
    try {
      const { cinf } = await db.get(req.params.id.toUpperCase())
      res.send(`201 CINF OK\r\n${cinf}`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/thumbnail/generate', async (req, res, next) => {
    try {
      // TODO (fix) Force scanner to scan and wait?
      res.send(`202 THUMBNAIL GENERATE_ALL OK\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/thumbnail/generate/:id', async (req, res, next) => {
    try {
      // TODO (fix) Wait for scanner?
      res.send(`202 THUMBNAIL GENERATE OK\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/thumbnail', async (req, res, next) => {
    try {
      const { rows } = await db.allDocs({ include_docs: true })

      const str = rows
        .map(row => row.doc.tinf || '')
        .reduce((acc, tinf) => acc + tinf, '')

      res.send(`200 THUMBNAIL LIST OK\r\n${str}\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.get('/thumbnail/:id', async (req, res, next) => {
    try {
      const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true })

      res.send(`201 THUMBNAIL RETRIEVE OK\r\n${_attachments['thumb.png'].data}\r\n`)
    } catch (err) {
      next(err)
    }
  })

  app.use((err, req, res, next) => {
    req.log.error({ err })
    next(err)
  })

  return app
}
