var js2xmlparser = require("js2xmlparser");
const { getId } = require('./util')

module.exports = {
  formatOutput(data, command, type, config) {
    command = command.toUpperCase()
    if (type === 'JSON' || type === 'XML') {
      data_json = {}
      if (command === 'CLS') {
        data_json = toCLSJSON(data)
      } else if (command === 'TLS') {
        data_json = toTLSJSON(data, config)
      } else if (command === 'FLS') {
        data_json = toFLSJSON(data, config)
      } else {
        data_json = data
      }

      response = {
        'status': '200 ' + command + ' OK',
        'data': data_json
      }

      if (type === 'JSON') {
        return JSON.stringify(response)
      } else {
        return js2xmlparser.parse("response", response)
      }
    } else {
      return `200 ` + command + ` OK\r\n${data}\r\n`
    }
  },
}

function splitLine(line) {
  var path = line.match(/("([^"]|"")*")/g)[0]
  line = line.replace(path, '')
  var data = line.split(" ").filter(value => Object.keys(value).length !== 0);

  return {
      path: path.replace(/"/g, ''),
      type: data[0],
      mediaSize: data[1],
      mTime: data[2],
      duration: data[3],
      timeBase: data[4]
  }
}

function toCLSJSON (str) {
  data = str.split('\r\n').filter(value => Object.keys(value).length !== 0);
  data.forEach(function(line, index){
      this[index] = splitLine(line.replace(/^"(.+(?="$))"$/, '$1'))
  }, data);
  return data
}

function toTLSJSON (arr, config) {
  data = []

  arr.forEach(element => {
    data.push({
      id: getId(config.paths.template, element)
    })
  })

  return data
}

function toFLSJSON (arr, config) {
  data = []

  arr.forEach(element => {
    console.log(element)
    data.push({
      id: getId(config.paths.font, element)
    })
  })

  return data
}
