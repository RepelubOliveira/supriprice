# SupriPrice - cadastra a chave do HTMLy (roda uma vez so)
# -----------------------------------------------------------------------------
# HISTORICO DAS TENTATIVAS, para ninguem repetir:
#  1. "setx HTMLY_API_KEY "SUA-CHAVE"" - o texto de exemplo foi guardado no
#     lugar da chave, duas vezes. Comando com lacuna e armadilha.
#  2. Read-Host -AsSecureString - varios terminais nao aceitam colar nesse
#     prompt; so entrava um caractere.
#  3. Este: le da AREA DE TRANSFERENCIA. Voce copia a chave no site do HTMLy e
#     roda o script. Nao ha o que digitar nem o que editar.
#
# A chave nunca entra em arquivo do projeto: vai para a variavel de ambiente do
# seu usuario do Windows.

$ErrorActionPreference = 'Stop'

$exemplos = @(
  'SUA-CHAVE-DO-HTMLY', 'cole-sua-chave-aqui', 'cole-aqui-o-valor-que-voce-copiou'
)

function Mascarar($s) {
  if ($s.Length -le 8) { return '*' * $s.Length }
  return "$($s.Substring(0,3))$('*' * ($s.Length - 6))$($s.Substring($s.Length - 3))"
}

Write-Host ""
Write-Host "Cadastro da chave do HTMLy" -ForegroundColor Cyan
Write-Host "Antes de continuar: copie a chave em htmly.com.br > seu Perfil > API key."
Write-Host ""

try {
  $chave = (Get-Clipboard -Raw -ErrorAction Stop)
} catch {
  Write-Host "Nao consegui ler a area de transferencia: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

if (-not $chave) {
  Write-Host "A area de transferencia esta vazia. Copie a chave e rode de novo." -ForegroundColor Red
  exit 1
}

# Tira espacos, quebras de linha e aspas que costumam vir junto na copia.
$chave = $chave.Trim().Trim('"').Trim("'").Trim()

if ($exemplos -contains $chave) {
  Write-Host "O que esta copiado e o texto de exemplo, nao a chave. Nada foi alterado." -ForegroundColor Red
  exit 1
}
if ($chave.Length -lt 20) {
  Write-Host "O que esta copiado tem so $($chave.Length) caracteres - curto demais para ser a chave." -ForegroundColor Red
  Write-Host "Nada foi alterado." -ForegroundColor Red
  exit 1
}
if ($chave -notmatch '^[A-Za-z0-9_\-]+$') {
  Write-Host "O que esta copiado nao parece uma chave (tem espaco ou simbolo estranho)." -ForegroundColor Red
  Write-Host "Nada foi alterado." -ForegroundColor Red
  exit 1
}

Write-Host "Encontrei na area de transferencia: $(Mascarar $chave)  ($($chave.Length) caracteres)"
$ok = Read-Host "E essa a chave? (s/n)"
if ($ok -notmatch '^[sS]') {
  Write-Host "Cancelado. Nada foi alterado." -ForegroundColor Yellow
  exit 1
}

[Environment]::SetEnvironmentVariable('HTMLY_API_KEY', $chave, 'User')
$env:HTMLY_API_KEY = $chave

Write-Host ""
Write-Host "Guardada no seu usuario do Windows, fora do projeto e fora do GitHub." -ForegroundColor Green
Write-Host "Limpando a area de transferencia para a chave nao ficar sobrando por ai."
try { Set-Clipboard -Value ' ' } catch { }
