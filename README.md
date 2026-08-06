# 🛠️ GestorOS — Sistema de Gestão para Assistência Técnica

**GestorOS** é uma aplicação desktop completa, moderna e de alto desempenho desenvolvida para assistências técnicas de celulares, computadores e eletrônicos em geral. O sistema combina controle de Ordens de Serviço, Estoque, Financeiro, Comissões e Vendas de Balcão (PDV) com automações via **WhatsApp Bot** e **Links Públicos de Acompanhamento** para os clientes.

---

## ✨ Principais Funcionalidades

### 📋 1. Gestão de Ordens de Serviço (Kanban & Mensal)
- **Quadro Kanban Interativo:** Acompanhamento visual de OS nas etapas *Recebido (Aguardando)*, *Em Andamento (Bancada)* e *Concluído (Pronto)*.
- **Filtro Mensal e Histórico:** Navegação simples entre meses/anos para análise histórica de atendimentos.
- **Checklist de Inspeção de Entrada:** Seleção rápida de avarias prévias do aparelho (tela trincada, botões, marcas de uso) para proteção legal da assistência.
- **Emissão de Recibos Profissionais:** Geração de comprovante de entrada/conclusão formatado e pronto para impressão ou salvamento em PDF.

### 📱 2. Robô WhatsApp Integrado & Notificações Ativas
- **Notificações Automáticas:** O robô envia mensagens proativas no WhatsApp do cliente ao cadastrar uma OS, ao mover para a bancada e ao finalizar o serviço.
- **Consulta de Status 24/7:** O cliente pode enviar uma mensagem ao WhatsApp da loja e consultar o estado do aparelho apenas digitando o número da OS.
- **Proteção Anti-Spam:** Filtros de intervalo e detecção de contas Business para prevenção de bloqueios pela Meta.

### 🌐 3. Link Público de Acompanhamento em Tempo Real
- **Acesso Externo Seguro:** Conexão instantânea via **Cloudflare Tunnels** (`trycloudflare.com`) sem necessidade de IP fixo ou abertura de portas no roteador.
- **Zero Telas de Bloqueio:** O cliente clica no link enviado pelo WhatsApp e visualiza o status e o recibo diretamente no navegador do celular, sem telas de confirmação ou cadastros.

### 📦 4. Controle de Estoque & PDV (Venda Rápida)
- **PDV de Balcão:** Venda rápida de acessórios e peças com baixa automática no estoque.
- **Transações Atômicas:** Garantia de consistência no SQLite (Rollback automático se a transação falhar).
- **Precificação Transparente:** Separação entre *Preço de Custo* (fornecedor) e *Preço de Venda* (cliente) para cálculo preciso do lucro líquido.

### 💰 5. Financeiro & Comissões de Técnicos
- **Fluxo de Caixa:** Registro automático de receitas (OS e PDV) e despesas com filtro mensal.
- **Cálculo de Comissões:** Cálculo automático da comissão individual de cada técnico com base no faturamento líquido gerado (descontando o custo dos materiais).

---

## 🏗️ Arquitetura e Tecnologias

- **Core & Runtime:** [Electron](https://www.electronjs.org/) + [Node.js](https://nodejs.org/)
- **Backend API:** [Express.js](https://expressjs.com/) (Servidor REST interno na porta 3000)
- **Banco de Dados:** [SQLite3](https://www.sqlite.org/) em modo WAL (Write-Ahead Logging) para alta velocidade e concorrência segura + Backup automático contínuo via `VACUUM INTO`.
- **Túnel de Conexão Externa:** [Cloudflare Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) (`untun`)
- **WhatsApp Engine:** `whatsapp-web.js` via Puppeteer headless.
- **Frontend Modular:** Módulos ES6 nativos (`app.js`, `kanban.js`, `estoque.js`, `financeiro.js`, `tecnicos.js`, `config.js`, `checklist.js`, `cycle.js`, `utils.js`).
- **Design & UI:** Vanilla CSS + [TailwindCSS](https://tailwindcss.com/) + Phosphor Icons.
- **Segurança Anti-XSS:** Sanitização rigorosa com `escapeHTML` e renderização segura via `.textContent`.

---

## 📂 Estrutura de Arquivos do Projeto

```text
agendamento/
├── public/                 # Interface do Usuário (Frontend)
│   ├── index.html          # Layout Principal SPA (Single Page Application)
│   └── js/                 # Módulos JavaScript (ES Modules)
│       ├── app.js          # Orquestrador das abas e inicializador do Frontend
│       ├── api.js          # Camada centralizada de requisições HTTP (Fetch API)
│       ├── kanban.js       # Lógica dos quadros de Ordens de Serviço
│       ├── estoque.js      # Módulo de Produtos e PDV (Venda Rápida)
│       ├── financeiro.js   # Módulo de Transações e DRE simplificado
│       ├── tecnicos.js     # Módulo de Gestão e Comissões de Técnicos
│       ├── config.js       # Configurações do negócio e mensagens do Bot
│       ├── checklist.js    # Gerenciador do checklist dinâmico de avarias
│       ├── cycle.js        # Carrossel de seleção mensal/anual
│       └── utils.js        # Utilitários (Sanitização XSS, Toasts, Formatação)
├── src/                    # Backend e Serviços Node.js
│   ├── ApiServer.js        # Rotas da API REST (Express)
│   ├── Database.js         # Gerenciamento SQLite, migrações e rotinas de backup
│   ├── WhatsAppBot.js      # Integração WhatsApp, QR Code e Máquina de Estados
│   ├── TunnelManager.js    # Gerenciador do Cloudflare Tunnel
│   └── Logger.js           # Logger interno de eventos e erros
├── main.js                 # Processo Principal do Electron (Window Management)
├── index.js                # Bootstrap/Orquestrador do Backend
└── package.json            # Dependências e scripts de build
```

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- [Node.js](https://nodejs.org/) versão 18 ou superior instalada.
- Google Chrome instalado no computador (utilizado pelo robô do WhatsApp).

### 1. Clonar o repositório e instalar dependências
```bash
git clone https.github.com/remixxlf/AgendorOS.git
cd AgendorOS
npm install
```

### 2. Executar em Modo de Desenvolvimento
```bash
npm start
```

### 3. Gerar o Instalador Executável (Windows `.exe`)
```bash
npm run build
```
O instalador `.exe` será gerado na pasta `dist/`.

---

## 🛡️ Licença e Autor

Desenvolvido para **GestorOS**. Todos os direitos reservados.
