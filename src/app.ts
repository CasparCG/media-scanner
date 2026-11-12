import express from 'express'
import { pinoHttp } from 'pino-http'
import cors from 'cors'
import recursiveReadDir from 'recursive-readdir'
import { getId } from './util.js'
import { TemplateLister } from './templates.js'
import { Logger } from 'pino'
import { MediaDatabase } from './db.js'

const wrap = (fn: express.Handler) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
	void Promise.resolve(fn(req, res, next)).catch(next)
}

export default function (logger: Logger, db: MediaDatabase, config: Record<string, any>): express.Application {
	const app = express()
	const templateLister = new TemplateLister(config.paths.template)

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
			// Create the response string.
			const str = await templateLister.getJSON()

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
