// Embeds the Google service-account key (kept out of git) so the app comes pre-configured for the shared spreadsheet.
const fs = require('fs')
const path = require('path')

// On EAS Build the gitignored file isn't uploaded; the secret file env var SERVICE_ACCOUNT_JSON points to it instead.
const KEY_FILE = process.env.SERVICE_ACCOUNT_JSON ?? path.join(__dirname, 'service-account.local.json')

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    serviceAccountKeyJson: fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8') : '',
  },
})
