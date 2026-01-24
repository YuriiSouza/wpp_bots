export const HELP_MENU = `
Dúvidas frequentes:
0 - Encerrar atendimento
1 - Como funciona a convocação
2 - O que é NoShow
3 - Pacotes fora de rota
4 - Orientações para motoristas novatos
5 - Ocorrências e devoluções
6 - Não consegui entregar tudo
7 - Valores de pagamento
8 - Como o sistema define convocações
9 - Voltar
`;

export const HELP_ANSWERS: Record<string, string> = {
  '1': `📢 Como funciona a convocação de motoristas

A convocação acontece em etapas, de forma padronizada e transparente:

1️⃣ Convocação automática pelo sistema  
O sistema envia as rotas automaticamente com base em:
- disponibilidade informada no aplicativo,
- preferências de região,
- tipo de veículo,
- equilíbrio da operação no momento.

Quando essa etapa começa, é informado no grupo que as convocações do sistema foram enviadas.

2️⃣ Prazo de aceite  
Após o envio automático, os motoristas têm um prazo para aceitar ou recusar a rota diretamente no aplicativo.

3️⃣ Tratativa manual pelo analista  
Finalizado o prazo, as rotas não aceitas ficam disponíveis para tratativa manual.
Nesse momento, os analistas liberam as rotas pelo bot de atendimento.

4️⃣ Ordem de atendimento  
As rotas são atribuídas respeitando a ordem de quem entra em contato primeiro e a disponibilidade da rota no momento do atendimento.

📌 Importante:
- Marcar interesse no sistema não garante rota.
- Enviar várias mensagens não acelera o atendimento.
- Todo o processo é comunicado no grupo para garantir transparência.`,

  '2': `❌ O que é NoShow

NoShow significa rotas que não foram carregadas dentro do tempo previsto.

📌 Atenção:
- Rotas NoShow têm prioridade no carregamento.
- Sempre respeite os horários de carregamento informados.`,

  '3': `📍 Pacotes fora de rota

Quando identificar um possível pacote fora da sua rota, siga o procedimento obrigatório:

1️⃣ Tire um print do mapa  
O print deve mostrar:
- a última entrega realizada,
- o pacote fora da região,
- a distância em quilômetros.

2️⃣ Registre a ocorrência  
Anexe o print no formulário de ocorrência no aplicativo.

Esse processo garante padronização, análise correta e melhoria contínua da operação.`,

  '4': `🚀 Orientações para motoristas novatos

👷‍♂️ Segurança
- Utilize EPI completo (colete, botina com CA, pisca-alerta).
- Velocidade máxima no hub: 5 km/h.
- Estacione de ré e utilize calços nas rodas.

📦 Conferência
- Aguarde o conferente.
- Confira volumes e endereços.
- Só saia após liberação final.

🚚 Operação
- Atenção total ao pátio.
- Respeite sinalizações.
- Evite uso de celular durante atividades.

📱 Aplicativo
- Ative notificações.
- Configure regiões e disponibilidade corretamente.

🕔 Horários
AM:
- Convocação: 03:30 às 05:30
- Carregamento: 05:30 às 07:30

PM:
- Convocação: 09:30 às 11:30
- Carregamento: 11:30 às 13:30`,

  '5': `📦 Ocorrências e devoluções

Todos os motoristas que apresentarem ocorrências devem:

- Levar os pacotes ao HUB em até 24 horas após a saída para entrega.
- Sempre registrar a ocorrência no aplicativo.

📌 Boas práticas:
- Ocorrências entregues até às 08h são destaque positivo.
- Alto número de ocorrências impacta a performance.`,

  '6': `❗ Não consegui entregar tudo. E agora?

Você tem duas opções:

1️⃣ Solicitar redelivery  
- Entre no grupo de monitoramento.
- Um analista do monitoramento assume o acompanhamento a partir das 08:00.
- As ocorrências devem ser registradas no aplicativo no mesmo dia.

2️⃣ Não fazer redelivery  
- Registre a ocorrência no app.
- Leve os pacotes ao HUB no dia seguinte, o mais cedo possível.

📦 Horário de devolução:
- Das 06:00 às 14:00 (alterações são informadas no grupo).

⚠️ Muitas devoluções impactam negativamente sua performance.`,

  '7': `💰 Valores de pagamento

Moto:
- R$ 2,25 por pacote
- R$ 0,50 por KM planejado

Passeio:
- R$ 2,35 por pacote
- R$ 0,50 por KM planejado

Fiorino:
- R$ 2,60 por pacote
- R$ 0,60 por KM planejado`,

  '8': `⚙️ Como o sistema define as convocações

O sistema considera:
- disponibilidade informada pelo motorista,
- tipo de veículo,
- quantidade de rotas já realizadas,
- volume da rota,
- rotatividade entre motoristas.

📌 Quanto maior o engajamento e disponibilidade, maiores as chances de convocação.`,
};

export const NO_ROUTES_AVAILABLE = `🚫 No momento, não há rotas disponíveis.

📌 Entenda o fluxo:

AM:
- Convocação automática: 04:00
- Prazo de aceite: até 04:30

PM:
- Convocação automática: 09:00
- Prazo de aceite: até 09:30

As rotas não aceitas pelo sistema são disponibilizadas posteriormente pelos analistas através deste bot.

🕔 Horários de carregamento:
AM: 05:30 às 07:30
PM: 11:15 às 13:15

📞 Contato dos analistas:
Yuri – +55 62 3190-1283  
Raísa – +55 62 3190-1165  
Wanderson – +55 11 91375-7926  
Breno – +55 11 91533-4965
`;
