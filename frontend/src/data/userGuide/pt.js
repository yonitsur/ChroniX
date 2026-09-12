export const userGuidePt = {
  "getting_started": {
    "welcomeTitle": "Bem-vindo ao ChroniX",
    "welcomeDesc": "O ChroniX transforma qualquer tema histórico, científico ou literário em uma linha do tempo visual e interativa alimentada pelo Google Gemini, HistropediaJS e imagens verificadas do Wikimedia. Criado para a exploração ativa, ele permite fazer perguntas investigativas, comparar épocas e descobrir conexões profundas através do tempo.",
    "exploreBtn": "Explorar exemplos",
    "navHeading": "1. Navegação no painel da linha do tempo",
    "zoomTitle": "Zoom fluido em múltiplas escalas",
    "zoomDesc": "Role com o mouse ou use o touchpad para aproximar e afastar suavemente, de milhões de anos até dias específicos.",
    "panTitle": "Navegação contínua no tempo",
    "panDesc": "Clique e arraste em qualquer ponto do fundo para se deslocar livremente para frente ou para trás nos séculos.",
    "fitAllTitle": "Ajustar tudo à tela",
    "fitAllDesc": "Clique em \"Ajustar tudo\" na barra de ferramentas para visualizar a linha do tempo completa e centralizada.",
    "inspectHeading": "2. Inspeção de eventos e gavetas",
    "eventDrawerTitle": "Painel de detalhes do evento",
    "eventDrawerDesc": "Clique em qualquer cartão para ver fotografias históricas, datas certificadas, resumos da Wikipédia e ferramentas de edição.",
    "cardsDrawerTitle": "Painel da lista cronológica",
    "cardsDrawerDesc": "Abra a lista cronológica para pesquisar, filtrar e navegar diretamente para qualquer evento na tela.",
    "starTitle": "Destacar eventos favoritos",
    "starDesc": "Clique no ícone de estrela de qualquer cartão para destacar marcos históricos e mantê-los visíveis mesmo com zoom distante.",
    "exploreTitle": "Modo de exploração guiada",
    "exploreDesc": "Inicie um tour interativo passo a passo pelos eventos, sincronizando automaticamente o mapa e a linha do tempo em tela dividida para uma jornada no tempo e no espaço.",
    "stopGenTitle": "Interromper geração:",
    "stopGenDesc": "Pressione Esc ou clique em \"Parar geração\" na barra de status inferior a qualquer momento."
  },
  "prompt_mastery": {
    "title": "Guia de elaboração de prompts",
    "subtitle": "Basta usar poucas palavras bem escolhidas. Veja como obter exatamente o nível de detalhe, faixas paralelas e formato ideal.",
    "detailHeading": "1. Escolhendo o nível de detalhe",
    "levels": {
      "overview": {
        "name": "Visão geral (Overview)",
        "count": "~10–15 eventos",
        "bestFor": "Uma visão panorâmica dos principais marcos ou acontecimentos concentrados em curto período.",
        "example": "\"Independência do Brasil: Visão geral\" ou \"Egito Antigo: Panorama\""
      },
      "standard": {
        "name": "Padrão (Recomendado)",
        "count": "~20–30 eventos",
        "bestFor": "Equilíbrio perfeito de profundidade e narrativa para eras históricas completas e biografias.",
        "example": "\"Império do Brasil: De Dom Pedro I à República\" ou \"Corrida Espacial: NASA vs. URSS\""
      },
      "deep_dive": {
        "name": "Aprofundado (Deep Dive)",
        "count": "~35–50 eventos",
        "bestFor": "Linhas do tempo com múltiplas faixas paralelas e pesquisa histórica detalhada passo a passo.",
        "example": "\"Segunda Guerra Mundial, divida em faixas paralelas: Frente Ocidental vs. Frente Oriental\""
      }
    },
    "swimlanesHeading": "2. Faixas paralelas (Swimlanes)",
    "swimlanesDesc": "Peça explicitamente para dividir a linha do tempo em faixas paralelas:",
    "swimlanesExamples": [
      {
        "title": "Lados rivais:",
        "desc": "\"Divida em faixas paralelas: Programa Espacial Soviético vs. NASA\""
      },
      {
        "title": "Trilhas temáticas:",
        "desc": "\"Divida em faixas paralelas: Invenções tecnológicas, transportes e movimentos operários\""
      },
      {
        "title": "Trajetórias biográficas:",
        "desc": "\"Divida em faixas paralelas: Avanços científicos vs. Vida pessoal e impacto público\""
      }
    ],
    "topicSplitHeading": "3. Divida em temas ou tópicos",
    "topicSplitDesc": "Peça explicitamente para dividir uma linha do tempo por assunto:",
    "topicSplitExamples": [
      { "title": "Temas históricos:", "desc": "\"Divida em temas: Política, Militar e Cultura\"" },
      { "title": "Tópicos de vida:", "desc": "\"Divida em tópicos: Educação, Carreira e Marcos familiares\"" }
    ],
    "themesHeading": "4. Temas de cor automáticos",
    "themesTitle": "Cores temáticas inteligentes e legenda flutuante",
    "themesDesc": "Em cronologias simples, os eventos são coloridos automaticamente por tema (Política, Ciência, Cultura) com legenda arrastável e filtrável.",
    "framingHeading": "5. Formulação do prompt: Curto vs. Detalhado",
    "conciseTitle": "Natural e curto: Deixe a IA explorar",
    "conciseDesc": "Prompts como \"Evolução do cavalo\" ou \"Revolução Industrial\" permitem que a IA descubra marcos importantes com total autonomia.",
    "detailedTitle": "Estruturado: Foque em um recorte específico",
    "detailedDesc": "Oriente a IA explicitamente quando quiser um ângulo específico (ex.: \"Revolução Francesa de 1789 a 1799\").",
    "narrativeHeading": "6. Construa uma narrativa, não apenas uma lista",
    "narrativeTitle": "Conecte causas, pontos de virada e consequências",
    "narrativeDesc": "Formule o prompt como uma história de mudança: indique a situação inicial, a transformação, as forças internas e externas e o desfecho. Assim, a linha do tempo terá um arco causal claro, não marcos desconectados.",
    "narrativeExample": "\"Como uma república próspera se tornou um império, e como a corrupção interna e as invasões externas levaram ao seu colapso?\"",
    "multilingualHeading": "7. Suporte multilíngue completo",
    "multilingualTitle": "Escreva em qualquer idioma",
    "multilingualDesc": "O ChroniX opera em qualquer língua. Os eventos e links da Wikipédia seguirão o idioma do seu prompt."
  },
  "grounding": {
    "title": "Modos Rápido vs. Verificado (Google Grounding)",
    "subtitle": "Gere linhas do tempo rapidamente com o conhecimento do modelo por padrão, ou mude para o modo Verificado para checagem ao vivo no Google.",
    "howItWorksHeading": "1. Como funcionam os modos Rápido e Verificado?",
    "howItWorksTitle": "Conhecimento interno do modelo vs. Pesquisa web ao vivo",
    "howItWorksDesc": "Por padrão, o modo Rápido gera linhas do tempo em ~2–3 segundos usando o conhecimento interno do modelo. Quando o modo Verificado está ativado, o Gemini realiza buscas em tempo real no Google para checar fatos e certificar datas antes de gerar a linha do tempo ou responder no chat.",
    "toggleHeading": "2. Seletor simples Rápido / Verificado",
    "toggleTitle": "Controle com um clique e retenção automática",
    "toggleDesc": "Clique no seletor Rápido / Verificado na barra de pesquisa ou no chat a qualquer momento. O modo Rápido vem ativado por padrão; sua preferência fica salva para as próximas sessões.",
    "featuresHeading": "3. Principais benefícios de linhas do tempo verificadas",
    "cards": [
      {
        "title": "Acontecimentos recentes e de última hora",
        "desc": "Monte linhas do tempo para eventos deste ano, mês ou semana, livres de cortes estáticos de treinamento."
      },
      {
        "title": "Rigor e precisão cronológica",
        "desc": "Cruza datas de batalhas, tratados, posses e missões espaciais com fontes primárias, prevenindo alucinações."
      },
      {
        "title": "Fontes confiáveis e links diretos",
        "desc": "Veja as consultas exatas realizadas pelo Google e acesse artigos externos verificados no painel de detalhes."
      }
    ],
    "tradeoffsHeading": "4. Quando utilizar? (Velocidade vs. Profundidade)",
    "modes": [
      {
        "title": "Modo Rápido (Padrão / Paramétrico)",
        "desc": "Ativado por padrão. Perfeito para história antiga, literatura, mitologia e universos de ficção (Tolkien, Marvel). Resposta ágil em 2–3 segundos."
      },
      {
        "title": "Modo Verificado (Profundo / Pesquisa web)",
        "desc": "Ideal para história moderna, exploração espacial recente, tecnologia e checagem minuciosa de datas. Adiciona buscas ao vivo no Google para máxima precisão."
      }
    ]
  },
  "prompt_showcase": {
    "title": "Galeria de prompts selecionados",
    "subtitle": "Explore prompts recomendados, incluindo perguntas narrativas que conectam causas, viradas e resultados. Clique em \"Testar agora ↗\" para começar!",
    "tryNow": "Testar agora",
    "copyPrompt": "Copiar prompt",
    "copied": "Copiado!",
    "whyItWorksLabel": "Por que este prompt funciona:",
    "detailLevels": {
      "overview": "Visão geral",
      "standard": "Padrão",
      "deep_dive": "Aprofundado"
    }
  },
  "event_editing": {
    "title": "Edição e criação de eventos",
    "subtitle": "Autonomia total para personalizar, editar ou adicionar eventos com assistência de IA e busca na Wikipédia.",
    "cards": [
      {
        "title": "Preenchimento automático com IA Gemini",
        "desc": "Digite o título e clique em Preenchimento IA para buscar datas, descrições e coordenadas automaticamente."
      },
      {
        "title": "Busca direta na Wikipédia",
        "desc": "Pesquise na Wikipédia para obter fotografias verificadas e resumos enciclopédicos."
      },
      {
        "title": "Adicionar evento personalizado (+)",
        "desc": "Clique em + para acrescentar acontecimentos a faixas existentes ou criar novas faixas na hora."
      }
    ],
    "geoCoordsTitle": "Coordenadas geográficas",
    "geoCoordsDesc": "Informe o nome do local e coordenadas no editor para posicionar um marcador interativo no mapa-múndi."
  },
  "ai_refine": {
    "title": "Conversar e editar com chat de IA",
    "subtitle": "Abra \"Converse com a sua linha do tempo\" — a bolha de chat flutuante no canto inferior direito — para ter um diálogo real sobre sua cronologia. Faça perguntas de acompanhamento para se aprofundar ou peça à IA para alterá-la: adicionar, remover, dividir em faixas, renomear ou refinar eventos. A linha do tempo é atualizada ao vivo, e cada edição conta com desfazer em um passo.",
    "splitTipTitle": "Perguntar ou agir — em uma única conversa",
    "splitTipDesc": "Digite uma pergunta para obter uma resposta fundamentada ou um pedido (\"Dividir em Política e Cultura\") para transformar a linha do tempo. Alterne a pílula Verificado/Rápido no cabeçalho do chat para balancear profundidade e velocidade, e use \"Conversar sobre este evento\" em qualquer gaveta de evento.",
    "examplesHeading": "O que você pode pedir ao chat:",
    "prompts": [
      {
        "label": "Dividir em eixos temáticos:",
        "prompt": "\"Divida a linha do tempo em três faixas paralelas: Política, Ciência e Cultura\""
      },
      {
        "label": "Separar por regiões geográficas:",
        "prompt": "\"Separe os eventos em duas linhas do tempo: Frente Ocidental e Frente Oriental\""
      },
      {
        "label": "Distinguir lados opostos:",
        "prompt": "\"Reestruture os eventos em duas faixas paralelas: Estados Unidos vs. União Soviética\""
      },
      {
        "label": "Ajustar temas existentes:",
        "prompt": "\"Adicione o tema 'Diplomacia', remova o tema 'Cultura' e renomeie 'Ciência' para 'Ciência e Tecnologia'\""
      },
      {
        "label": "Expandir um período específico:",
        "prompt": "\"Acrescente mais 5 batalhas marcantes entre os anos de 1942 e 1943\""
      },
      {
        "label": "Destacar conquistas científicas:",
        "prompt": "\"Adicione as principais invenções científicas e marcos tecnológicos desta época\""
      }
    ]
  },
  "geo_map": {
    "title": "Mapa-múndi sincronizado em tempo real",
    "subtitle": "Veja onde a história aconteceu em um mapa interativo perfeitamente conectado à linha do tempo.",
    "modesHeading": "4 modos de visualização do mapa:",
    "modes": [
      {
        "title": "1. Globo flutuante",
        "desc": "Botão flutuante que exibe a contagem de eventos localizados. Clique para abrir em janela PiP ou tela dividida."
      },
      {
        "title": "2. Imagem sobre imagem (PiP)",
        "desc": "Janela compacta flutuando sobre a linha do tempo. Arraste pela barra de título ou redimensione pelos cantos."
      },
      {
        "title": "3. Tela dividida ajustável",
        "desc": "Mapa em cima e linha do tempo embaixo. Arraste a barra divisória para ajustar a proporção ideal."
      },
      {
        "title": "4. Mapa em tela cheia",
        "desc": "Expande o mapa para tela inteira para uma análise espacial abrangente dos eventos."
      }
    ],
    "syncHeading": "Sincronização bidirecional completa",
    "syncPoints": [
      "Da linha do tempo para o mapa: Ao clicar em um cartão de evento, o mapa voa diretamente até o marcador correspondente.",
      "Do mapa para a linha do tempo: Clicar em um marcador no mapa foca e centraliza o evento correspondente na linha do tempo.",
      "Identidade visual: Os marcadores do mapa utilizam a mesma cor da faixa do evento para reconhecimento visual imediato."
    ]
  },
  "export_saving": {
    "title": "Exportação e salvamento na nuvem",
    "subtitle": "Guarde suas pesquisas, exporte imagens para apresentações ou compartilhe seus conjuntos de dados.",
    "cards": [
      {
        "title": "Imagem de alta resolução (PNG)",
        "desc": "Baixe uma imagem nítida da sua linha do tempo no menu Mais Ações."
      },
      {
        "title": "Exportação e importação JSON",
        "desc": "Exporte o conjunto completo em formato JSON ou importe arquivos de cronologias externas."
      },
      {
        "title": "Salvo na sua conta em nuvem",
        "desc": "Suas linhas do tempo são salvas automaticamente na biblioteca do Supabase para acesso em qualquer dispositivo."
      }
    ],
    "disclaimerTitle": "Nota sobre exatidão da IA",
    "disclaimerDesc": "Os eventos são gerados por IA e enriquecidos com a Wikipédia. Datas na Antiguidade podem ser estimativas. Você sempre pode editar e conferir qualquer evento."
  },
  "footer": {
    "tagline": "Guia do Usuário ChroniX • Criado para mentes curiosas, pesquisadores e educadores.",
    "closeBtn": "Fechar guia"
  }
};
