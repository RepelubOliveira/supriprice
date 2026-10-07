# SupriPrice Assinatura — plano (na gaveta)

Status: **planejado, nada publicado.** Ligar só quando o dono decidir.

## O produto

- **7 dias grátis**, depois **R$ 29,90/mês** no cartão de crédito, renovação automática.
- O cartão é pedido já no cadastro. No 8º dia o Stripe cobra sozinho; quem cancelar antes não paga nada.
- Cancelamento a qualquer momento, pelo próprio assinante (Portal do Cliente do Stripe), sem falar com ninguém.
- 3 dias antes de acabar o teste, o Stripe manda um e-mail de aviso automaticamente.

## O que fica aberto e o que fica para assinantes (proposta, ajustável)

O lado aberto continua trazendo gente: Google, IAs, LinkedIn e o jornal nas redes.

| Aberto (vitrine) | Assinante |
|---|---|
| Faixa de cotações ao vivo | Aba Market share completa: filtro de datas, estados, Top 10/20, evolução, mix |
| Defasagem do dia (Abicom) e preço médio na bomba | Download da planilha completa do ranking (CSV) |
| Top 5 do mês (resumo na página inicial) | Histórico da defasagem e séries do preço na bomba por estado |
| Jornal do dia (imagem para Stories) | Arquivo de todas as edições do jornal |
| Textos para Google e IAs (`llms.txt`, resumos) | Alerta por e-mail quando a ANP solta share novo (fase 2) |

## Por que precisa de um "cofre" fora do HTMLy

Hoje tudo é público: `dados.js`, `share-serie-*.json` e o CSV podem ser baixados por qualquer um. Esconder um botão não protege nada. O que é de assinante precisa sair do HTMLy e ser entregue só para quem estiver logado com assinatura em dia.

## Arquitetura

```
Visitante ──> supriprice.com.br (HTMLy, estático, como hoje)
                 │  login (e-mail com link mágico ou Google)
                 ▼
              Supabase Auth ── sessão (JWT) ──┐
                                              ▼
  "Assinar" ──> Stripe Checkout (página do Stripe, trial 7 dias, R$ 29,90/mês)
                 │ webhook
                 ▼
              Edge Function stripe-webhook ──> tabela assinaturas (status, fim do período)
                                              │
  Página de assinante ──> Edge Function dados-premium (checa JWT + status) ──> arquivo do cofre
                                              ▲
  Robô (3x ao dia) ── publica o aberto no HTMLy (como hoje) e o premium no Storage privado
```

### Peças

1. **Supabase Auth** (já temos o projeto `cotacoes`). Login sem senha: link por e-mail ou Google. O plano grátis comporta 50 mil usuários ativos por mês.
2. **Tabela `assinaturas`**: `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `status` (`trialing`, `active`, `past_due`, `canceled`), `fim_periodo`, `atualizado_em`. RLS: cada um lê só a própria linha; só o webhook (service role) escreve.
3. **Edge Function `assinar`**: cria a sessão do Stripe Checkout para o usuário logado (`mode=subscription`, `trial_period_days=7`, preço R$ 29,90/mês, `payment_method_collection=always`) e devolve a URL.
4. **Edge Function `stripe-webhook`**: valida a assinatura do Stripe e atualiza a tabela nos eventos `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`.
5. **Edge Function `portal`**: abre o Portal do Cliente do Stripe (trocar cartão, ver faturas, cancelar).
6. **Storage privado `premium`**: série do share, CSV completo, históricos e jornais antigos. Só a função `dados-premium` lê, e só para `status in (trialing, active)` ou `past_due` dentro de uma carência de 3 dias.
7. **Robô**: novo passo "publicar premium" que sobe os arquivos para o Storage com a chave de serviço do Supabase. A chave fica em variável de ambiente do Windows e em segredo do GitHub, cadastrada pelo dono, nunca no código. Os arquivos premium saem do HTMLy.
8. **Portal**: botão "Entrar / Assinar" no topo. A aba Market share mostra um prévia borrada com "Teste 7 dias grátis" para quem não assina. Assinante vê tudo, como hoje.

### Pagamento: por que Stripe

- Assinatura com teste grátis, cobrança recorrente, novas tentativas em cartão recusado, e-mails de recibo e aviso, e Portal do Cliente prontos. Não precisa programar nada disso.
- Funciona no Brasil, em reais, com cartão de crédito. A taxa por cobrança deve ser conferida na tabela de preços atual do Stripe Brasil antes de ligar.
- **Existe conector (MCP) oficial do Stripe.** Com ele conectado, o Claude cria produto, preço, webhook e consulta assinaturas direto, primeiro no **modo de teste**.
- Alternativa: Mercado Pago (assinaturas com trial e mais conhecido no Brasil), mas sem conector para o Claude operar.

## Pontos para resolver antes de ligar (não são técnicos)

- **Empresa e anonimato.** O Decreto 7.962/2013 obriga site que vende online a mostrar **razão social e CNPJ** em local visível. O quadro de sócios do CNPJ é público. Ou seja, quem procurar pode descobrir o dono. Converse com o contador sobre abrir a operação por uma empresa (inclusive uma holding) que preserve o que você quer preservar.
- **Nota fiscal.** O Stripe não emite NFS-e. É preciso um emissor integrado (ex.: eNotas, NFE.io) ou o contador. Vale fechar com o contador o enquadramento (SaaS / assinatura de conteúdo).
- **Termos de uso e Política de privacidade (LGPD)**: o site passa a guardar e-mail e dados de pagamento (o cartão fica no Stripe, não com a gente). A política precisa dizer isso.
- **Direito de arrependimento (CDC art. 49)**: 7 dias a partir da contratação. O teste grátis de 7 dias já cobre, mas os termos devem dizer isso e o reembolso precisa estar previsto.
- **Descrição na fatura do cartão**: definir o texto que aparece no extrato (sugestão: `SUPRIPRICE`).

## Fases

1. **Engatilhar (agora, nada no ar).** O dono conecta o Stripe no **modo de teste**. O Claude cria produto e preço de teste, a tabela, as funções e a tela de login e assinatura numa cópia local do portal, e testa com o cartão de teste do Stripe.
2. **Cofre.** O robô passa a gravar o premium no Storage, em paralelo, sem tirar nada do HTMLy ainda.
3. **Ligar.** Com contador, termos e CNPJ resolvidos: o dono cria a conta Stripe real, cadastra as chaves e publicamos. Os arquivos premium saem do HTMLy no mesmo dia.
4. **Depois.** Alertas por e-mail, cupom para TRRs associados do SindTRR e plano anual com desconto.

## Quem faz o quê

- **Dono:** conta Stripe (cadastro e dados bancários), contador e CNPJ, aceitar termos, cadastrar as chaves (nunca colar no chat).
- **Claude:** todo o código, a configuração no Stripe pelo conector (modo de teste) e no Supabase, e os testes.
