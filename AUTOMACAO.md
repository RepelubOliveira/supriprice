# Automação do Panorama do Diesel

Todo dia útil, de manhã, um robô no GitHub busca os números, gera o
`dados.js` e publica no HTMLy. Você não abre o computador nem entra no painel.

```
   08:20 (Brasília)
        │
        ├── Abicom/StoneX ──► defasagem do diesel e da gasolina, faixa por polo
        ├── Banco Central ──► dólar PTAX de fechamento
        └── Yahoo (BZ=F)  ──► Brent
                 │
                 ├── junta com conteudo/editorial.json (a parte escrita por você)
                 ├── gera portal/assets/js/dados.js
                 ├── publica SÓ esse arquivo no HTMLy (merge: o resto fica intacto)
                 └── commita o histórico de volta no repositório
```

---

## O que é automático e o que continua seu

| Bloco do site | Origem | Frequência |
|---|---|---|
| Defasagem do diesel e da gasolina | Abicom (parceria com a StoneX) | diária, automática |
| Faixa por polo, dias de janela fechada | Abicom | diária, automática |
| Dólar | Banco Central, PTAX de venda | diária, automática |
| Brent | Contrato futuro BZ=F | diária, automática |
| Gráfico de 30 dias | Histórico acumulado no repositório | diária, automática |
| Selo "Atualizado hoje" | Data da execução | diária, automática |
| Preço da Petrobras nas refinarias | `conteudo/editorial.json` | você, quando houver reajuste |
| Preço na bomba (ANP) | `conteudo/editorial.json` | você, a cada quinzena |
| Defasagem por polo (tabela) | `conteudo/editorial.json` | você |
| Agenda, Pelo mundo | `conteudo/editorial.json` | você |
| Relatório do dia e Arquivo | `conteudo/editorial.json` + `portal/relatorios/` | você, ao publicar uma edição |

**Nunca edite `portal/assets/js/dados.js`.** Ele é reescrito a cada execução e
suas mudanças se perderiam. A parte manual vive em `conteudo/editorial.json`.

### Uma diferença importante em relação ao site de antes

Os cartões do topo mostravam S10 e S500 separados, com números que vinham do seu
processo manual. **A Abicom publica a defasagem média do Diesel A, não separada
por S10 e S500.** Para não inventar uma precisão que a fonte não tem, os cartões
passam a ser "Diesel A" e "Gasolina A", que é exatamente o que ela divulga.

Se você preferir esconder a gasolina, mude `mostrarGasolina` para `false` em
`conteudo/editorial.json`. Se tiver uma fonte que separe S10 de S500, me diga que
eu adapto.

---

## Instalação (uma vez só)

### 1. Pegue a chave do HTMLy

Entre em `htmly.com.br`, vá em **Perfil** (`/profile`) e copie a **API key**.

### 2. Crie o repositório no GitHub

O robô roda no GitHub Actions, que é gratuito. Se você não tem conta, crie em
`github.com` — leva uns três minutos.

1. Em `github.com/new`, crie um repositório **privado** chamado `supriprice`.
2. **Não** marque nada para inicializar (nem README, nem .gitignore).
3. Copie o endereço que aparece, do tipo
   `https://github.com/SEU-USUARIO/supriprice.git`.

### 3. Envie o projeto

Na pasta do projeto, no terminal:

```bash
git remote add origin https://github.com/SEU-USUARIO/supriprice.git
git branch -M main
git push -u origin main
```

Na primeira vez o Git pede login — use a janela do navegador que ele abrir.

### 4. Guarde a chave como segredo

No repositório: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `HTMLY_API_KEY`
- Secret: a chave copiada no passo 1

Se o slug do seu site não for `supriprice`, crie também uma *variable* (aba ao
lado de Secrets) chamada `HTMLY_SLUG` com o slug certo.

### 5. Carregue o histórico e teste sem publicar

Em **Actions → Atualizar Panorama do Diesel → Run workflow**, marque as duas
caixas: **backfill** e **simular**. Isso busca ~30 dias de boletins da Abicom e
gera o `dados.js` **sem publicar nada**.

Abra o log e confira os números. Se estiverem certos, rode de novo com as duas
caixas desmarcadas: aí sim publica.

Pronto. A partir daí ele roda sozinho, de segunda a sexta.

---

## O dia a dia

**Quando não houver nada a mudar:** nada. O robô cuida.

**Quando publicar um relatório novo:**

1. Coloque o HTML em `portal/relatorios/`.
2. Acrescente a edição em `edicoes` e `arquivo`, no `conteudo/editorial.json`.
3. `git add . && git commit -m "relatório de hoje" && git push`

O relatório em si precisa ir pelo painel do HTMLy (arquivo novo, não coberto
pela atualização diária) ou por uma execução manual do workflow.

**Quando a Petrobras reajustar:** atualize `precosPetrobras` no
`conteudo/editorial.json` e dê push. A própria Abicom anuncia o reajuste no
boletim, então você vê no log.

---

## Quando alguma coisa falhar

O robô é feito para **falhar em silêncio no site e em alto som para você**. Ele
nunca publica um número que não conseguiu confirmar.

| Situação | O que acontece |
|---|---|
| Feriado ou fim de semana | Sai sem publicar. Nenhum erro. |
| Abicom ainda não publicou às 8h20 | Sai sem publicar; a execução das 10h30 tenta de novo. |
| Abicom mudou o layout da página | **Falha** com mensagem clara. O GitHub te manda e-mail. |
| Número fora de faixa plausível | **Falha** antes de publicar. |
| Banco Central fora do ar | Volta até 8 dias para achar a última PTAX. |
| HTMLy recusou a publicação | **Falha** e mostra a resposta deles. |

Em todos os casos de falha o site continua no ar com os dados anteriores, e o
selo do topo passa a dizer "Atualizado ontem" ou a data cheia — o leitor nunca
recebe número velho passando por novo.

Para ver o que houve: **Actions**, clique na execução vermelha, abra o passo
"Atualizar e publicar".

---

## Rodar na sua máquina (opcional)

Precisa do Node 20+, que hoje não está instalado. Com ele:

```bash
node automacao/backfill.mjs --dias=30
node automacao/atualizar.mjs --simular
node automacao/atualizar.mjs --data=2026-09-24 --simular
```

`--simular` nunca publica: só grava os arquivos para você conferir.

---

## Limites que valem lembrar

- **Plano gratuito do HTMLy:** 3 atualizações por dia. O robô usa 1 (às vezes 2,
  quando a primeira tentativa não encontra o boletim). Sobra margem.
- **Espaço:** o site ocupa 1,3 MB de 10 MB. Cada relatório novo soma ~25 KB.
- **A raspagem depende do layout da Abicom.** Se eles reformularem a página, o
  robô para e avisa, em vez de publicar lixo. É o comportamento correto, mas
  significa que uma hora vai precisar de manutenção.
- **Atribuição:** o site cita "Abicom/StoneX" como fonte da defasagem, que é de
  onde o número vem. Mantenha essa citação.
