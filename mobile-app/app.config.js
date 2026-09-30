// Embeds the Google service-account key (kept out of git) so the app comes pre-configured for the shared spreadsheet.
const fs = require('fs')
const path = require('path')

const KEY_FILE = path.join(__dirname, 'service-account.local.json')

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    serviceAccountKeyJson: fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : '',
  },
})
