/* eslint-disable @typescript-eslint/no-misused-promises */
import express from 'express'
import pinoHttp from 'pino-http'
import cors from 'cors'
import recursiveReadDir from 'recursive-readdir'
import { getId, getGDDScriptElement, extractGDDJSON } from './util'
import { Logger } from 'pino'
import { MediaDatabase } from './db'

const wrap = (fn: express.Handler) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
	Promise.resolve(fn(req, res, next)).catch(next)
}

export default function (logger: Logger, db: MediaDatabase, config: Record<string, any>): express.Application {
	const app = express()

	app.use(pinoHttp({ logger }))
	app.use(cors())

	app.get(
		'/media',
		wrap(async (_req, res) => {
			const { rows } = await db.allDocs({ include_docs: true })

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
			res.set('content-type', 'application/json')
			res.send(blob)
		})
	)

	app.get(
		'/media/info/:id',
		wrap(async (req, res) => {
			const { mediainfo } = await db.get(req.params.id.toUpperCase())
			res.set('content-type', 'application/json')
			res.send(mediainfo || {})
		})
	)

	app.get(
		'/media/thumbnail/:id',
		wrap(async (req, res) => {
			const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true, binary: true })

			const thumbAttachment = _attachments?.['thumb.png']
			if (!thumbAttachment || !('data' in thumbAttachment)) {
				return res.status(404).end()
			}

			res.set('content-type', 'image/png')
			return res.send(thumbAttachment.data)
		})
	)

	app.get(
		'/cls',
		wrap(async (_req, res) => {
			const { rows } = await db.allDocs({ include_docs: true })

			const str = rows.map((row) => row.doc?.cinf || '').join('')

			res.set('content-type', 'text/plain')
			res.send(`200 CLS OK\r\n${str}\r\n`)
		})
	)

	app.get(
		'/tls',
		wrap(async (_req, res) => {
			// TODO (perf) Use scanner?
			const rows: string[] = await recursiveReadDir(config.paths.template)

			const str = rows
				.filter((x: string) => /\.(ft|wt|ct|html)$/.test(x))
				.map((x: string) => `${getId(config.paths.template, x)}\r\n`)
				.join('')

			res.set('content-type', 'text/plain')
			res.send(`200 TLS OK\r\n${str}\r\n`)
		})
	)
	app.get(
		'/templates',
		wrap(async (_req, res) => {
			// TODO (perf) Use scanner?

			// List all files in the templates dir
			const files: string[] = await recursiveReadDir(config.paths.template)

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
						id: getId(config.paths.template, filePath),
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
					id: getId(config.paths.template, filePath),
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
			const str = JSON.stringify({
				templates: allTemplates,
			})

			// Send the response.
			res.set('content-type', 'application/json')
			res.send(str)
		})
	)

	app.get(
		'/fls',
		wrap(async (_req, res) => {
			// TODO (perf) Use scanner?
			const rows: string[] = await recursiveReadDir(config.paths.font)

			const str = rows.map((x) => `${getId(config.paths.font, x)}\r\n`).join('')

			res.set('content-type', 'text/plain')
			res.send(`200 FLS OK\r\n${str}\r\n`)
		})
	)

	app.get(
		'/cinf/:id',
		wrap(async (req, res) => {
			const { cinf } = await db.get(req.params.id.toUpperCase())
			res.set('content-type', 'text/plain')
			res.send(`201 CINF OK\r\n${cinf}`)
		})
	)

	app.get(
		'/thumbnail/generate',
		wrap(async (_req, res) => {
			// TODO (fix) Force scanner to scan and wait?
			res.set('content-type', 'text/plain')
			res.send(`202 THUMBNAIL GENERATE_ALL OK\r\n`)
		})
	)

	app.get(
		'/thumbnail/generate/:id',
		wrap(async (_req, res) => {
			// TODO (fix) Force scanner to scan and wait?
			res.set('content-type', 'text/plain')
			res.send(`202 THUMBNAIL GENERATE OK\r\n`)
		})
	)

	app.get(
		'/thumbnail',
		wrap(async (_req, res) => {
			const { rows } = await db.allDocs({ include_docs: true })

			const str = rows.map((row) => row.doc?.tinf || '').join('')

			res.set('content-type', 'text/plain')
			res.send(`200 THUMBNAIL LIST OK\r\n${str}\r\n`)
		})
	)

	app.get(
		'/thumbnail/:id',
		wrap(async (req, res) => {
			const { _attachments } = await db.get(req.params.id.toUpperCase(), { attachments: true })

			const thumbAttachment = _attachments?.['thumb.png']
			if (!thumbAttachment || !('data' in thumbAttachment)) {
				return res.status(404).end()
			}

			res.set('content-type', 'text/plain')
			return res.send(`201 THUMBNAIL RETRIEVE OK\r\n${thumbAttachment.data}\r\n`)
		})
	)

	app.use((err: any, req: express.Request, res: express.Response): void => {
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
