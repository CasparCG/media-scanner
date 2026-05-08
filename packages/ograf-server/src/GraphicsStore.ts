import fs from 'fs'
import crypto from 'crypto'
import mime from 'mime-types'
import path from 'path'
import { GraphicsManifest, ServerApi } from 'ograf'

export class GraphicsStore {
	/** File path where to store Graphics */

	/** How long to wait before removing Graphics, in ms */
	private REMOVAL_WAIT_TIME = 1000 * 3600 * 24 // 24 hours

	private checkInterVal: NodeJS.Timeout | undefined = undefined
	private destroyed = false

	private graphicsMarkedForRemoval: Map<string, number> = new Map()

	private storage: GraphicsStoreIdTranslation

	constructor(private folderPath: string) {
		this.storage = new GraphicsStoreIdTranslation(folderPath)
	}
	public async init(): Promise<void> {
		// Ensure the directory exists
		await fs.promises.mkdir(this.folderPath, { recursive: true })

		this.checkInterVal = setInterval(
			() => {
				this.removeExpiredGraphics().catch(console.error)
			},
			1000 * 3600 * 24
		) // Check every 24 hours
		// Also do a check now:
		await this.removeExpiredGraphics()
	}
	destroy(): void {
		this.destroyed = true
		if (this.checkInterVal !== undefined) clearInterval(this.checkInterVal)
	}
	async listGraphics(): Promise<ServerApi.components['schemas']['GraphicListInfo'][]> {
		await this.storage.updateStore() // force an update
		const graphics = await this.storage.getList()

		return graphics
			.filter((item) => {
				return !this.graphicsMarkedForRemoval.has(item.id)
			})
			.map((item) => {
				return {
					id: item.id,
					name: item.manifest.name,
					description: item.manifest.description,
				}
			})
	}
	async getGraphicInfo(id: string): Promise<
		| {
				graphic: ServerApi.components['schemas']['GraphicManifest']
				metadata: ServerApi.components['schemas']['GraphicMetadata']
		  }
		| undefined
	> {
		const cachedGraphic = await this.storage.getCachedItem(id)

		if (!cachedGraphic) return undefined

		if (this.graphicsMarkedForRemoval.has(id)) return undefined

		const manifest = {
			...cachedGraphic.manifest,
			id: cachedGraphic.id, // expose the translated id
		}

		return {
			graphic: manifest as any, // the types don't exactly match due to differences in generation
			metadata: {
				createdBy: cachedGraphic.manifest.author,
				createdAt: cachedGraphic.createdAt,
				updatedAt: cachedGraphic.updatedAt,
				// updatedBy: N/A
			} satisfies ServerApi.components['schemas']['GraphicMetadata'],
		}
	}

