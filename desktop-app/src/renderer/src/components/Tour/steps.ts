// Passos do tour de cada tela. `target` = texto que aparece na tela (o começo dele) ou
// "placeholder:..." para um campo; `card` = destacar o cartão/painel inteiro em volta do texto.
// Sem `target`, o passo aparece no centro da tela.

export interface TourStep { title: string; text: string; target?: string; card?: boolean }
export interface TourDef { title: string; steps: TourStep[] }

export const TOURS: Record<string, TourDef> = {
  uploads: {
    title: 'Uploads',
    steps: [
      { title: 'Por onde os dados entram', text: 'Tudo o que o app analisa começa aqui. Cada cartão é uma fonte de dados, com o passo a passo (botão ?) de onde baixar no SPX.' },
      { title: 'Roteirização por turno', target: 'Roteirização por Turno', card: true, text: 'Escolha data e turno, cole o link da planilha de roteirização e clique em Buscar. O app lê as guias Plano de expedição (rotas) e Calculation Tasks (pacotes). Só o link fica salvo.' },
      { title: 'Relatório de rotas DS', target: 'Relatório de Rotas DS', card: true, text: 'CSV com o histórico de rotas. É a base do Delivery Success, dos Novatos e da Rotatividade.' },
      { title: 'Disponibilidade', target: 'Work Preference (Disponibilidade)', card: true, text: 'Quem está disponível em cada dia e turno. Dá para buscar direto do SPX (precisa da sessão colada em Atribuição) ou importar o XLSX.' },
      { title: 'Call Up', target: 'Call Up (Chamadas de Motoristas)', card: true, text: 'Relatório de chamadas: quem aceitou e quem recusou. Alimenta a tela Call Up, o score da fila e o risco de recusa.' },
      { title: 'Cadastro e pacotes', target: 'Cadastro de Motoristas SPX', card: true, text: 'Cadastro (veículo e telefone) e, logo ao lado, Pacotes em Aberto (Forward Order), que alimenta a tela Pacotes e o bloqueio automático por redelivery.' },
      { title: 'Motorista por AT', target: 'Motorista por AT (SPX)', card: true, text: 'Busca no SPX quem está em cada rota do turno. Use depois de carregar a roteirização.' },
    ],
  },
  ds: {
    title: 'Análise DS',
    steps: [
      { title: 'Delivery Success', text: 'Resultado das entregas por motorista e por rota, a partir do Relatório de Rotas DS. A meta é 95%.' },
      { title: 'Abas da análise', target: 'Visão Geral', text: 'Visão Geral, Motoristas DS, Por Cluster, Rotatividade e Sugestão SPR: cada aba olha o DS por um ângulo.' },
      { title: 'Por motorista', target: 'Motoristas DS', text: 'Lista de motoristas com o DS de cada um, para achar quem está abaixo da meta.' },
      { title: 'Por cluster', target: 'Por Cluster', text: 'O DS por região, para ver onde a entrega é mais difícil.' },
      { title: 'Sugestão de SPR', target: 'Sugestão SPR', text: 'Sugestão de pacotes por rota (SPR) por cluster, com base no histórico.' },
    ],
  },
  novatos: {
    title: 'Novatos',
    steps: [
      { title: 'Quem está começando', text: 'Motoristas que fizeram a primeira rota no período escolhido, e como o DS deles evolui.' },
      { title: 'Entradas por período', target: 'Novatos que começaram a rodar', card: true, text: 'Quantos novatos começaram em cada mês (ou semana, em períodos curtos), separados por turno.' },
      { title: 'Curva de aprendizado', target: 'Curva de aprendizado', card: true, text: 'DS médio da 1ª, 2ª, 3ª rota… comparado com os veteranos. Mostra em quantas rotas o novato chega à meta.' },
      { title: 'Lista e ficha', target: 'Quem são os novatos', card: true, text: 'Todos os novatos com DS no início e agora. Clique num nome para abrir a ficha completa, rota a rota.' },
    ],
  },
  motoristas: {
    title: 'Motoristas',
    steps: [
      { title: 'Base de motoristas', text: 'O cadastro importado do SPX: veículo, telefone e dados de cada motorista. As outras telas usam esta base.' },
      { title: 'Estatísticas', target: 'Estatísticas', text: 'Resumo da base de motoristas cadastrados.' },
      { title: 'Lista', target: 'Lista (', text: 'Todos os motoristas, com busca.' },
      { title: 'Buscar telefones', target: '📞 Buscar telefones', text: 'Cole uma lista de IDs e receba os telefones de uma vez, para mandar mensagem.' },
    ],
  },
  perfil: {
    title: 'Visão Geral',
    steps: [
      { title: 'O turno numa tela', text: 'Todas as rotas do dia e turno selecionados no topo, com o motorista de cada uma.' },
      { title: 'Tabela ou dashboard', target: '☰ Tabela', text: 'A tabela é a visão padrão. O Dashboard resume atribuição, veículos e clusters em gráficos.' },
      { title: 'Busca e filtros', target: 'placeholder:🔍 Buscar AT', text: 'Busque por AT, gaiola, cluster, cidade ou motorista, e filtre disponíveis ou atribuídas. O botão ao lado copia os telefones das rotas filtradas.' },
      { title: 'Veículo certo?', target: 'Veículo', text: 'O veículo que a rota pede → o veículo do motorista. ✓ verde quando bate, ✗ vermelho quando não.' },
      { title: 'Abrir a rota', target: 'Gaiola', text: 'Clique em qualquer linha para abrir a ficha da rota: mapa das paradas, pacotes, volume, peso e pacotes que já voltaram (EHA). O botão Voltar traz de volta para cá.' },
    ],
  },
  disponibilidade: {
    title: 'Disponibilidade',
    steps: [
      { title: 'Quem pode rodar', text: 'Os motoristas disponíveis no dia e turno selecionados, cruzados com as rotas já atribuídas.' },
      { title: 'Status', target: 'Disponível', text: 'Disponível: livre no turno. Dobra: já rodou em outro turno do dia. Indisponível: já tem rota neste turno. Bloqueado: não deve ser convocado.' },
      { title: 'Lista, dashboard e rotatividade', target: '🔄 Rotatividade', text: 'Lista com filtros, dashboard com os totais e a aba Rotatividade: quem rodou no período, quantas rotas e receita estimada.' },
      { title: 'Rodízio e DS', target: 'BAIXA', text: 'Rodízio pelo número de dias sem rota (configurável) e DS de cada motorista, com a meta de 95%.' },
    ],
  },
  callup: {
    title: 'Call Up',
    steps: [
      { title: 'Indicador de aceite', text: 'Quantas rotas são aceitas na 1ª chamada. Vem do relatório de Call Up.' },
      { title: 'Abas', target: '📊 Dashboard', text: 'Dashboard (o indicador), 1ª chamada (a lista) e Risco de recusa (quem pode recusar hoje).' },
      { title: 'Período, turno e meta', target: 'Todos os turnos', text: 'Escolha as datas, o turno e a meta. Verde: dentro da meta; amarelo: até 10 pontos abaixo; vermelho: mais que isso.' },
      { title: 'Os números', target: 'Aceite na 1ª chamada', card: true, text: 'Aceite na 1ª chamada, comparado com o período anterior (▲/▼). Ao lado: rotas chamadas, recusadas, recuperadas e aceite final.' },
      { title: 'Análise mensal', target: 'Análise mensal', card: true, text: 'O aceite mês a mês, com a variação para o mês anterior.' },
      { title: 'Onde agir', target: 'Motoristas que mais recusam', card: true, text: 'Quem mais recusa na 1ª, e logo acima os turnos, horários e clusters com menor aceite.' },
      { title: 'Risco de recusa', target: '🎯 Risco de recusa', text: 'Para cada motorista com rota no turno, a chance de recusar, com telefone e WhatsApp para ligar antes.' },
    ],
  },
  noshow: {
    title: 'Atribuição',
    steps: [
      { title: 'Atribuir e reatribuir', text: 'Aqui as rotas ganham motorista. O app sugere quem colocar, pela fila priorizada, e grava direto no SPX. Antes, cole a sessão do SPX no menu ⋯ › SPX.' },
      { title: 'Resumo do turno', target: 'Recusadas', card: true, text: 'Rotas recusadas, para reverter, revertidas, motoristas livres, já em rota, bloqueados e a previsão.' },
      { title: 'Rotas recusadas', target: 'Rotas recusadas (', text: 'As rotas que voltaram do Call Up. Escolha o motorista para cada uma (ou use a sugestão) e clique em Atribuir.' },
      { title: 'Fila de motoristas', target: 'Fila de motoristas (', text: 'Quem está livre no turno, ordenado pelo score (DS, recusas e no-show). Bloqueados não entram.' },
      { title: 'First Convocation', target: '🚐 First Convocation', text: 'Fiorinos nas rotas de Fiorino da roteirização (3 modos, com ajuste manual), novatos na região deles e rotas de 3PL.' },
      { title: 'Trocas e report', target: '🔁 Trocas Fiorino', text: 'Trocas sugeridas entre Fiorino e Passeio na mesma região. Ao lado, o Gerar Report monta o resumo do turno para o grupo.' },
      { title: 'Atribuir', target: '✦ Atribuir', text: 'Grava as atribuições no SPX. Se a sessão cair, o que falhou fica pendente para tentar de novo.' },
    ],
  },
  carregamento: {
    title: 'Carregamento',
    steps: [
      { title: 'A fila do carregamento', text: 'Quem chegou, quem está na mesa e quem ainda não apareceu, direto da fila do SPX.' },
      { title: 'Atualizar', target: '🔄 Atualizar do SPX', text: 'Busca a fila agora. Abrir a tela já atualiza, e a aba Mesas atualiza sozinha a cada minuto.' },
      { title: 'Janelas por letra', target: 'Janelas', text: 'Letra da gaiola e horário em que o carregamento começa. Cada letra seguinte é +20 min, e o prazo de chegada é 20 min antes.' },
      { title: 'Motoristas', target: '📋 Motoristas', text: 'Quem não chegou (atrasado ou aguardando) e quem está na fila (no prazo ou fora da janela), com telefone para cobrar. 🚨 marca rota com pacote que já voltou por não caber.' },
      { title: 'Mesas', target: '🪑 Mesas', text: 'Cada mesa: ocupada, chamando motorista ou livre, e há quanto tempo. Ao lado, os próximos da fila.' },
    ],
  },
  pacotes: {
    title: 'Pacotes',
    steps: [
      { title: 'Pacotes em aberto', text: 'Pacotes pendentes por motorista, do relatório Forward Order.' },
      { title: 'Críticos', target: 'Críticos', text: 'Motoristas com mais pacotes em aberto. Acima de 5, o motorista é bloqueado automaticamente.' },
      { title: 'Por agência', target: 'Por Agência', text: 'Os pacotes agrupados por agência, com relatório para imprimir.' },
      { title: 'Data × motivo', target: 'Pivot Data', text: 'Quantos pacotes por data e por motivo.' },
      { title: 'Mapa', target: 'Mapa', text: 'Onde estão os pacotes em aberto.' },
    ],
  },
  volumosos: {
    title: 'Volumosos',
    steps: [
      { title: 'Pacote grande no veículo certo', text: 'Ajuda a tirar um volumoso de um Passeio e colocar numa Fiorino que ainda não carregou.' },
      { title: 'Atualizar o carregamento', target: '🔄 Atualizar carregamento', text: 'Lê a fila do SPX para saber quais rotas já saíram. Rota que já saiu não aparece como opção.' },
      { title: 'Onde colocar o pacote', target: 'Onde colocar o pacote?', card: true, text: 'Digite o BR. O app mostra onde ele está e sugere as Fiorinos atribuídas que ainda não carregaram, da parada mais próxima para a mais longe (★ = melhor opção).' },
      { title: 'Fiorino saindo com Passeio', target: 'Rotas de Fiorino saindo com Passeio', card: true, text: 'Rotas que a roteirização marcou como Fiorino, mas o motorista é de Passeio. Copie ATs e telefones para corrigir.' },
    ],
  },
  eha: {
    title: 'EHA',
    steps: [
      { title: 'Pacotes que não couberam', text: 'Pacotes retirados do veículo por não caber (EHA), da planilha [IR] Base de BRs, filtrados pela station configurada.' },
      { title: 'Atualizar a base', target: '🔄 Atualizar base', text: 'Lê a planilha de novo. Ela é atualizada a cada 4 horas.' },
      { title: 'Pacotes do turno e dashboard', target: '☰ Pacotes do turno', text: 'Pacotes do turno: em qual rota cada pacote com EHA está saindo hoje. Dashboard: retiradas por dia e turno, reincidentes e comparação com a sub-regional.' },
      { title: 'Rotas para conferir', target: 'Rotas do turno com pacotes de EHA', card: true, text: 'As rotas que levam esses pacotes. Confira se cabem antes de liberar: se voltarem de novo, o risco de cancelamento sobe.' },
    ],
  },
  blocklist: {
    title: 'Bloqueados',
    steps: [
      { title: 'Quem não pode ser convocado', text: 'Motoristas bloqueados não entram na fila de atribuição.' },
      { title: 'Três origens', target: 'Total bloqueados', card: true, text: 'Redelivery (automático, mais de 5 pacotes em aberto), bloqueio manual e o bloqueio do cadastro do SPX.' },
      { title: 'Bloquear', target: '⊘ Bloquear', text: 'Bloqueie um motorista ou uma lista, com o motivo.' },
      { title: 'Buscar', target: 'placeholder:Buscar por ID', text: 'Ache um bloqueado por ID, nome ou motivo.' },
    ],
  },
  config: {
    title: 'Configurações',
    steps: [
      { title: 'As regras do app', text: 'Aqui a gestão define os critérios que as outras telas usam. Depois de mudar, clique em Salvar regras no topo.' },
      { title: 'Turnos', target: 'Horários por turno', card: true, text: 'Os horários de início que identificam AM, PM1 e PM2 na disponibilidade.' },
      { title: 'Rodízio', target: 'Rodízio', card: true, text: 'Quantos dias sem rota para o motorista ser rodízio médio ou alto.' },
      { title: 'Score de prioridade', target: 'Score de prioridade', card: true, text: 'Quanto pesa o DS, as recusas e o no-show na ordem da fila de atribuição.' },
      { title: 'Google Sheets', target: '🔗 Google Sheets', card: true, text: 'Conta Google e planilha compartilhada da equipe. Enviar grava os dados deste computador; Buscar traz os da planilha.' },
      { title: 'Base de EHA', target: '📦 Base de EHA', card: true, text: 'Link da planilha de EHA e o station name do hub.' },
    ],
  },
}
