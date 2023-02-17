import * as fs from "fs/promises";
import rimraf from "rimraf";
import cp from "child_process";
import zipAFolder from "zip-a-folder";

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;

console.log(`Building for ${platform}-${arch}`);

await rimraf("dist");

// Remove pouchdb-fauxton as it has issues with pkg
const expressPouchDbPkgStr = await fs.readFile(
  "node_modules/express-pouchdb/package.json"
);
const expressPouchDbPkg = JSON.parse(expressPouchDbPkgStr.toString());
delete expressPouchDbPkg["pouchdb-fauxton"];
await fs.writeFile(
  "node_modules/express-pouchdb/package.json",
  JSON.stringify(expressPouchDbPkg)
);

// Run pkg
const filename = platform === "win32" ? "dist/scanner.exe" : "dist/scanner";
cp.execSync(`pkg -t node18-${platform} src/index.js -o ${filename}`);

// Copy leveldown
await fs.mkdir(`dist/prebuilds`, { recursive: true });
await fs.cp(
  `./node_modules/leveldown/prebuilds/${platform}-${arch}`,
  `dist/prebuilds/${platform}-${arch}`,
  { recursive: true }
);

// Create zip
const packageJson = await fs.readFile("./package.json");
const pkg = JSON.parse(packageJson);
const version = pkg.version;

const packageName = "casparcg-scanner";
const zipFileName = `${packageName}-v${version}-${platform}-${arch}.zip`;

const err = await zipAFolder.zip("./dist", `./${zipFileName}`);
if (err) {
  throw new Error(err);
}

await fs.rename(`./${zipFileName}`, `./dist/${zipFileName}`);
