// Copies the package.json version into app.json (Expo) and the Android project, so the APK carries it.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const { version } = require(path.join(root, 'package.json'))
const [a, b, c] = version.split('.').map(Number)
const versionCode = a * 10000 + b * 100 + c

const appJsonPath = path.join(root, 'app.json')
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
appJson.expo.version = version
appJson.expo.android = { ...appJson.expo.android, versionCode }
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n')

const gradle = path.join(root, 'android', 'app', 'build.gradle')
if (fs.existsSync(gradle)) {
  const g = fs.readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${versionCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`)
  fs.writeFileSync(gradle, g)
}
console.log(`✓ Versão ${version} (versionCode ${versionCode})`)
