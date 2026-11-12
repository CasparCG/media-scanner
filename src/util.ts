import path from 'node:path'
import fs from 'node:fs/promises'
import cheerio, { Cheerio, Element } from 'cheerio'

export function getId(fileDir: string, filePath: string): string {
	return path
		.relative(fileDir, filePath) /* take file name without path */
		.replace(/\.[^/.]+$/, '') /* remove last extension */
		.replace(/\\+/g, '/') /* replace (multiple)backslashes with forward slashes */
		.toUpperCase()
}

export interface TemplateInfo {
	id: string
	path: string
	type: string
	gdd?: Record<string, any>
	error?: string
}

/** Returns the type of a template file, or undefined if the file is not a template. */
export function getTemplateType(filePath: string): string | undefined {
	// HTML-based templates:
	if (/\.(html|htm)$/.test(filePath)) return 'html'

	// Other (eg flash) templates:
	const m = filePath.match(/\.(ft|wt|ct|swf)$/)
	return m ? m[1] : undefined
}

/**
 * Finds the file of the template that a client asked for.
 * The template can be requested by its id (`NEWS/LOWER-THIRD`) or by its relative path (`news/lower-third.html`).
 *
 * The request is matched folder by folder against the actual contents of the templates dir (ignoring case, like the ids do),
 * so `..` or absolute paths in the request are never resolved and only the folders on the way to the template are read.
 * Symlinks inside the templates dir are followed (as in the `/templates` listing), so a request can resolve to a file outside of it.
 */
export async function findTemplateFile(templateDir: string, requested: string): Promise<string | undefined> {
	const folders = requested.split(/[\\/]+/).filter((part) => part.length > 0)
	const fileName = folders.pop()
	if (!fileName) return undefined

	const extMatch = fileName.match(/\.(html|htm|ft|wt|ct|swf)$/i)
	if (extMatch) {
		// A path with an extension (news/clock.html), or else an id which ends like one (LOGO.HTML for logo.html.ft)
		const ext = extMatch[0].toLowerCase()
		return (
			(await findTemplateInDir(templateDir, folders, fileName.slice(0, -ext.length), ext)) ??
			(await findTemplateInDir(templateDir, folders, fileName, undefined))
		)
	}
	return findTemplateInDir(templateDir, folders, fileName, undefined)
}

async function findTemplateInDir(
	dir: string,
	folders: string[],
	name: string,
	ext: string | undefined
): Promise<string | undefined> {
	let entries: string[]
	try {
		entries = await fs.readdir(dir)
	} catch (_error) {
		// Not a folder
		return undefined
	}

	if (folders.length > 0) {
		const [folder, ...remainingFolders] = folders
		const matches = entries
			.filter((entry) => entry.toUpperCase() === folder.toUpperCase())
			.sort((a, b) => Number(b === folder) - Number(a === folder)) // Prefer the exact match
		for (const match of matches) {
			const filePath = await findTemplateInDir(path.join(dir, match), remainingFolders, name, ext)
			if (filePath) return filePath
		}
		return undefined
	}

	const entryName = (entry: string) => entry.slice(0, -path.extname(entry).length)
	// Prefer the exact spelling (on case-sensitive file systems), then the HTML template when the same id exists as several types.
	const priority = (entry: string) => (entryName(entry) === name ? 2 : 0) + (getTemplateType(entry) === 'html' ? 1 : 0)

	const candidates = entries
		.filter((entry) => {
			if (!getTemplateType(entry) || (ext && path.extname(entry) !== ext)) return false
			return entryName(entry).toUpperCase() === name.toUpperCase()
		})
		.sort((a, b) => priority(b) - priority(a))
	for (const candidate of candidates) {
		const filePath = path.join(dir, candidate)
		const stat = await fs.stat(filePath).catch(() => undefined)
		if (stat?.isFile()) return filePath
	}
	return undefined
}

/** Gathers the info for a template, optionally including its Graphics Data Definition (GDD). */
export async function getTemplateInfo(
	templateDir: string,
	filePath: string,
	type: string,
	includeGdd: boolean
): Promise<TemplateInfo> {
	const info: TemplateInfo = {
		id: getId(templateDir, filePath),
		path: filePath,
		type,
	}

	// Only HTML templates can contain a GDD.
	if (includeGdd && type === 'html') {
		try {
			const gddScriptElement = await getGDDScriptElement(filePath)
			if (gddScriptElement) {
				info.gdd = (await extractGDDJSON(filePath, gddScriptElement)) as any
			}
		} catch (error) {
			info.error = error + ''
			console.error(error)
		}
	}

	return info
}

export async function getGDDScriptElement(filePath: string): Promise<Cheerio<Element> | undefined> {
	const html = await fs.readFile(filePath)
	const $ = cheerio.load(html)
	const gddScripts = $('script[name="graphics-data-definition"]')
	if (gddScripts.length === 0) {
		return undefined
	} else {
		return gddScripts.first()
	}
}

export async function extractGDDJSON(filePath: string, scriptElem: Cheerio<Element>): Promise<unknown> {
	const src = scriptElem.attr('src')
	let gddContent
	if (src) {
		const externalGDDPath = path.resolve(path.dirname(filePath), src)
		try {
			gddContent = await fs.readFile(externalGDDPath, { encoding: 'utf-8' })
		} catch (_error) {
			throw new Error(`Failed to read external GDD "${src}" from "${filePath}", does the file exist?`)
		}
	} else {
		gddContent = scriptElem.text()
	}

	try {
		return JSON.parse(gddContent)
	} catch (_error) {
		throw new Error(`Failed to parse GDD from "${filePath}", is it valid JSON?`)
	}
}
