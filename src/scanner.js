
const cp = require('child_process')
const { Observable } = require('@reactivex/rxjs')
const util = require('util')
const chokidar = require('chokidar')
const mkdirp = require('mkdirp-promise')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { getId } = require('./util')
const Base64 = require('js-base64').Base64

const statAsync = util.promisify(fs.stat)
const unlinkAsync = util.promisify(fs.unlink)
const readFileAsync = util.promisify(fs.readFile)

module.exports = function ({ config, db, logger }) {
  Observable
    .create(o => {
      const watcher = chokidar
        .watch(config.scanner.paths, {
          alwaysStat: true,
          awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
          },
          ...config.scanner
        })
        .on('error', err => logger.error({ err }))
        .on('add', (path, stat) => o.next([ path, stat ]))
        .on('change', (path, stat) => o.next([ path, stat ]))
        .on('unlink', (path, stat) => o.next([ path ]))
      return () => watcher.cancel()
    })
    .concatMap(async ([ mediaPath, mediaStat ]) => {
      const mediaId = getId(config.paths.media, mediaPath)
      try {
        await scanFile(mediaPath, mediaId, mediaStat)
      } catch (err) {
        if (err.code === 'ENOENT') {
          await db.delete(mediaId)
        } else {
          logger.error({ err })
        }
      }
    })
    .subscribe()

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
        mediaLogger.error({ err })
      }),
      generateThumb(doc).catch(err => {
        mediaLogger.error({ err })
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
      // TODO (fix) Binary or base64 size?
      doc.thumbSize
    ].join(' ') + '\r\n'

    doc._attachments = {
      'thumb.png': {
        content_type: 'image/jpg',
        data: Base64.encode(await readFileAsync(tmpPath))
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

        const timeBase = json.streams[0].time_base
        const duration = json.streams[0].duration_ts

        let type = 'AUDIO'
        if (duration <= 1) {
          type = 'STILL'
        } else if (json.streams[0].pix_fmt) {
          type = 'MOVIE'
        }

        resolve([
          `"${getId(config.paths.media, doc.mediaPath)}"`,
          type,
          doc.mediaSize,
          duration,
          timeBase
        ].join(' ') + '\r\n')
      })
    })
  }
}
