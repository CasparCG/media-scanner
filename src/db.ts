export interface MediaDocument {
	_id: string

	// Basic info
	mediaPath: string
	mediaSize: number
	mediaTime: number

	// Thumbnail
	tinf?: string
	thumbSize?: number
	thumbTime?: number

	// Scanned info
	mediainfo?: Record<string, any>
	cinf?: string
}

export type PouchDBMediaDocument = PouchDB.Core.Document<MediaDocument> & PouchDB.Core.GetMeta

export type MediaDatabase = PouchDB.Database<MediaDocument>
