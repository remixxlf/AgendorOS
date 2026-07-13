// Carrega as variáveis de ambiente do arquivo .env (ex: NUMERO_DONO)
require('dotenv').config();

// Importamos as ferramentas que o nosso servidor vai usar
const express = require('express');
const cors = require('cors');
const localtunnel = require('localtunnel');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const alasql = require('alasql');
const { execSync } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { app: electronApp } = require('electron');

function encontrarChrome() {
    try {
        const regResult = execSync(
            'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
            { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const match = regResult.match(/REG_SZ\s+(.+\.exe)/i);
        if (match && match[1]) {
            const caminho = match[1].trim();
            if (fs.existsSync(caminho)) return caminho;
        }
    } catch (e) {}

    const caminhosComuns = [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];

    for (const caminho of caminhosComuns) {
        if (caminho && fs.existsSync(caminho)) return caminho;
    }
    console.error('[CHROME] ❌ Nenhum navegador Chromium encontrado!');
    return null;
}

function log(tag, mensagem) {
    const agora = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${agora}] [${tag}] ${mensagem}`);
}

const TIMEOUT_INATIVIDADE_MS = 30 * 60 * 1000;

module.exports = async function startApp(mainWindow) {
    const notificarUI = (tipo, mensagem) => {
        if (mainWindow) mainWindow.webContents.send('update-status', { type: tipo, msg: mensagem });
    };

    // =========================================================================
    // 1. CONFIGURAÇÕES INICIAIS DO BANCO LOCAL (ALASQL)
    // =========================================================================
    const appDataPath = electronApp.getPath('userData');
    const DB_FILE = path.join(appDataPath, 'banco_os.json'); // Novo arquivo de banco

    alasql('CREATE TABLE IF NOT EXISTS ordens_servico (id INT AUTO_INCREMENT, cliente_nome STRING, cliente_telefone STRING, equipamento STRING, problema STRING, solucao STRING, valor NUMBER, status STRING, tecnico_id INT, data_criacao STRING)');
    alasql('CREATE TABLE IF NOT EXISTS tecnicos (id INT AUTO_INCREMENT, nome STRING, comissao INT)');
    alasql('CREATE TABLE IF NOT EXISTS transacoes (id INT AUTO_INCREMENT, os_id INT, tipo STRING, valor NUMBER, data STRING, descricao STRING)');
    alasql('CREATE TABLE IF NOT EXISTS configuracoes (id INT AUTO_INCREMENT, chave STRING UNIQUE, valor STRING)');

    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            if (data.ordens_servico) alasql.tables.ordens_servico.data = data.ordens_servico;
            if (data.tecnicos) alasql.tables.tecnicos.data = data.tecnicos;
            if (data.transacoes) alasql.tables.transacoes.data = data.transacoes;
            if (data.configuracoes) alasql.tables.configuracoes.data = data.configuracoes;

            if (data.ordens_servico && data.ordens_servico.length > 0) alasql.tables.ordens_servico.ident = Math.max(...data.ordens_servico.map(i => i.id));
            if (data.tecnicos && data.tecnicos.length > 0) alasql.tables.tecnicos.ident = Math.max(...data.tecnicos.map(i => i.id));
            if (data.transacoes && data.transacoes.length > 0) alasql.tables.transacoes.ident = Math.max(...data.transacoes.map(i => i.id));
            if (data.configuracoes && data.configuracoes.length > 0) alasql.tables.configuracoes.ident = Math.max(...data.configuracoes.map(i => i.id));
        }
    } catch (e) { console.error("Erro ao carregar banco JSON:", e); }

    if (alasql.tables.configuracoes.data.length === 0) {
        alasql("INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', 'Minha Assistência')");
    }

    const configDefaults = {
        'msg_saudacao': 'Olá {nome}, como podemos ajudar?',
        'msg_os_pronta': '🎉 Boas notícias! Seu equipamento ({equipamento}) está PRONTO para retirada. O valor ficou em R$ {valor}.',
    };
    for (const [chave, valor] of Object.entries(configDefaults)) {
        if (!alasql('SELECT * FROM configuracoes WHERE chave = ?', [chave])[0]) {
            alasql("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", [chave, valor]);
        }
    }

    const saveDb = () => {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            ordens_servico: alasql.tables.ordens_servico.data,
            tecnicos: alasql.tables.tecnicos.data,
            transacoes: alasql.tables.transacoes.data,
            configuracoes: alasql.tables.configuracoes.data
        }, null, 2));
    };
    saveDb(); 

    const dbAll = async (sql, params = []) => alasql(sql, params); 
    const dbRun = async (sql, params = []) => { alasql(sql, params); saveDb(); };
    const dbGet = async (sql, params = []) => alasql(sql, params)[0]; 

    const NUMERO_DONO = process.env.NUMERO_DONO || null;
    const userStages = {};

    // =========================================================================
    // 2. INICIANDO O SERVIDOR WEB (EXPRESS) E A API DO PAINEL
    // =========================================================================
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(cors());

    // --- Rotas OS ---
    app.get('/api/os', async (req, res) => {
        const ordens = await dbAll('SELECT * FROM ordens_servico ORDER BY id DESC');
        res.json(ordens);
    });

    app.post('/api/os', async (req, res) => {
        const { cliente_nome, cliente_telefone, equipamento, problema } = req.body;
        const hoje = new Date().toISOString().split('T')[0];
        await dbRun("INSERT INTO ordens_servico (cliente_nome, cliente_telefone, equipamento, problema, status, data_criacao) VALUES (?, ?, ?, ?, 'recebido', ?)", 
            [cliente_nome, cliente_telefone, equipamento, problema, hoje]);
        res.json({ success: true });
    });

    let clientGlobal = null;
    const enviarMsgWhatsApp = async (numero, msg) => {
        if (clientGlobal && numero) {
            try {
                let formatted = numero.replace(/\D/g, '');
                if (!formatted.endsWith('@c.us')) formatted += '@c.us';
                await clientGlobal.sendMessage(formatted, msg);
            } catch(e) { log('API', 'Erro ao enviar ZAP: ' + e.message); }
        }
    };

    // Rota de alteração de Status (Avançar na Oficina)
    app.post('/api/os/:id/status', async (req, res) => {
        const osId = parseInt(req.params.id);
        const { status, tecnico_id } = req.body; // status pode ser 'recebido', 'em_andamento'
        await dbRun("UPDATE ordens_servico SET status = ?, tecnico_id = ? WHERE id = ?", [status, tecnico_id, osId]);
        res.json({ success: true });
    });

    // Rota Concluir e Faturar (Gera Mensagem e Transação)
    app.post('/api/os/:id/concluir', async (req, res) => {
        const osId = parseInt(req.params.id);
        const { tecnico_id, valor, solucao } = req.body;
        const hoje = new Date().toISOString().split('T')[0];

        await dbRun("UPDATE ordens_servico SET status = 'concluido', solucao = ?, tecnico_id = ?, valor = ? WHERE id = ?", [solucao, tecnico_id, valor, osId]);
        
        const os = await dbGet("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
        await dbRun("INSERT INTO transacoes (os_id, tipo, valor, data, descricao) VALUES (?, 'receita', ?, ?, ?)", 
            [osId, parseFloat(valor), hoje, `OS #${osId} - ${os.equipamento}`]);
            
        if (os.cliente_telefone) {
            let msgPronta = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'msg_os_pronta'");
            msgPronta = msgPronta.valor.replace('{equipamento}', os.equipamento).replace('{valor}', valor);
            await enviarMsgWhatsApp(os.cliente_telefone, msgPronta);
        }

        res.json({ success: true });
    });
    
    app.delete('/api/os/:id', async (req, res) => {
        await dbRun("DELETE FROM ordens_servico WHERE id = ?", [parseInt(req.params.id)]);
        res.json({ success: true });
    });

    // --- Rotas Tecnicos (Equipe) ---
    app.get('/api/tecnicos', async (req, res) => {
        res.json(await dbAll("SELECT * FROM tecnicos"));
    });
    app.post('/api/tecnicos', async (req, res) => {
        await dbRun("INSERT INTO tecnicos (nome, comissao) VALUES (?, ?)", [req.body.nome, req.body.comissao]);
        res.json({ success: true });
    });
    app.delete('/api/tecnicos/:id', async (req, res) => {
        await dbRun("DELETE FROM tecnicos WHERE id = ?", [parseInt(req.params.id)]);
        res.json({ success: true });
    });

    // --- Rotas Financeiro ---
    app.get('/api/financeiro/dashboard', async (req, res) => {
        res.json(await dbAll("SELECT * FROM transacoes"));
    });
    app.post('/api/despesas', async (req, res) => {
        const { descricao, valor, data } = req.body;
        await dbRun("INSERT INTO transacoes (tipo, valor, data, descricao) VALUES ('despesa', ?, ?, ?)", 
            [valor, data, descricao]);
        res.json({ success: true });
    });

    // --- Rotas Configs ---
    app.get('/api/configuracoes/nome', async (req, res) => {
        res.json({ nome: (await dbGet("SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'"))?.valor || '' });
    });
    app.post('/api/configuracoes/nome', async (req, res) => {
        await dbRun("UPDATE configuracoes SET valor = ? WHERE chave = 'nome_negocio'", [req.body.nome]);
        res.json({ success: true });
    });

    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`[EXPRESS] Servidor rodando na porta ${PORT}`);
        notificarUI('express', `Rodando (Porta ${PORT})`);
    });

    // =========================================================================
    // 3. WHATSAPP BOT (Opção C: Consulta de Status)
    // =========================================================================
    const chromePath = encontrarChrome();
    if (!chromePath) {
        notificarUI('bot', 'ERRO: Chrome não encontrado!');
        return;
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'gestor-os-bot',
            dataPath: path.join(appDataPath, 'whatsapp_os_session')
        }),
        puppeteer: {
            headless: true,
            executablePath: chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    clientGlobal = client; // Guarda globalmente

    let authTimeoutLimpar = setTimeout(async () => {
        notificarUI('bot', 'Erro: Sessão corrompida. Limpando dados...');
        try { await client.destroy(); } catch (e) {}
    }, 45000);

    client.on('qr', async (qr) => {
        clearTimeout(authTimeoutLimpar);
        try {
            const qrBase64 = await qrcode.toDataURL(qr);
            if (mainWindow) {
                mainWindow.webContents.send('qr-code', qrBase64);
                notificarUI('bot', 'Aguardando leitura do QR Code...');
            }
        } catch (e) { console.error(e); }
    });

    client.on('ready', async () => {
        clearTimeout(authTimeoutLimpar);
        log('BOT', 'Robô ONLINE!');
        notificarUI('bot', 'ONLINE! Pronto para atender.');
    });

    client.on('disconnected', async () => {
        notificarUI('bot', `Desconectado.`);
        try { await client.destroy(); } catch(e){}
    });

    const getUserStage = (user) => {
        if (!userStages[user]) {
            userStages[user] = { stage: 'MENU', ultimaInteracao: Date.now() };
        }
        return userStages[user];
    };

    client.on('message', async (message) => {
        if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;
        if (message.fromMe) return;

        const texto = (message.body || '').toLowerCase().trim();
        const contact = await message.getContact();
        const nomeCliente = contact.pushname || contact.name || 'Cliente';
        const user = message.from;

        const enviarMensagem = async (msg) => {
            try { await client.sendMessage(user, msg); } catch(e) {}
        };

        let uState = getUserStage(user);
        
        if (Date.now() - uState.ultimaInteracao > TIMEOUT_INATIVIDADE_MS) {
            uState.stage = 'MENU';
        }
        uState.ultimaInteracao = Date.now();

        if (texto === 'menu' || texto === 'sair' || texto === 'cancelar') {
            uState.stage = 'MENU';
        }

        if (uState.stage === 'MENU') {
            let nomeNegocio = (await dbGet("SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'"))?.valor || 'Assistência';
            let saudacao = (await dbGet("SELECT valor FROM configuracoes WHERE chave = 'msg_saudacao'"))?.valor || 'Olá {nome}!';
            saudacao = saudacao.replace(/{nome}/g, nomeCliente);
            
            await enviarMensagem(`⚙️ *${nomeNegocio.toUpperCase()}* ⚙️\n\n${saudacao}\n\nResponda com o NÚMERO da opção:\n\n1️⃣ Consultar status de aparelho\n2️⃣ Falar com um atendente`);
            uState.stage = 'AGUARDANDO_OPCAO';
            return;
        }

        if (uState.stage === 'AGUARDANDO_OPCAO') {
            if (texto === '1') {
                await enviarMensagem(`🔍 Certo! Por favor, digite o *NÚMERO DA SUA OS* (Ordem de Serviço) para eu consultar:`);
                uState.stage = 'CONSULTANDO_OS';
            } else if (texto === '2') {
                await enviarMensagem(`👨‍💻 Ok! Um atendente humano já vai falar com você. Aguarde um instante.`);
                if (NUMERO_DONO) {
                    await client.sendMessage(NUMERO_DONO, `⚠️ *ATENÇÃO*: O cliente *${nomeCliente}* (${user.split('@')[0]}) pediu atendimento humano.`);
                }
                uState.stage = 'MENU'; 
            } else {
                await enviarMensagem(`⚠️ Opção inválida. Digite 1 ou 2.`);
            }
            return;
        }

        if (uState.stage === 'CONSULTANDO_OS') {
            const osId = parseInt(texto.replace(/\D/g, ''));
            if (!osId || isNaN(osId)) {
                await enviarMensagem(`⚠️ Formato inválido. Digite apenas números. Exemplo: 15`);
                return;
            }
            
            const os = await dbGet("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
            if (!os) {
                await enviarMensagem(`❌ Não encontrei nenhuma Ordem de Serviço com o número *${osId}*. Verifique e digite novamente ou digite *Menu* para voltar.`);
            } else {
                let statusHuman = os.status;
                if(os.status === 'recebido') statusHuman = '🟡 Na fila de espera (Recebido)';
                if(os.status === 'em_andamento') statusHuman = '🔨 Em Manutenção (Bancada)';
                if(os.status === 'concluido') statusHuman = '✅ Concluído (Pronto para retirada)';
                
                await enviarMensagem(`📋 *Detalhes da OS #${os.id}*\n\nEquipamento: *${os.equipamento}*\nStatus: *${statusHuman}*\n\n_Para voltar ao menu inicial, digite *Menu*._`);
                uState.stage = 'MENU';
            }
            return;
        }
    });

    try {
        console.log('[WHATSAPP] Iniciando inicialização do client...');
        await client.initialize();
    } catch (e) {
        console.error('Erro crítico ao iniciar WhatsApp:', e);
        notificarUI('bot', 'ERRO FATAL: Falha ao iniciar robô.');
    }
};
