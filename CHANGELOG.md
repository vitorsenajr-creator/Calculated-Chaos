# Changelog

Histórico de versões do Calculated Chaos. A versão atual também aparece no
badge no topo do app (`APP_VERSION` em `src/main.js`).

## v3.12.4 — 2026-08-07

- Ao encerrar automaticamente um anúncio no eBay com sucesso, agora mostra
  a mensagem "✅ Item removido da lista de disponíveis do eBay" (antes era
  silencioso mesmo no sucesso).
- Quando um item vendido também está marcado como "Listed on" em
  Mercari/Poshmark/Vinted/Depop, mostra um aviso pedindo para checar e
  remover manualmente nessas plataformas — o app só consegue encerrar
  anúncios automaticamente no eBay (única com API pra isso).

## v3.12.3 — 2026-08-07

- **Correção de risco de venda duplicada.** Quando um item é marcado como
  vendido, o app tenta encerrar automaticamente o anúncio dele no eBay —
  mas isso podia falhar completamente em silêncio (token expirado, erro de
  rede, erro da API do eBay, ou item nunca publicado pelo app), sem avisar
  ninguém. Foi exatamente essa falha silenciosa que causou a venda do mesmo
  item no Poshmark e no eBay. Agora, sempre que o encerramento automático
  falha, aparece um alerta bloqueante pedindo para encerrar manualmente no
  eBay.

## v3.12.2 — 2026-08-07

- **Correção do bug de conexão da conta eBay.** Trocar de aba do app (ex:
  voltar para Settings depois de autorizar no eBay) reconstruía a tela de
  Settings inteira e apagava o campo onde se cola o token de conexão antes
  de ele ser salvo — por isso a conexão parecia simplesmente não funcionar
  mais. Corrigido: a tela de Settings não é mais reconstruída enquanto essa
  colagem está pendente.

## v3.12.1 — 2026-08-06

- Removido o campo legado "Platform" do formulário do item (redundante com
  "Listed on" / "Sold on"). Estimativas de taxa e valores padrão agora
  vêm de `listedPlatforms`.
- Continuação da modularização de `src/main.js`: `reports.js`, `settings.js`,
  `state.js`, `catalog-filters.js`, `catalog-lookups.js` e
  `image-compression.js` extraídos como módulos próprios.
- Corrigido: a barra de ações em massa crescia sem limite com relatórios
  longos (ex: 31 itens publicados), empurrando o botão "Close" pra fora da
  tela.

## v3.12.0 — 2026-08-06

- Publicação em massa no eBay: texto e botão "Edit" maiores na lista de
  itens bloqueados/precisando de revisão; resumo explícito de quantos itens
  vão publicar agora vs. quantos não vão nesta rodada (e por quê).
- Geração de descrição por IA agora salva automaticamente assim que a
  resposta chega, sem precisar clicar em Salvar separadamente.
- Nova ferramenta de geração de descrição por IA em massa para os itens
  selecionados.
- A descrição de listagem salva agora continua visível no painel do item
  depois de salva (antes sumia da tela mesmo estando salva).
- Corrigido: botão de fechar o modal do item e o botão de voltar ao topo
  não ficavam fixos no iOS Safari.
- Novo botão "voltar ao topo" nas telas de Catálogo/Relatórios/Financeiro/
  Configurações.

## v3.11.2 — 2026-08-06

- Início da modularização de `src/main.js` (arquivo único de ~5.500 linhas):
  `constants.js`, `format-utils.js` e `pricing.js` extraídos como os
  primeiros módulos, sem mudança de comportamento.
- Corrigido: o selo "eBay" em "Listed on" não atualizava ao vivo no modal
  do item logo após uma publicação bem-sucedida (só aparecia ao reabrir o
  item).

## v3.11.1 — 2026-08-06

- Renomeado "Generate Poshmark listing" para "Generate listing description"
  em todo o app (o texto gerado é reaproveitado por todas as plataformas,
  não só Poshmark).
- Adicionado suporte a PWA: manifest, ícones e service worker para uso
  offline básico.

## v3.11.0 — 2026-08-05

- Descrição de listagem do eBay agora é formatada como HTML de verdade em
  vez de texto puro.
- Texto de condição do eBay atualizado; a plataforma onde o item realmente
  vendeu passou a ser registrada.
- Corrigido: o gerador de listagem sempre usa o gerador estruturado
  (estilo Poshmark), independente da plataforma.

---

_Este arquivo é mantido manualmente a cada bump de versão. Para o
histórico completo commit a commit, `git log --oneline`._
