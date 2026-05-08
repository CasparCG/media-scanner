import express from 'express'
import type { Express } from 'express'
import ExpressWs from 'express-ws'
// import { pinoHttp } from 'pino-http'
import cors from 'cors'
import { Logger } from 'pino'
import { MediaScannerAPI } from '@helper/media-scanner'
import { OgrafServer } from '@helper/ograf-server'
import { Config } from '@helper/shared'

export class HTTPServer {
	public app: Express
	public wsApp: ExpressWs.Application

	constructor(
		private config: Config,
		private _logger: Logger,
		private mediaScanner: MediaScannerAPI,
		private ografServer: OgrafServer
	) {
		this.app = express()

		const expressWs = ExpressWs(this.app)

		this.wsApp = expressWs.app

		// this.app.use(pinoHttp({ logger: this.logger }))

		this.app.use(cors())

		this._logger

		this.app.use(express.json())
		// this.app.use()

		// this.app.use(function (req, res, next) {
		// 	console.log('middleware')
		// 	;(req as any).testing = 'testing'
		// 	return next()
		// })

		// this.app.get('/', function (req, res, next) {
		// 	console.log('get route', (req as any).testing)
		// 	res.end()
		// })

		// this.wsApp.ws('/', function (ws, req) {
		// 	ws.on('message', function (msg) {
		// 		console.log(msg)
		// 	})
		// 	console.log('socket', (req as any).testing)
		// })
		// this.wsApp.ws('/rendererApi/v1', function (ws, req) {
		// 	ws.on('message', function (msg) {
		// 		console.log(msg)
		// 	})
		// 	console.log('socket', (req as any).testing)
		// })

		this.mediaScanner.setupMediaScannerRoutes(this.app)
		this.ografServer.setupRendererApi(this.app as any)
		this.ografServer.setupOGrafApi(this.app)

		this.app.use((err: any, _req: express.Request, res: express.Response, _next: unknown): void => {
			// if (err) req.log.error({ err })
			if (!res.headersSent) {
				res.statusCode = err ? err.status || err.statusCode || 500 : 500
				res.end()
			} else {
				res.destroy()
			}
		})

		this.wsApp.listen(this.config.http.port, this.config.http.host ?? '0.0.0.0')
		// this.app.listen(this.config.http.port )
	}

	get port(): number {
		return this.config.http.port
	}
}
