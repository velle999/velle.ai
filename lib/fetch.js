// CommonJS wrapper for node-fetch (pkg cannot handle ESM directly)
const { default: fetch, ...exports } = require('node-fetch');
module.exports = Object.assign(fetch, exports);