const cp = require('child_process')
const { Observable } = require('@reactivex/rxjs')
const util = require('util')
const chokidar = require('chokidar')
const mkdirp = require('mkdirp-promise')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { getId } = require('./util')
const moment = require('moment')

const statAsync = util.promisify(fs.stat)
const unlinkAsync = util.promisify(fs.unlink)
const readFileAsync = util.promisify(fs.readFile)

module.exports = function ({ config, db, logger }) {
  Observable
    .create(o => {
      const watcher = chokidar
        .watch(config.scanner.paths, Object.assign({
          alwaysStat: true,
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 1000
          }
        }, config.scanner))
        .on('error', err => logger.error({ err }))
        .on('add', (path, stat) => o.next([ path, stat ]))
        .on('change', (path, stat) => o.next([ path, stat ]))
        .on('unlink', (path, stat) => o.next([ path ]))
      return () => watcher.close()
    })
    // TODO (perf) groupBy + mergeMap with concurrency.
    .concatMap(async ([ mediaPath, mediaStat ]) => {
      const mediaId = getId(config.paths.media, mediaPath)
      try {
        if (!mediaStat) {
          await db.remove(await db.get(mediaId))
        } else {
          await scanFile(mediaPath, mediaId, mediaStat)
        }
      } catch (err) {
        logger.error({ err })
      }
    })
    .subscribe()

  async function cleanDeleted () {
    logger.info('Checking for dead media')

    const limit = 256
    let startkey = undefined
    while (true) {
      const deleted = []

      const { rows } = await db.allDocs({
        include_docs: true,
        startkey,
        limit
      })
      await Promise.all(rows.map(async ({ doc }) => {
        try {
          const mediaFolder = config.scanner.paths.split('\\').join('/')
          const mediaPath = doc.mediaPath.split('\\').join('/')
          if (mediaPath.indexOf(mediaFolder) === 0) {
            try {
              const stat = await statAsync(doc.mediaPath)
              if (stat.isFile()) {
                return
              }
            } catch (e) {
              // File not found
            }
          }

          deleted.push({
            _id: doc._id,
            _rev: doc._rev,
            _deleted: true
          })
        } catch (err) {
          logger.error({ err, doc })
        }
      }))
      if (rows.length < limit) {
        break
      }
      startkey = rows[rows.length-1].doc._id

      await db.bulkDocs(deleted)
    }

    logger.info(`Finished check for dead media`)
  }
  cleanDeleted()

  async function scanFile (mediaPath, mediaId, mediaStat) {
    if (!mediaId || mediaStat.isDirectory()) {
      return
    }

    const doc = await db
      .get(mediaId)
      .catch(() => ({ _id: mediaId }))

    const mediaLogger = logger.child({
      id: mediaId,
      path: mediaPath,
      size: mediaStat.size,
      mtime: mediaStat.mtime.toISOString()
    })

    if (doc.mediaPath && doc.mediaPath !== mediaPath) {
      mediaLogger.info('Skipped')
      return
    }

    if (doc.mediaSize === mediaStat.size && doc.mediaTime === mediaStat.mtime.getTime()) {
      return
    }

    doc.mediaPath = mediaPath
    doc.mediaSize = mediaStat.size
    doc.mediaTime = mediaStat.mtime.getTime()

    await Promise.all([
      generateInfo(doc).catch(err => {
        mediaLogger.error({ err }, 'Info Failed')
      }),
      generateThumb(doc).catch(err => {
        mediaLogger.error({ err }, 'Thumbnail Failed')
      })
    ])

    await db.put(doc)

    mediaLogger.info('Scanned')
  }

  async function generateThumb (doc) {
    const tmpPath = path.join(os.tmpdir(), Math.random().toString(16)) + '.png'

    const args = [
      // TODO (perf) Low priority process?
      config.paths.ffmpeg,
      '-hide_banner',
      '-i', `"${doc.mediaPath}"`,
      '-frames:v 1',
      `-vf thumbnail,scale=${config.thumbnails.width}:${config.thumbnails.height}`,
      '-threads 1',
      tmpPath
    ]

    await mkdirp(path.dirname(tmpPath))
    await new Promise((resolve, reject) => {
      cp.exec(args.join(' '), (err, stdout, stderr) => err ? reject(err) : resolve())
    })

    const thumbStat = await statAsync(tmpPath)
    doc.thumbSize = thumbStat.size
    doc.thumbTime = thumbStat.mtime.toISOString()
    doc.tinf = [
      `"${getId(config.paths.media, doc.mediaPath)}"`,
      moment(doc.thumbTime).format('YYYYMMDDTHHmmss'),
      // TODO (fix) Binary or base64 size?
      doc.thumbSize
    ].join(' ') + '\r\n'

    doc._attachments = {
      'thumb.png': {
        content_type: 'image/png',
        data: (await readFileAsync(tmpPath)).toString('base64')
      }
    }
    await unlinkAsync(tmpPath)
  }

  async function generateInfo (doc) {
    doc.cinf = await new Promise((resolve, reject) => {
      const args = [
        // TODO (perf) Low priority process?
        config.paths.ffprobe,
        '-hide_banner',
        '-i', `"${doc.mediaPath}"`,
        '-show_streams',
        '-show_format',
        '-print_format', 'json'
      ]
      cp.exec(args.join(' '), (err, stdout, stderr) => {
        if (err) {
          return reject(err)
        }

        const json = JSON.parse(stdout)
        if (!json.streams || !json.streams[0]) {
          return reject(new Error('not media'))
        }

        let tb = (json.streams[0].time_base || '1/25').split('/')
        let dur = parseFloat(json.format.duration) || (1 / 24)

        let type = ' AUDIO '
        if (json.streams[0].pix_fmt) {
          type = dur <= (1 / 24) ? ' STILL ' : ' MOVIE '

          const fr = String(json.streams[0].avg_frame_rate || json.streams[0].r_frame_rate || '').split('/')
          if (fr.length === 2) {
            tb = [ fr[1], fr[0] ]
          }
        }

        resolve([
          `"${getId(config.paths.media, doc.mediaPath)}"`,
          type,
          doc.mediaSize,
          moment(doc.thumbTime).format('YYYYMMDDHHmmss'),
          Math.floor((dur * tb[1]) / tb[0]),
          `${tb[0]}/${tb[1]}`
        ].join(' ') + '\r\n')
      })
    })
  }
}
