import recursiveReadDir from 'recursive-readdir'
import type { Express, Handler, Request, Response, NextFunction } from 'express'

import type { Config } from '@helper/shared'
import { MediaDatabase } from './types/db.js'
import { extractGDDJSON, getGDDScriptElement, getId } from './util.js'

export class MediaScannerAPI {
	constructor(
		private config: Config,
		private db: MediaDatabase
	) {}
	setupMediaScannerRoutes(app: Express) {
		app.get(
			'/media',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'application/json')
				res.send(await this.getMedia())
			})
		)

		app.get(
			'/media/info/:id',
			this.wrap(async (req, res) => {
				res.set('content-type', 'application/json')
				res.send(await this.getMediaInfo(req.params.id))
			})
		)

		app.get(
			'/media/thumbnail/:id',
			this.wrap(async (req, res) => {
				const data = await this.getMediaThumbnail(req.params.id)
				if (!data) {
					res.status(404).end()
					return
				}
				res.set('content-type', 'image/png')
				res.send(data)
			})
		)

		app.get(
			'/cls',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.getCls())
			})
		)

		app.get(
			'/tls',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.getTls())
			})
		)

		app.get(
			'/templates',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'application/json')
				res.send(await this.getTemplates())
			})
		)

		app.get(
			'/fls',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.getFls())
			})
		)

		app.get(
			'/cinf/:id',
			this.wrap(async (req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.getCinf(req.params.id))
			})
		)

		app.get(
			'/thumbnail/generate',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.generateThumbnailAll())
			})
		)

		app.get(
			'/thumbnail/generate/:id',
			this.wrap(async (req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.generateThumbnail(req.params.id))
			})
		)

		app.get(
			'/thumbnail',
			this.wrap(async (_req, res) => {
				res.set('content-type', 'text/plain')
				res.send(await this.getThumbnailList())
			})
		)

		app.get(
			'/thumbnail/:id',
			this.wrap(async (req, res) => {
				const data = await this.getThumbnail(req.params.id)
				if (!data) {
					res.status(404).end()
					return
				}
				res.set('content-type', 'text/plain')
				res.send(data)
			})
		)
	}
	private wrap(fn: Handler) {
		return async (req: Request, res: Response, next: NextFunction) => {
			await Promise.resolve(fn(req, res, next)).catch(next)
		}
	}

	async getMedia() {
		const { rows } = await this.db.allDocs({ include_docs: true })

		const blob: any[] = []
		for (const row of rows) {
			if (row.doc?.mediainfo) {
				blob.push({
					...row.doc.mediainfo,
					mediaSize: row.doc.mediaSize,
					mediaTime: row.doc.mediaTime,
				})
			}
		}
		return blob
	}

	async getMediaInfo(id: string) {
		const { mediainfo } = await this.db.get(id.toUpperCase())
		return mediainfo || {}
	}

	async getMediaThumbnail(id: string) {
		const { _attachments } = await this.db.get(id.toUpperCase(), { attachments: true, binary: true })

		const thumbAttachment = _attachments?.['thumb.png']
		if (!thumbAttachment || !('data' in thumbAttachment)) {
			return null
		}

		return thumbAttachment.data
	}

	async getCls() {
		const { rows } = await this.db.allDocs({ include_docs: true })

		const str = rows.map((row: any) => row.doc?.cinf || '').join('')

		return `200 CLS OK\r\n${str}\r\n`
	}

	async getTls() {
		// TODO (perf) Use scanner?
		const rows: string[] = await recursiveReadDir(this.config.paths.template)

		const str = rows
			.filter((x: string) => /\.(ft|wt|ct|html)$/.test(x))
			.map((x: string) => `${getId(this.config.paths.template, x)}\r\n`)
			.join('')

		return `200 TLS OK\r\n${str}\r\n`
	}

	async getTemplates() {
		// TODO (perf) Use scanner?

		// List all files in the templates dir
		const files: string[] = await recursiveReadDir(this.config.paths.template)

		// Categorize HTML templates separately,
		// because they have features that other template types do not.
		const htmlTemplates = []
		const otherTemplates = []
		for (const filePath of files) {
			{
				// Find HTML-based templates:
				const m = filePath.match(/\.(html|htm)$/)
				if (m) {
					htmlTemplates.push({ filePath, type: 'html' })
					continue
				}
			}
			{
				// Find other (eg flash) templates:
				const m = filePath.match(/\.(ft|wt|ct|swf)$/)
				if (m) {
					otherTemplates.push({ filePath, type: m[1] })
					continue
				}
			}
		}

		// Extract any Graphics Data Defintions (GDD) from HTML templates.
		const htmlTemplatesInfo = await Promise.all(
			htmlTemplates.map(async ({ filePath, type }) => {
				const info: { id: string; path: string; type: string; gdd?: Record<string, any>; error?: string } = {
					id: getId(this.config.paths.template, filePath),
					path: filePath,
					type,
				}
				try {
					const gddScriptElement = await getGDDScriptElement(filePath)
					if (gddScriptElement) {
						info.gdd = (await extractGDDJSON(filePath, gddScriptElement)) as any
					}
				} catch (error) {
					info.error = error + ''
					console.error(error)
				}
				return info
			})
		)

		// Gather the info for all templates:
		const otherTemplatesInfo = otherTemplates.map(({ filePath, type }) => {
			return {
				id: getId(this.config.paths.template, filePath),
				path: filePath,
				type,
			}
		})

		const allTemplates = htmlTemplatesInfo.concat(otherTemplatesInfo).sort((a, b) => {
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
		return JSON.stringify({
			templates: allTemplates,
		})
	}

	async getFls() {
		// TODO (perf) Use scanner?
		const rows: string[] = await recursiveReadDir(this.config.paths.font)

		const str = rows.map((x: string) => `${getId(this.config.paths.font, x)}\r\n`).join('')

		return `200 FLS OK\r\n${str}\r\n`
	}

	async getCinf(id: string) {
		const { cinf } = await this.db.get(id.toUpperCase())
		return `201 CINF OK\r\n${cinf}`
	}

	async generateThumbnailAll() {
		// TODO (fix) Force scanner to scan and wait?
		return `202 THUMBNAIL GENERATE_ALL OK\r\n`
	}

	async generateThumbnail(_id: string) {
		// TODO (fix) Force scanner to scan and wait?
		return `202 THUMBNAIL GENERATE OK\r\n`
	}

	async getThumbnailList() {
		const { rows } = await this.db.allDocs({ include_docs: true })

		const str = rows.map((row: any) => row.doc?.tinf || '').join('')

		return `200 THUMBNAIL LIST OK\r\n${str}\r\n`
	}

	async getThumbnail(id: string) {
		const { _attachments } = await this.db.get(id.toUpperCase(), { attachments: true })

		const thumbAttachment = _attachments?.['thumb.png']
		if (!thumbAttachment || !('data' in thumbAttachment)) {
			return null
		}

		return `201 THUMBNAIL RETRIEVE OK\r\n${thumbAttachment.data as string}\r\n`
	}
}
