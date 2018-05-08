const path = require('path')
const fs = require('fs')
const util = require('util')

const statAsync = util.promisify(fs.stat)

module.exports = {
  getId (fileDir, filePath) {
    return path
      .relative(fileDir, filePath)
      .replace(/\.[^/.]+$/, '')
      .replace(/\\+/g, '/')
      .toUpperCase()
  },

  async fileExists (destPath) {
    try {
      const stat = await statAsync(destPath)
      if (stat.isFile()) {
        return true
      }
    } catch (e) {
      // File not found
    }
    return false
  }
}
