const path = require('path')

module.exports = {
  getId (fileDir, filePath) {
    return path
      .relative(fileDir, filePath) /* take file name without path */
      .replace(/\.[^/.]+$/, '')    /* remove last extension */
      .replace(/\\+/g, '/')        /* replace (multiple)backslashes with forward slashes */
      .toUpperCase()
  }
}
