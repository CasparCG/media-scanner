import { Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import chokidar from 'chokidar'
import fs from 'node:fs/promises'
import type fs0 from 'node:fs'
import path from 'node:path'
import { getId } from './util.js'
import { Logger } from 'pino'
import { MediaDatabase, PouchDBMediaDocument } from './db.js'
import { generateInfo, generateThumb } from './ffmpeg.js'

export default function (logger: Logger, db: MediaDatabase, config: Record<string, any>): void {
	new Observable<[path: string, stat: fs0.Stats | undefined]>((o) => {
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

				// Filter out files that are not to be scanned
				if (!shouldFileBeScanned(mediaId, mediaPath)) return

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
								const stat = await fs.stat(doc.mediaPath)
								if (stat.isFile()) {
									return
								}
							} catch (_e) {
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

	async function scanFile(mediaPath: string, mediaId: string, mediaStat: fs0.Stats) {
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

		// The thumbnail follows the probe, which tells it how long the file is and so where to
		// take the frame from. A failed probe still gets a thumbnail from the start of the file.
		const probe = await generateInfo(config, doc).catch((err) => {
			mediaLogger.error({ err }, 'Info Failed')
			return undefined
		})
		await generateThumb(config, doc, probe).catch((err) => {
			mediaLogger.error({ err }, 'Thumbnail Failed')
		})

		await db.put(doc, { force: true })

		mediaLogger.info('Scanned')
	}
	/**
	 * Filter out files that are not to be scanned
	 * @returns true if the media is to be scanned, false otherwise
	 */
	function shouldFileBeScanned(mediaId: string, _mediaPath: string): boolean {
		if (mediaId.startsWith('_')) {
			// PouchDB cannot store these ("Only reserved document ids may start with underscore.")
			return false
		}

		return true
	}
}
