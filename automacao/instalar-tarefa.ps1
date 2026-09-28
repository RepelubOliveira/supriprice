# SupriPrice - cria a Tarefa Agendada do Windows (roda uma vez so)
# -----------------------------------------------------------------------------
# Cria UMA tarefa com DOIS horarios: 08:20 e 10:30, de segunda a sexta. Dois
# porque a Abicom publica o boletim ao longo da manha - se as 8h20 ainda nao
# saiu, a segunda tentativa pega.
#
# StartWhenAvailable: se o computador estiver desligado no horario, a tarefa
# roda assim que ele ligar, em vez de simplesmente perder o dia.
#
# Nao precisa de administrador: a tarefa e criada no seu proprio usuario.

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$script = Join-Path $raiz 'automacao\rodar-diario.ps1'
$nome = 'SupriPrice - atualizar portal'

if (-not (Test-Path $script)) { throw "Nao achei $script" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "ATENCAO: o Node.js nao esta instalado. Instale antes com:" -ForegroundColor Yellow
  Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
  exit 1
}
Write-Host "Node encontrado: $((& node --version))"

if (-not [Environment]::GetEnvironmentVariable('HTMLY_API_KEY', 'User')) {
  Write-Host "ATENCAO: a chave do HTMLy nao esta cadastrada. Cadastre com:" -ForegroundColor Yellow
  Write-Host '  setx HTMLY_API_KEY "cole-sua-chave-aqui"' -ForegroundColor Yellow
  Write-Host "Depois feche e abra o terminal, e rode este instalador de novo." -ForegroundColor Yellow
  exit 1
}
Write-Host "Chave do HTMLy: cadastrada."

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $script)

$dias = 'Monday','Tuesday','Wednesday','Thursday','Friday'
$gatilhos = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At '08:20'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At '10:30')
)

$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilhos `
  -Settings $opcoes -Description 'Busca Abicom, ANP, BCB, Brent e noticias; publica o portal SupriPrice.' -Force | Out-Null

Write-Host ""
Write-Host "Pronto. A tarefa '$nome' roda 08:20 e 10:30, de segunda a sexta." -ForegroundColor Green
Write-Host "Para testar agora:  Start-ScheduledTask -TaskName '$nome'"
Write-Host "Os registros ficam em: $(Join-Path $raiz 'logs')"
