const express = require('express')
const pinoHttp = require('pino-http')
const cors = require('cors')
const PouchDB = require('pouchdb-node')
const util = require('util')
const recursiveReadDir = require('recursive-readdir')
const { getId, getGDDScriptElement, extractGDDJSON } = require('./util')
const path = require('path')
const process = require('process')

const recursiveReadDirAsync = util.promisify(recursiveReadDir)

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)


module.exports = function ({ db, config, logger }) {
  const app = express()

  app.use(pinoHttp({ logger }))
  app.use(cors())

  app.use('/db', require('express-pouchdb')(PouchDB, {
    mode: 'minimumForPouchDB'
  }))

  app.get('/media', wrap(async (req, res) => {
    const { rows } = await db.allDocs({ include_docs: true })

    const blob = rows
      .filter(r => r.doc.mediainfo)
      .map(r => ({
        ...r.doc.mediainfo,
        mediaSize: r.doc.mediaSize,
        mediaTime: r.doc.mediaTime
      }))

    res.set('content-type', 'application/json')
    res.send(blob)
  }))

  app.get('/media/info/:id', wrap(async (req, res) => {
    const { mediainfo } = await db.get(req.params.id.toUpperCase())
    res.set('content-type', 'application/json')
    res.send(mediainfo || {})
  }))

  app.get('/media/thumbnail/:id', wrap(async (req, res) => {
    const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true, binary: true })

    if (!_attachments['thumb.png']) {
      return res.status(404).end()
    }

    res.set('content-type', 'image/png')
    res.send(_attachments['thumb.png'].data)
  }))

  app.get('/cls', wrap(async (req, res) => {
    const { rows } = await db.allDocs({ include_docs: true })

    const str = rows
      .map(row => row.doc.cinf || '')
      .reduce((acc, inf) => acc + inf, '')

    res.set('content-type', 'text/plain')
    res.send(`200 CLS OK\r\n${str}\r\n`)
  }))

  app.get('/tls', wrap(async (req, res) => {
    // TODO (perf) Use scanner?
    const rows = await recursiveReadDirAsync(config.paths.template)

    const str = rows
      .filter(x => /\.(ft|wt|ct|html)$/.test(x))
      .map(x => `${getId(config.paths.template, x)}\r\n`)
      .reduce((acc, inf) => acc + inf, '')

    res.set('content-type', 'text/plain')
    res.send(`200 TLS OK\r\n${str}\r\n`)
  }))
  app.get('/templates', wrap(async (req, res) => {
    // TODO (perf) Use scanner?

    // List all files in the templates dir
    const files = await recursiveReadDirAsync(config.paths.template)

    // Categorize HTML templates separately,
    // because they have features that other template types do not.
    const htmlTemplates = []
    const otherTemplates = []
    for (const filePath of files) {
      {
        // Find HTML-based templates:
        const m = filePath.match(/\.(html|htm)$/)
        if (m) {
          htmlTemplates.push({filePath, type: 'html'})
          continue
        }
      }
      {
        // Find other (eg flash) templates:
        const m = filePath.match(/\.(ft|wt|ct|swf)$/)
        if (m) {
          otherTemplates.push({filePath, type: m[1]})
          continue
        }
      }
    }

    // Extract any Graphics Data Defintions (GDD) from HTML templates.
    const htmlTemplatesInfo = await Promise.all(htmlTemplates.map(async ({filePath, type}) => {
      const info = {
        id: getId(config.paths.template, filePath),
        path: filePath,
        type
      }
      try {
        const gddScriptElement = await getGDDScriptElement(filePath)
        if (gddScriptElement) {
          info.gdd = await extractGDDJSON(filePath, gddScriptElement)
        }
      } catch (error) {
        info.error = error + ''
        console.error(error)
      }
      return info
    }))

    // Gather the info for all templates:
    const otherTemplatesInfo = otherTemplates.map(({filePath, type}) => {
      return {
        id: getId(config.paths.template, filePath),
        path: filePath,
        type
      }
    })

    const allTemplates = htmlTemplatesInfo
      .concat(otherTemplatesInfo)
      .sort((a, b) => {
        // Sort alphabetically
        if (a.id < b.id) {
          return -1
        } else if (a.id > b.id) {
          return 1
        } else {
          return 0
        }
      })

    // Create the final response string.
    const str = JSON.stringify({
      templates: allTemplates

    })

    // Send the response.
    res.set('content-type', 'application/json')
    res.send(str)
  }))

  app.get('/fls', wrap(async (req, res) => {
    // TODO (perf) Use scanner?
    const rows = await recursiveReadDirAsync(config.paths.font)

    const str = rows
      .map(x => `${getId(config.paths.font, x)}\r\n`)
      .reduce((acc, inf) => acc + inf, '')

    res.set('content-type', 'text/plain')
    res.send(`200 FLS OK\r\n${str}\r\n`)
  }))

  app.get('/cinf/:id', wrap(async (req, res) => {
    const { cinf } = await db.get(req.params.id.toUpperCase())
    res.set('content-type', 'text/plain')
    res.send(`201 CINF OK\r\n${cinf}`)
  }))

  app.get('/thumbnail/generate', wrap(async (req, res) => {
    // TODO (fix) Force scanner to scan and wait?
    res.set('content-type', 'text/plain')
    res.send(`202 THUMBNAIL GENERATE_ALL OK\r\n`)
  }))

  app.get('/thumbnail/generate/:id', wrap(async (req, res) => {
    // TODO (fix) Force scanner to scan and wait?
    res.set('content-type', 'text/plain')
    res.send(`202 THUMBNAIL GENERATE OK\r\n`)
  }))

  app.get('/thumbnail', wrap(async (req, res) => {
    const { rows } = await db.allDocs({ include_docs: true })

    const str = rows
      .map(row => row.doc.tinf || '')
      .reduce((acc, inf) => acc + inf, '')

    res.set('content-type', 'text/plain')
    res.send(`200 THUMBNAIL LIST OK\r\n${str}\r\n`)
  }))

  app.get('/thumbnail/:id', wrap(async (req, res) => {
    const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true })

    if (!_attachments['thumb.png']) {
      return res.status(404).end()
    }

    res.set('content-type', 'text/plain')
    res.send(`201 THUMBNAIL RETRIEVE OK\r\n${_attachments['thumb.png'].data}\r\n`)
  }))

  if (!config.disableFileServing) {
    app.get('/file/*', wrap(async (req, res) => {
      const doc = await db.get(req.params[0].toUpperCase(), { attachments: false })

      if (!doc || !doc.mediaPath) {
        return res.sendStatus(404)
      }

      if (path.isAbsolute(doc.mediaPath)) {
        res.sendFile(doc.mediaPath)
      } else {
        res.sendFile(path.join(process.cwd(), doc.mediaPath))
      }
    }))
  }

  app.use((err, req, res, next) => {
    if (err) req.log.error({ err })
    if (!res.headersSent) {
      res.statusCode = err ? err.status || err.statusCode || 500 : 500
      res.end()
    } else {
      res.destroy()
    }
  })

  return app
}
