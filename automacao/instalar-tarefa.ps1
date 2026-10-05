# SupriPrice - cria a Tarefa Agendada do Windows (roda uma vez so)
# -----------------------------------------------------------------------------
# Cria UMA tarefa com TRES horarios: 07:00, 12:00 e 17:00, TODOS OS DIAS.
#   Sabado e domingo a Abicom nao publica: o robo faz a atualizacao PARCIAL
#   (noticias, ANP, market share, selo do dia) mantendo o boletim de sexta.
#   07:00 - a Abicom quase nunca publicou ainda (sai entre ~6h30 e ~9h):
#           atualizacao PARCIAL - cotacoes da manha, ANP e noticias, com a
#           defasagem do ultimo boletim e a data dele a mostra.
#   12:00 - boletim do dia ja saiu: atualizacao completa e jornal do dia.
#   17:00 - cotacoes perto do fechamento e noticias da tarde; o jornal do dia
#           e refeito com elas.
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

# Guarda contra um erro que ja aconteceu: colar o texto de exemplo em vez da
# chave. O HTMLy responde 401 la na frente, depois de toda a coleta, e a causa
# nao fica obvia. Melhor barrar aqui.
$chave = [Environment]::GetEnvironmentVariable('HTMLY_API_KEY', 'User')
if ($chave -eq 'SUA-CHAVE-DO-HTMLY') {
  Write-Host "ATENCAO: a variavel guardou o TEXTO DE EXEMPLO, nao a sua chave." -ForegroundColor Red
  Write-Host "Cadastre o valor real, que esta no seu Perfil no site do HTMLy." -ForegroundColor Yellow
  exit 1
}
if (-not $chave) {
  Write-Host "ATENCAO: a chave do HTMLy nao esta cadastrada. Cadastre com:" -ForegroundColor Yellow
  Write-Host '  setx HTMLY_API_KEY "SUA-CHAVE-DO-HTMLY"' -ForegroundColor Yellow
  Write-Host "Depois feche e abra o terminal, e rode este instalador de novo." -ForegroundColor Yellow
  exit 1
}
Write-Host "Chave do HTMLy: cadastrada."

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $script)

$gatilhos = @(
  (New-ScheduledTaskTrigger -Daily -At '07:00'),
  (New-ScheduledTaskTrigger -Daily -At '12:00'),
  (New-ScheduledTaskTrigger -Daily -At '17:00')
)

# WakeToRun: se o computador estiver em SUSPENSAO (tampa fechada, modo
# economia), o Windows o acorda para rodar. Desligado de vez, nao tem como:
# a tarefa roda assim que ele ligar (StartWhenAvailable).
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilhos `
  -Settings $opcoes -Description 'Busca Abicom, ANP, BCB, Brent e noticias; publica o portal SupriPrice.' -Force | Out-Null

Write-Host ""
Write-Host "Pronto. A tarefa '$nome' roda 07:00, 12:00 e 17:00, todos os dias." -ForegroundColor Green
Write-Host "Para testar agora:  Start-ScheduledTask -TaskName '$nome'"
Write-Host "Os registros ficam em: $(Join-Path $raiz 'logs')"
