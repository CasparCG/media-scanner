import fs from 'node:fs/promises'
import path from 'node:path'
import recursiveReadDir from 'recursive-readdir'
import { getId, findGDDScript, parseGDDJSON } from './util.js'

/** How many HTML templates are read at the same time */
const READ_CONCURRENCY = 4

interface TemplateInfo {
	id: string
	path: string
	type: string
	gdd?: unknown
	error?: string
}
type GDDInfo = Pick<TemplateInfo, 'gdd' | 'error'>

interface CachedGDDInfo {
	/** Version of the template file the info was extracted from */
	signature: string
	/** The file the GDD was read from, when the template refers to one with `src` */
	external?: { path: string; signature: string | undefined }
	info: GDDInfo
}

/** Identifies a version of a file. undefined if the file does not exist (or can't be accessed) */
async function getFileSignature(filePath: string): Promise<string | undefined> {
	try {
		const stat = await fs.stat(filePath)
		return `${stat.size}:${stat.mtimeMs}`
	} catch (_error) {
		return undefined
	}
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = []
	let next = 0
	const worker = async () => {
		while (next < items.length) {
			const i = next++
			results[i] = await fn(items[i])
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return results
}

/**
 * Lists the templates for `GET /templates`.
 *
 * Reading the GDD out of every HTML template is expensive, so it is cached per file and only read again
 * when the size or modification time of the template (or of its external GDD file) has changed.
 */
export class TemplateLister {
	readonly #templateDir: string
	readonly #cache = new Map<string, CachedGDDInfo>()
	#pending: Promise<string> | undefined

	constructor(templateDir: string) {
		this.#templateDir = templateDir
	}

	/** The response body of `GET /templates`. Simultaneous calls share the same scan. */
	async getJSON(): Promise<string> {
		this.#pending ??= this.#list().finally(() => {
			this.#pending = undefined
		})
		return this.#pending
	}

	async #list(): Promise<string> {
		// List all files in the templates dir
		const files: string[] = await recursiveReadDir(this.#templateDir)

		// Categorize HTML templates separately,
		// because they have features that other template types do not.
		const htmlTemplates: string[] = []
		const otherTemplatesInfo: TemplateInfo[] = []
		for (const filePath of files) {
			// Find HTML-based templates:
			if (/\.(html|htm)$/.test(filePath)) {
				htmlTemplates.push(filePath)
				continue
			}
			// Find other (eg flash) templates:
			const m = filePath.match(/\.(ft|wt|ct|swf)$/)
			if (m) {
				otherTemplatesInfo.push({ id: getId(this.#templateDir, filePath), path: filePath, type: m[1] })
			}
		}

		// Extract any Graphics Data Defintions (GDD) from HTML templates.
		const htmlTemplatesInfo = await mapLimit(
			htmlTemplates,
			READ_CONCURRENCY,
			async (filePath): Promise<TemplateInfo> => ({
				id: getId(this.#templateDir, filePath),
				path: filePath,
				type: 'html',
				...(await this.#getGDDInfo(filePath)),
			})
		)

		// Forget about the templates that are gone
		if (this.#cache.size > htmlTemplates.length) {
			const current = new Set(htmlTemplates)
			for (const filePath of this.#cache.keys()) {
				if (!current.has(filePath)) this.#cache.delete(filePath)
			}
		}

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

		return JSON.stringify({
			templates: allTemplates,
		})
	}

	async #getGDDInfo(filePath: string): Promise<GDDInfo> {
		const signature = await getFileSignature(filePath)
		const cached = this.#cache.get(filePath)
		if (
			cached &&
			cached.signature === signature &&
			(!cached.external || cached.external.signature === (await getFileSignature(cached.external.path)))
		) {
			return cached.info
		}

		const entry = await this.#readGDDInfo(filePath)
		if (entry.info.error !== undefined) console.error(entry.info.error)

		// Something that could not be read is not cached, as the file might just be locked for a moment
		// (a copy in progress, an antivirus, ...)
		if (signature !== undefined && !entry.retry) {
			this.#cache.set(filePath, { signature, external: entry.external, info: entry.info })
		} else {
			this.#cache.delete(filePath)
		}
		return entry.info
	}

	async #readGDDInfo(filePath: string): Promise<Pick<CachedGDDInfo, 'external' | 'info'> & { retry?: boolean }> {
		let external: CachedGDDInfo['external']
		try {
			let html: Buffer
			try {
				html = await fs.readFile(filePath)
			} catch (error) {
				return { info: { error: error + '' }, retry: true }
			}

			const script = findGDDScript(html)
			if (!script) return { info: {} }

			let gddContent = script.text
			if (script.src) {
				const externalPath = path.resolve(path.dirname(filePath), script.src)
				external = { path: externalPath, signature: await getFileSignature(externalPath) }
				try {
					gddContent = await fs.readFile(externalPath, { encoding: 'utf-8' })
				} catch (_error) {
					const error = new Error(
						`Failed to read external GDD "${script.src}" from "${filePath}", does the file exist?`
					)
					// When the file exists, the failure may be temporary
					return { info: { error: error + '' }, external, retry: external.signature !== undefined }
				}
			}

			return { info: { gdd: parseGDDJSON(filePath, gddContent) }, external }
		} catch (error) {
			return { info: { error: error + '' }, external }
		}
	}
}
