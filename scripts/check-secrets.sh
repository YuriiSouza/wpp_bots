#!/bin/sh
# Pre-commit: bloqueia o commit se o que está sendo adicionado parece credencial.
# Instalar: cp scripts/check-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

fail=0

# Arquivos que nunca devem entrar no repositório.
files=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/)(service-account[^/]*\.json|credenciais\.json|credentials\.json|[^/]*\.(jks|keystore|pem|p12|key))$')
# .env novo é bloqueado; os que já estão no repositório (só valores públicos) podem ser editados.
envs=$(git diff --cached --name-only --diff-filter=A | grep -E '(^|/)\.env(\.[^/]*)?$' | grep -vE '\.env\.example$')
files=$(printf '%s\n%s' "$files" "$envs" | sed '/^$/d')
if [ -n "$files" ]; then
  echo "✖ Arquivo de credencial no commit:"
  echo "$files" | sed 's/^/    /'
  fail=1
fi

# Conteúdo adicionado com cara de segredo (chave privada, conta de serviço, tokens conhecidos).
hits=$(git diff --cached -U0 --diff-filter=ACMR -- . ':(exclude)scripts/check-secrets.sh' ':(exclude)*/node_modules/*' | grep -E '^\+' | grep -vE '^\+\+\+' \
  | grep -nE 'BEGIN [A-Z ]*PRIVATE KEY|"private_key"[[:space:]]*:[[:space:]]*"[^"]{20,}|private_key_id[^A-Za-z]{1,6}[0-9a-f]{40}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}')
if [ -n "$hits" ]; then
  echo "✖ Conteúdo com cara de credencial no commit:"
  echo "$hits" | cut -c1-90 | sed 's/^/    /'
  fail=1
fi

if [ $fail -ne 0 ]; then
  echo ""
  echo "Commit bloqueado. Credenciais ficam em arquivos locais ignorados pelo git"
  echo "(ex.: service-account.local.json). Tire do commit com: git restore --staged <arquivo>"
  exit 1
fi
