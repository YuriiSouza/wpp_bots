// Stops the build if the service-account key (gitignored) isn't in place to be embedded.
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'service-account.local.json')
try {
  const k = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (k.type !== 'service_account' || !k.client_email || !k.private_key) throw new Error('arquivo inválido')
  console.log('✓ Chave embutida: ' + k.client_email)
} catch (e) {
  console.error(`\n✖ Chave não encontrada em ${path.relative(process.cwd(), file)} (${e.message}).\n` +
    '  Copie a chave da conta de serviço para esse caminho antes de gerar o app.\n')
  process.exit(1)
}
