# SupriPrice - cadastra a chave do HTMLy (roda uma vez so)
# -----------------------------------------------------------------------------
# POR QUE ESTE SCRIPT EXISTE: a instrucao anterior era um comando com lacuna
# ("setx HTMLY_API_KEY "SUA-CHAVE""), e duas vezes seguidas o texto de exemplo
# foi guardado no lugar da chave. Aqui nao ha lacuna para preencher: o script
# pergunta, valida e guarda. A chave nunca aparece na tela nem no historico do
# terminal, e nunca entra em nenhum arquivo do projeto.

$ErrorActionPreference = 'Stop'

$exemplos = @(
  'SUA-CHAVE-DO-HTMLY', 'cole-sua-chave-aqui', 'cole-aqui-o-valor-que-voce-copiou'
)

Write-Host ""
Write-Host "Cadastro da chave do HTMLy" -ForegroundColor Cyan
Write-Host "Pegue em htmly.com.br > seu Perfil > API key."
Write-Host ""

# AsSecureString: o que voce digita nao aparece na tela nem fica no historico.
$segura = Read-Host "Cole a chave e tecle Enter" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try {
  $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

if (-not $chave) {
  Write-Host "Nada foi digitado. Nada foi alterado." -ForegroundColor Red
  exit 1
}
if ($exemplos -contains $chave) {
  Write-Host "Isso e o texto de exemplo, nao a chave. Nada foi alterado." -ForegroundColor Red
  exit 1
}
if ($chave.Length -lt 20) {
  Write-Host "Chave curta demais ($($chave.Length) caracteres) - parece incompleta. Nada foi alterado." -ForegroundColor Red
  exit 1
}
if ($chave -notmatch '^[A-Za-z0-9_\-]+$') {
  Write-Host "A chave tem caracteres estranhos - pode ter vindo com espaco ou aspas. Nada foi alterado." -ForegroundColor Red
  exit 1
}

[Environment]::SetEnvironmentVariable('HTMLY_API_KEY', $chave, 'User')
$env:HTMLY_API_KEY = $chave

Write-Host ""
Write-Host "Guardada. $($chave.Length) caracteres." -ForegroundColor Green
Write-Host "Ela fica no seu usuario do Windows, fora do projeto e fora do GitHub."
