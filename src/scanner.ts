import { Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import util from 'util'
import chokidar from 'chokidar'
import fs from 'fs'
import path from 'path'
import { getId } from './util'
import { Logger } from 'pino'
import { MediaDatabase, PouchDBMediaDocument } from './db'
import { generateInfo, generateThumb } from './ffmpeg'

const statAsync = util.promisify(fs.stat)

export default function (logger: Logger, db: MediaDatabase, config: Record<string, any>): void {
	new Observable<[path: string, stat: fs.Stats | undefined]>((o) => {
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
			.on('unlink', (path) => o.next([path, undefined]))
		return () => {
			watcher.close().catch(() => null)
		}
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

			const { rows } = (await db.allDocs({
				include_docs: true,
				startkey,
				limit,
			})) as any
			await Promise.all(
				rows.map(async ({ doc }: { doc: any }) => {
					try {
						const mediaFolder = path.normalize(config.scanner.paths)
						const mediaPath = path.normalize(doc.mediaPath)
						if (mediaPath.startsWith(mediaFolder)) {
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

		const doc: PouchDBMediaDocument = await db
			.get(mediaId)
			.catch(() => ({ _id: mediaId, _rev: '0', mediaPath: '', mediaSize: 0, mediaTime: 0 }))

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
			generateInfo(config, doc).catch((err) => {
				mediaLogger.error({ err }, 'Info Failed')
			}),
			generateThumb(config, doc).catch((err) => {
				mediaLogger.error({ err }, 'Thumbnail Failed')
			}),
		])

		await db.put(doc, { force: true })

		mediaLogger.info('Scanned')
	}
}
