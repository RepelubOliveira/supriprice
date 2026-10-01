# SupriPrice - execucao diaria na maquina do usuario
# -----------------------------------------------------------------------------
# POR QUE AQUI E NAO NO GITHUB: o Cloudflare da Abicom apresenta verificacao
# anti-robo para pedidos vindos de servidores (o GitHub Actions leva 403, e os
# intermediarios publicos recebem a tela de "security verification"). Da rede
# comum do usuario a pagina abre normalmente, sem desafio nenhum - que e o uso
# que o site permite. Por isso a coleta roda aqui.
#
# A chave do HTMLy NAO fica neste arquivo: vem da variavel de ambiente
# HTMLY_API_KEY, que o usuario cadastra uma vez no proprio Windows.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $raiz 'logs'
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force $logs | Out-Null }

$carimbo = Get-Date -Format 'yyyy-MM-dd_HHmm'
$log = Join-Path $logs "$carimbo.txt"

function Registrar($texto) {
  $linha = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
  Add-Content -Path $log -Value $linha -Encoding utf8
  Write-Host $linha
}

Registrar "Iniciando atualizacao do SupriPrice"

if ($env:HTMLY_API_KEY -eq 'SUA-CHAVE-DO-HTMLY') {
  Registrar "ERRO: a variavel HTMLY_API_KEY guardou o texto de exemplo, nao a chave real."
  exit 1
}
if (-not $env:HTMLY_API_KEY) {
  Registrar "ERRO: HTMLY_API_KEY nao esta definida. Nada foi publicado."
  exit 1
}

Set-Location $raiz

# O Node escreve em UTF-8, mas o PowerShell le a saida dele pela pagina de
# codigo do console (850): os acentos chegavam ao log como "refer├¬ncia".
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# O script sai com codigo 1 quando uma fonte obrigatoria falha; nesse caso nada
# e publicado e o site continua com os dados do dia anterior, com o selo do topo
# avisando a data. Isso e intencional: melhor nao publicar do que publicar errado.
& node automacao/atualizar.mjs 2>&1 | ForEach-Object { Registrar $_ }
$codigo = $LASTEXITCODE

if ($codigo -eq 0) {
  Registrar "Concluido com sucesso."
} else {
  Registrar "Falhou (codigo $codigo). O portal segue com a edicao anterior."
}

# Guarda so os 30 logs mais recentes.
Get-ChildItem $logs -Filter '*.txt' | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 | Remove-Item -Force -ErrorAction SilentlyContinue

exit $codigo
