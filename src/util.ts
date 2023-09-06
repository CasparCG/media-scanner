import path from 'path'
import fs from 'fs/promises'
import cheerio, { Cheerio, Element } from 'cheerio'

export function getId(fileDir: string, filePath: string): string {
	return path
		.relative(fileDir, filePath) /* take file name without path */
		.replace(/\.[^/.]+$/, '') /* remove last extension */
		.replace(/\\+/g, '/') /* replace (multiple)backslashes with forward slashes */
		.toUpperCase()
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
		} catch (error) {
			throw new Error(`Failed to read external GDD "${src}" from "${filePath}", does the file exist?`)
		}
	} else {
		gddContent = scriptElem.text()
	}

	try {
		return JSON.parse(gddContent)
	} catch (error) {
		throw new Error(`Failed to parse GDD from "${filePath}", is it valid JSON?`)
	}
}
