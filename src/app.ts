import express from 'express'
import { pinoHttp } from 'pino-http'
import cors from 'cors'
import recursiveReadDir from 'recursive-readdir'
import { getId, getTemplateType, getTemplateInfo, findTemplateFile } from './util.js'
import { Logger } from 'pino'
import { MediaDatabase } from './db.js'

const wrap = (fn: express.Handler) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
	void Promise.resolve(fn(req, res, next)).catch(next)
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
		wrap(async (req, res) => {
			// TODO (perf) Use scanner?

			// Parsing the GDD of every template is expensive, clients which only need the list can opt out with ?gdd=false
			const includeGdd = req.query.gdd !== 'false' && req.query.gdd !== '0'

			// List all files in the templates dir
			const files: string[] = await recursiveReadDir(config.paths.template)

			// Categorize HTML templates separately,
			// because they have features that other template types do not.
			const htmlTemplates = []
			const otherTemplates = []
			for (const filePath of files) {
				const type = getTemplateType(filePath)
				if (type === 'html') {
					htmlTemplates.push({ filePath, type })
				} else if (type) {
					otherTemplates.push({ filePath, type })
				}
			}

			// Gather the info for all templates,
			// extracting any Graphics Data Defintions (GDD) from HTML templates.
			const templatesInfo = await Promise.all(
				htmlTemplates
					.concat(otherTemplates)
					.map(async ({ filePath, type }) => getTemplateInfo(config.paths.template, filePath, type, includeGdd))
			)

			const allTemplates = templatesInfo.sort((a, b) => {
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
		'/templates/*templatePath',
		wrap(async (req, res) => {
			// The template can be requested by id (NEWS/LOWER-THIRD) or by relative path (news/lower-third.html)
			const templatePath: string | string[] = req.params.templatePath
			const requested = Array.isArray(templatePath) ? templatePath.join('/') : templatePath

			const filePath = await findTemplateFile(config.paths.template, requested)
			const type = filePath && getTemplateType(filePath)
			if (!filePath || !type) {
				return res.status(404).end()
			}

			const info = await getTemplateInfo(config.paths.template, filePath, type, true)

			res.set('content-type', 'application/json')
			return res.send(JSON.stringify(info))
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
			return res.send(`201 THUMBNAIL RETRIEVE OK\r\n${thumbAttachment.data as string}\r\n`)
		})
	)

	app.use((err: any, req: express.Request, res: express.Response, _next: unknown): void => {
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
