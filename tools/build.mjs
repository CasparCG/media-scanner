import * as fs from 'fs/promises'
import { rimraf } from 'rimraf'
import cp from 'child_process'
import zipAFolder from 'zip-a-folder'
import mkdirp from 'mkdirp'

const platform = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch

console.log(`Building for ${platform}-${arch}`)

await rimraf('deploy')
mkdirp.sync('deploy')

// Run pkg
const filename = platform === 'win32' ? 'deploy/scanner.exe' : 'deploy/scanner'
try {
	cp.execSync(`pkg -t node18-${platform} dist/index.js -o ${filename}`)
} catch (error) {
	console.log(error.stdout.toString())
}

// Copy leveldown
await fs.mkdir(`deploy/prebuilds`, { recursive: true })
await fs.cp(`./node_modules/leveldown/prebuilds/${platform}-${arch}`, `deploy/prebuilds/${platform}-${arch}`, {
	recursive: true,
})

// Create zip
const packageJson = await fs.readFile('./package.json')
const pkg = JSON.parse(packageJson)
const version = pkg.version

const packageName = 'casparcg-scanner'
const zipFileName = `${packageName}-v${version}-${platform}-${arch}.zip`

const err = await zipAFolder.zip('./deploy', `./${zipFileName}`)
if (err) {
	throw new Error(err)
}

await fs.rename(`./${zipFileName}`, `./deploy/${zipFileName}`)
