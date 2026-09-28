# SupriPrice — portal de inteligência do mercado de combustíveis

Todo dia útil de manhã, um robô no GitHub busca dados e notícias, monta o
portal e o jornal do dia, e publica. **Você não precisa abrir nada.**

```
   08:20 (Brasília)
        │
        ├── Abicom/StoneX ──► defasagem do diesel e da gasolina, faixa por polo
        ├── Banco Central ──► dólar PTAX
        ├── ICE (BZ=F)    ──► Brent
        ├── ANP           ──► preço na bomba em ~5.000 postos, por região e estado
        └── 13 feeds RSS  ──► manchetes de mundo, Brasil, transporte e agro
                 │
                 ├── gera portal/assets/js/dados.js        (o painel)
                 ├── gera portal/relatorios/jornal-AAAA-MM-DD.html  (o jornal)
                 ├── publica os dois no HTMLy (merge: o resto fica intacto)
                 └── commita histórico e edições de volta no repositório
```

---

## O que entra sozinho

| Bloco | Fonte | Atualização |
|---|---|---|
| Defasagem do diesel e da gasolina | Abicom, análise com a StoneX | diária |
| Faixa por polo, dias de janela fechada | Abicom | diária |
| Dólar | Banco Central, PTAX de venda | diária |
| Brent | Contrato futuro BZ=F | diária |
| **Preço na bomba, média nacional** | **ANP, dados abertos** | **semanal** |
| **Preço por região e por estado** | **ANP** | **semanal** |
| **Variação semanal do S10** | **ANP** | **semanal** |
| **Notícias: mundo, Brasil, transporte, agro** | **13 veículos, via RSS** | **diária** |
| Gráfico de 30 dias | Histórico acumulado | diária |
| **Jornal do dia (página A4)** | **Gerado dos dados + manchetes** | **diária** |
| Arquivo de edições | Gerado | diária |

O `conteudo/editorial.json` guarda só o que nenhuma fonte publica em formato
aberto: o preço da Petrobras nas refinarias (muda poucas vezes por ano) e a
agenda. **Dá para nunca mais abrir esse arquivo** — o portal funciona sozinho.

---

## Três coisas que você precisa saber

**1. As notícias são agregadas, não copiadas.** O portal publica manchete,
um resumo de até 200 caracteres e o **link para a matéria original**, sempre com
o nome do veículo. É o modelo de um agregador. Copiar o texto integral seria
violação de direito autoral — não mude isso.

**2. O jornal do dia é um boletim de dados, não jornalismo escrito.** As frases
são construídas a partir dos próprios números ("A defasagem média do diesel
fechou em R$ 2,97 por litro, 88% abaixo da paridade"). Não há análise escrita
por pessoa. É honesto e útil, mas é diferente das edições que você fazia à mão.

**3. Sem curadoria humana, entra o que o feed trouxer.** Há filtro por
relevância — palavra-chave no título vale 4 pontos, termo central soma mais 3,
e há lista de bloqueio para vaga de emprego, evento e aviso institucional. Ainda
assim, uma hora vai passar algo fora de tom. É o preço de não colocar a mão.

---

## Instalação (uma vez só)

### 1. Chave do HTMLy
Em `htmly.com.br`, vá em **Perfil** (`/profile`) e copie a **API key**.

### 2. Repositório no GitHub
1. Em `github.com/new`, crie um repositório **privado** chamado `supriprice`.
2. Não marque nada para inicializar.
3. Na pasta do projeto:

```bash
git remote add origin https://github.com/SEU-USUARIO/supriprice.git
git branch -M main
git push -u origin main
```

### 3. Guarde a chave
**Settings → Secrets and variables → Actions → New repository secret**
Name `HTMLY_API_KEY`, valor a chave do passo 1.
Se o slug do site não for `supriprice`, crie a *variable* `HTMLY_SLUG`.

### 4. Primeira execução
**Actions → Atualizar Panorama do Diesel → Run workflow**, marque
**backfill** e **simular**. Ele busca ~30 dias de histórico da Abicom e gera
tudo **sem publicar**. Confira o log e o `dados.js` gerado.

Depois rode de novo com as duas caixas desmarcadas. A partir daí é sozinho.

---

## Quando falhar

O robô **nunca publica número que não conseguiu confirmar**.

| Situação | O que acontece |
|---|---|
| Fim de semana | Sai sem publicar. |
| Abicom ainda não publicou às 8h20 | Sai sem publicar; a execução das 10h30 tenta de novo. |
| **ANP fora do ar** | Publica sem o bloco da bomba; o resto sai normal. |
| **Um feed fora do ar** | Registra no log e segue com os outros 12. |
| **Todos os feeds fora** | Publica sem notícias; os números saem normal. |
| Abicom mudou o layout | **Falha** com mensagem clara e e-mail do GitHub. |
| Defasagem fora de faixa plausível | **Falha** antes de publicar. |
| HTMLy recusou | **Falha** e mostra a resposta deles. |

Em qualquer falha o site segue no ar com os dados anteriores, e o selo do topo
passa a dizer "Atualizado ontem" ou a data cheia. Número velho nunca passa
por novo.

---

## Ajustes que você pode querer fazer

**Trocar ou acrescentar uma fonte de notícia:** `conteudo/feeds.json`. Copie um
bloco, ajuste `url`, `editoria` (mundo, brasil, transporte, agro) e `filtrar`.
Use `filtrar: false` só para veículo 100% especializado em energia.

**Está entrando notícia fora de tom:** aumente `pontosMinimos` (hoje 6) ou
acrescente um termo em `palavrasBloqueadas`.

**Está entrando pouca notícia:** baixe `pontosMinimos` ou aumente
`diasDeValidade` (hoje 7).

**Esconder a gasolina do topo:** `mostrarGasolina: false` no `editorial.json`.

---

## Limites

- **HTMLy gratuito:** 3 atualizações/dia (o robô usa 1 ou 2), 10 MB por site.
  Cada jornal novo pesa ~15 KB, então cabem centenas.
- **A raspagem da Abicom depende do layout deles.** Um dia vai quebrar e avisar.
- **O CSV da ANP tem 3,5 MB** e é baixado a cada execução. É rápido no GitHub,
  mas é o passo mais demorado.
- **Fontes usadas:** Abicom/StoneX, ANP (dados abertos), Banco Central, ICE,
  EIA, OilPrice, Hellenic Shipping, Petronotícias, Click Petróleo e Gás,
  Agência Brasil, InfoMoney, NTC&Logística, Transporte Moderno, Canal Rural,
  Agrolink, Compre Rural. Mantenha a atribuição de cada uma.
