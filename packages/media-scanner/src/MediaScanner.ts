import { Observable } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import chokidar from 'chokidar'
import fs from 'node:fs/promises'
import type fs0 from 'node:fs'
import path from 'node:path'
import { Logger } from 'pino'
import PouchDB from 'pouchdb-node'
import { Config } from '@helper/shared'
import { MediaDatabase, MediaDocument, PouchDBMediaDocument } from './types/db.js'
import { generateInfo, generateThumb } from './ffmpeg.js'
import { getId } from './util.js'

export class MediaScanner {
	public db: MediaDatabase

	constructor(
		private logger: Logger,
		private config: Config
	) {
		this.db = new PouchDB<MediaDocument>(`_media`)

		if (config.enable.scanning) {
			this.initialize()
		}
	}

	private initialize() {
		new Observable<[path: string, stat: fs0.Stats | undefined]>((o) => {
			const watcher = chokidar
				.watch(
					this.config.scanner.paths,
					Object.assign(
						{
							alwaysStat: true,
							awaitWriteFinish: {
								stabilityThreshold: 2000,
								pollInterval: 1000,
							},
						},
						this.config.scanner
					)
				)
				.on('error', (err) => this.logger.error({ err }))
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
					const mediaId = getId(this.config.paths.media, mediaPath)

					// Filter out files that are not to be scanned
					if (!this.shouldFileBeScanned(mediaId, mediaPath)) return

					try {
						if (!mediaStat) {
							await this.db.remove(await this.db.get(mediaId))
						} else {
							await this.scanFile(mediaPath, mediaId, mediaStat)
						}
					} catch (err) {
						this.logger.error({ err })
					}
				})
			)
			.subscribe()

		void this.cleanDeleted()
	}
	private async cleanDeleted() {
		this.logger.info('Checking for dead media')

		const limit = 256
		let startkey

		while (true) {
			const deleted: Array<any> = []

			const { rows } = (await this.db.allDocs({
				include_docs: true,
				startkey,
				limit,
			})) as any
			await Promise.all(
				rows.map(async ({ doc }: { doc: any }) => {
					try {
						const mediaFolder = path.normalize(this.config.scanner.paths)
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
						this.logger.error({ err, doc })
					}
				})
			)

			await this.db.bulkDocs(deleted)

			if (rows.length < limit) {
				break
			}
			startkey = rows[rows.length - 1].doc._id
		}

		this.logger.info(`Finished check for dead media`)
	}
	private async scanFile(mediaPath: string, mediaId: string, mediaStat: fs0.Stats) {
		if (!mediaId || mediaStat.isDirectory()) {
			return
		}

		const doc: PouchDBMediaDocument = await this.db
			.get(mediaId)
			.catch(() => ({ _id: mediaId, _rev: '0', mediaPath: '', mediaSize: 0, mediaTime: 0 }))

		const mediaLogger = this.logger.child({
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
			generateInfo(this.config, doc).catch((err) => {
				mediaLogger.error({ err }, 'Info Failed')
			}),
			generateThumb(this.config, doc).catch((err) => {
				mediaLogger.error({ err }, 'Thumbnail Failed')
			}),
		])

		await this.db.put(doc, { force: true })

		mediaLogger.info('Scanned')
	}
	/**
	 * Filter out files that are not to be scanned
	 * @returns true if the media is to be scanned, false otherwise
	 */
	private shouldFileBeScanned(mediaId: string, _mediaPath: string): boolean {
		if (mediaId.startsWith('_')) {
			// PouchDB cannot store these ("Only reserved document ids may start with underscore.")
			return false
		}

		return true
	}
}
