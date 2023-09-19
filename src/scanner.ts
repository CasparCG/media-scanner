import cp from 'child_process'
import { Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import util from 'util'
import chokidar from 'chokidar'
import mkdirp from 'mkdirp'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { getId } from './util'
import moment from 'moment'
import { Logger } from 'pino'

const statAsync = util.promisify(fs.stat)
const unlinkAsync = util.promisify(fs.unlink)
const readFileAsync = util.promisify(fs.readFile)

export default function ({ config, db, logger }: { config: Record<string, any>; db: any; logger: Logger }): void {
	Observable.create((o: any) => {
		const watcher = chokidar
			.watch(
				config.scanner.paths,
				Object.assign(
					{
						alwaysStat: true,
						awaitWriteFinish: {
							stabilityThreshold: 2000,
							pollInterval: 1000,
						},
					},
					config.scanner
				)
			)
			.on('error', (err) => logger.error({ err }))
			.on('add', (path, stat) => o.next([path, stat]))
			.on('change', (path, stat) => o.next([path, stat]))
			.on('unlink', (path) => o.next([path]))
		return async () => watcher.close()
	})
		// TODO (perf) groupBy + mergeMap with concurrency.
		.pipe(
			concatMap(async ([mediaPath, mediaStat]) => {
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
		)
		.subscribe()

	async function cleanDeleted() {
		logger.info('Checking for dead media')

		const limit = 256
		let startkey

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const deleted: Array<any> = []

			const { rows } = await db.allDocs({
				include_docs: true,
				startkey,
				limit,
			}) as any
			await Promise.all(
				rows.map(async ({ doc }: { doc: any }) => {
					try {
						const mediaFolder = path.normalize(config.scanner.paths)
						const mediaPath = path.normalize(doc.mediaPath)
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
							_deleted: true,
						})
					} catch (err) {
						logger.error({ err, doc })
					}
				})
			)

			await db.bulkDocs(deleted)

			if (rows.length < limit) {
				break
			}
			startkey = rows[rows.length - 1].doc._id
		}

		logger.info(`Finished check for dead media`)
	}
	void cleanDeleted()

	async function scanFile(mediaPath: string, mediaId: string, mediaStat: fs.Stats) {
		if (!mediaId || mediaStat.isDirectory()) {
			return
		}

		const doc = await db.get(mediaId).catch(() => ({ _id: mediaId }))

		const mediaLogger = logger.child({
			id: mediaId,
			path: mediaPath,
			size: mediaStat.size,
			mtime: mediaStat.mtime.toISOString(),
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
			generateInfo(doc).catch((err) => {
				mediaLogger.error({ err }, 'Info Failed')
			}),
			generateThumb(doc).catch((err) => {
				mediaLogger.error({ err }, 'Thumbnail Failed')
			}),
		])

		await db.put(doc)

		mediaLogger.info('Scanned')
	}

	async function generateThumb(doc: any) {
		const tmpPath = path.join(os.tmpdir(), Math.random().toString(16)) + '.png'

		const args = [
			// TODO (perf) Low priority process?
			config.paths.ffmpeg,
			'-hide_banner',
			'-i',
			`"${doc.mediaPath}"`,
			'-vf select=gt\\(scene,0.4\\)',
			`-vf scale=${config.thumbnails.width}:${config.thumbnails.height}`,
			'-frames:v 1',
			'-threads 1',
			tmpPath,
		]

		await mkdirp(path.dirname(tmpPath))
		await new Promise<void>((resolve, reject) => {
			cp.exec(args.join(' '), (err) => (err ? reject(err) : resolve()))
		})

		const thumbStat = await statAsync(tmpPath)
		doc.thumbSize = thumbStat.size
		doc.thumbTime = thumbStat.mtime.getTime()
		doc.tinf =
			[
				`"${getId(config.paths.media, doc.mediaPath)}"`,
				moment(doc.thumbTime).format('YYYYMMDDTHHmmss'),
				// TODO (fix) Binary or base64 size?
				doc.thumbSize,
			].join(' ') + '\r\n'

		doc._attachments = {
			'thumb.png': {
				content_type: 'image/png',
				data: await readFileAsync(tmpPath),
			},
		}
		await unlinkAsync(tmpPath)
	}

	async function generateInfo(doc: Record<string, any>) {
		const json = await new Promise((resolve, reject) => {
			const args = [
				// TODO (perf) Low priority process?
				config.paths.ffprobe,
				'-hide_banner',
				'-i',
				`"${doc.mediaPath}"`,
				'-show_streams',
				'-show_format',
				'-print_format',
				'json',
			]
			cp.exec(args.join(' '), (err, stdout) => {
				if (err) {
					return reject(err)
				}

				const json = JSON.parse(stdout)
				if (!json.streams || !json.streams[0]) {
					return reject(new Error('not media'))
				}

				resolve(json)
			})
		})

		doc.cinf = generateCinf(doc, json)

		if (config.metadata !== null) {
			doc.mediainfo = await generateMediainfo(doc, json)
		}
	}

	function generateCinf(doc: Record<string, any>, json: any) {
		let tb = (json.streams[0].time_base || '1/25').split('/')
		const dur = parseFloat(json.format.duration) || 1 / 24

		let type = ' AUDIO '
		for (const stream of json.streams) {
			if (stream.pix_fmt && stream.disposition?.default) {
				if (dur <= 1 / 24) {
					type = ' STILL '
					tb = [0, 1]
				} else {
					type = ' MOVIE '
					const fr = String(stream.avg_frame_rate || stream.r_frame_rate || '').split('/')
					if (fr.length === 2) {
						tb = [fr[1], fr[0]]
					}
				}
				break
			}
		}

		return (
			[
				`"${getId(config.paths.media, doc.mediaPath)}"`,
				type,
				doc.mediaSize,
				moment(doc.thumbTime).format('YYYYMMDDHHmmss'),
				tb[0] === 0 ? 0 : Math.floor((dur * tb[1]) / tb[0]),
				`${tb[0]}/${tb[1]}`,
			].join(' ') + '\r\n'
		)
	}

	async function generateMediainfo(doc: Record<string, any>, json: any) {
		const fieldOrder = await new Promise((resolve, reject) => {
			if (!config.metadata.fieldOrder) {
				return resolve('unknown')
			}

			const args = [
				// TODO (perf) Low priority process?
				config.paths.ffmpeg,
				'-hide_banner',
				'-filter:v',
				'idet',
				'-frames:v',
				config.metadata.fieldOrderScanDuration,
				'-an',
				'-f',
				'rawvideo',
				'-y',
				process.platform === 'win32' ? 'NUL' : '/dev/null',
				'-i',
				`"${doc.mediaPath}"`,
			]
			cp.exec(args.join(' '), (err, _stdout, stderr) => {
				if (err) {
					return reject(err)
				}

				const resultRegex = /Multi frame detection: TFF:\s+(\d+)\s+BFF:\s+(\d+)\s+Progressive:\s+(\d+)/
				const res = resultRegex.exec(stderr)
				if (res === null) {
					return resolve('unknown')
				}

				const tff = parseInt(res[1])
				const bff = parseInt(res[2])
				const fieldOrder = tff <= 10 && bff <= 10 ? 'progressive' : tff > bff ? 'tff' : 'bff'

				resolve(fieldOrder)
			})
		})

		return {
			name: doc._id,
			path: doc.mediaPath,
			size: doc.mediaSize,
			time: doc.mediaTime,
			field_order: fieldOrder,

			streams: json.streams.map((s: any) => ({
				codec: {
					long_name: s.codec_long_name,
					type: s.codec_type,
					time_base: s.codec_time_base,
					tag_string: s.codec_tag_string,
					is_avc: s.is_avc,
				},

				// Video
				width: s.width,
				height: s.height,
				sample_aspect_ratio: s.sample_aspect_ratio,
				display_aspect_ratio: s.display_aspect_ratio,
				pix_fmt: s.pix_fmt,
				bits_per_raw_sample: s.bits_per_raw_sample,

				// Audio
				sample_fmt: s.sample_fmt,
				sample_rate: s.sample_rate,
				channels: s.channels,
				channel_layout: s.channel_layout,
				bits_per_sample: s.bits_per_sample,

				// Common
				time_base: s.time_base,
				start_time: s.start_time,
				duration_ts: s.duration_ts,
				duration: s.duration,

				bit_rate: s.bit_rate,
				max_bit_rate: s.max_bit_rate,
				nb_frames: s.nb_frames,
			})),
			format: {
				name: json.format.format_name,
				long_name: json.format.format_long_name,
				size: json.format.time,

				start_time: json.format.start_time,
				duration: json.format.duration,
				bit_rate: json.format.bit_rate,
				max_bit_rate: json.format.max_bit_rate,
			},
		}
	}
}