	async getGraphicManifest(id: string): Promise<ServerApi.components['schemas']['GraphicManifest'] | undefined> {
		const cachedGraphic = await this.storage.getCachedItem(id)

		if (!cachedGraphic) return undefined

		return {
			...cachedGraphic.manifest,
			id: cachedGraphic.id, // expose the translated id
		} as any
	}
	async deleteGraphic(id: string, force: boolean | undefined): Promise<boolean> {
		if (force) {
			return this.actuallyDeleteGraphic(id)
		} else {
			return this.markGraphicForRemoval(id)
		}
	}
	async getGraphicResource(id: string, localPath: string): Promise<ServeFile | undefined> {
		const cachedGraphic = await this.storage.getCachedItem(id)

		if (!cachedGraphic) return undefined

		const folderPath = path.dirname(cachedGraphic.manifestPath)

		const filePath = path.join(folderPath, localPath)

		return this.serveFile(filePath)
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.promises.access(filePath)
			return true
		} catch {
			return false
		}
	}

	private async getFileInfo(filePath: string): Promise<
		| {
				found: false
		  }
		| {
				found: true
				mimeType: string
				length: number
				lastModified: Date
		  }
	> {
		if (!(await this.fileExists(filePath))) {
			return { found: false }
		}
		let mimeType = mime.lookup(filePath)
		if (!mimeType) {
			// Fallback to "unknown binary":
			mimeType = 'application/octet-stream'
		}

		const stat = await fs.promises.stat(filePath)

		return {
			found: true,
			mimeType,
			length: stat.size,
			lastModified: stat.mtime,
		}
	}
	private async serveFile(fullPath: string): Promise<ServeFile | undefined> {
		const info = await this.getFileInfo(fullPath)

		if (!info.found) return undefined

		// ctx.type = info.mimeType;
		// ctx.length = info.length;
		// ctx.lastModified = info.lastModified;

		// if (immutable) {
		//   ctx.header["Cache-Control"] = "public, max-age=31536000, immutable";
		// } else {
		//   // Never cache:
		//   ctx.header["Cache-Control"] = "no-store";
		// }

		const readStream = fs.createReadStream(fullPath)
		// ctx.body = readStream as any;

		return {
			mimeType: info.mimeType,
			length: info.length,
			lastModified: info.lastModified,
			readStream: readStream,
		}
	}

	private async actuallyDeleteGraphic(id: string): Promise<boolean> {
		this.graphicsMarkedForRemoval.delete(id)

		const cachedGraphic = await this.storage.getCachedItem(id)
		if (!cachedGraphic) return false

		this.storage.deleteCacheForId(id)

		const folderPath = path.dirname(cachedGraphic.manifestPath)

		if (!(await this.fileExists(folderPath))) return false

		// Before removing, check that no other graphic is within the same folder:
		let canDeleteFolder = true
		const list = await this.storage.getList()
		for (const item of list) {
			if (item.id === id) continue

			if (item.manifestPath.startsWith(folderPath)) {
				canDeleteFolder = false
			}
		}
		if (canDeleteFolder) {
			await fs.promises.rm(folderPath, { recursive: true })
		} else {
			// just remove the manifest file..
			await fs.promises.rm(cachedGraphic.manifestPath)
		}

		return true
	}
	private async markGraphicForRemoval(id: string): Promise<boolean> {
		// Mark the Graphic for removal, but keep it for a while.
		// The reason for this is to not delete a Graphic that is currently on-air
		// (which might break due to missing resources)

		this.graphicsMarkedForRemoval.set(id, Date.now() + this.REMOVAL_WAIT_TIME)

		return true
	}
	/** Find any graphics that are due to be removed */
	private async removeExpiredGraphics() {
		if (this.destroyed) return

		for (const [id, ttl] of this.graphicsMarkedForRemoval.entries()) {
			if (ttl === undefined) continue
			if (ttl < Date.now()) continue

			await this.actuallyDeleteGraphic(id)
		}
	}
}

export interface ServeFile {
	mimeType: string
	length: number
	lastModified: Date
	readStream: fs.ReadStream
}

/**
 * Translation layer that transforms the graphic ids to be unique
 */
class GraphicsStoreIdTranslation {
	private cache: Map<string, CachedGraphic> = new Map()
	/** Unix timestamp */
	private lastScanTime: number = 0

	constructor(private folderPath: string) {}

	public async updateStore(): Promise<void> {
		this.lastScanTime = Date.now()

		const discoverFolder = async (folderPath: string): Promise<void> => {
			const files = await fs.promises.readdir(folderPath)

			await Promise.all(
				files.map(async (file: string) => {
					const filePath = path.join(folderPath, file)

					const stat = await fs.promises.stat(filePath)
					// Is a folder?
					if (stat.isDirectory()) {
						if (file === 'node_modules') return // skip node_modules
						if (file.startsWith('_')) return // skip directories starting with "_"

						await discoverFolder(filePath)
					} else if (stat.isFile()) {
						// is Ograf manifest file?
						if (filePath.endsWith('.ograf.json')) {
							const id = this.getId(filePath)

							const manifest = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as GraphicsManifest

							this.cache.set(id, {
								id,
								manifestPath: filePath,
								manifest,
								createdAt: new Date(stat.ctimeMs).toISOString(),
								updatedAt: new Date(stat.mtimeMs).toISOString(),
							})
						}
					}
				})
			)
		}
		await discoverFolder(this.folderPath)
	}

	public getId(manifestPath: string): string {
		// md5 hash:
		return crypto.createHash('md5').update(manifestPath).digest('hex')
	}
	public async getCachedItem(id: string): Promise<CachedGraphic | undefined> {
		let item = this.cache.get(id)
		if (!item) {
			// Maybe we can discover it by scanning the folder?

			// Don't do this more often that once per minute:
			if (this.isItTimeToUpdate()) {
				await this.updateStore()

				item = this.cache.get(id) // try again:
			}
		}
		return item
	}
	public async getList(): Promise<CachedGraphic[]> {
		if (this.isItTimeToUpdate()) {
			await this.updateStore()
		}
		return Array.from(this.cache.values())
	}
	deleteCacheForId(id: string) {
		this.cache.delete(id)
	}
	private isItTimeToUpdate(): boolean {
		// Don't update more often that once per minute:
		return Date.now() - this.lastScanTime > 1000 * 60
	}
}

interface CachedGraphic {
	id: string // The translated/hashed id
	manifestPath: string
	manifest: GraphicsManifest
	createdAt: string
	updatedAt: string
}
