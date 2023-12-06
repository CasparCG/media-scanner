import pino from 'pino'
import { config } from './config'
import PouchDB from 'pouchdb-node'
import scanner from './scanner'
import app from './app'
import { MediaDatabase, MediaDocument } from './db'

const logger = pino(
	Object.assign({}, config.logger, {
		serializers: {
			err: pino.stdSerializers.err,
		},
	})
)

const db: MediaDatabase = new PouchDB<MediaDocument>(`_media`)

logger.info(config)

scanner(logger, db, config)
app(logger, db, config).listen(config.http.port, config.http.host)
