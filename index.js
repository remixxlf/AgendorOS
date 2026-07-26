// Carrega as variáveis de ambiente do arquivo .env (ex: NUMERO_DONO)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const alasql = require('alasql');
const { execSync } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { app: electronApp } = require('electron');

// =========================================================================
// UTILITÁRIOS
// =========================================================================
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
    console.error('[CHROME] Nenhum navegador Chromium encontrado!');
    return null;
}

function log(tag, mensagem) {
    const agora = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${agora}] [${tag}] ${mensagem}`);
}

const TIMEOUT_INATIVIDADE_MS = 30 * 60 * 1000;

// =========================================================================
// EXPORT PRINCIPAL
// =========================================================================
module.exports = async function startApp(mainWindow) {
    const notificarUI = (tipo, mensagem) => {
        if (mainWindow) mainWindow.webContents.send('update-status', { type: tipo, msg: mensagem });
    };

    // =========================================================================
    // 1. BANCO DE DADOS LOCAL (ALASQL + JSON)
    // =========================================================================
    const appDataPath = electronApp.getPath('userData');
    const DB_FILE = path.join(appDataPath, 'banco_os.json');

    alasql('CREATE TABLE IF NOT EXISTS ordens_servico (id INT AUTO_INCREMENT, cliente_nome STRING, cliente_telefone STRING, equipamento STRING, categoria STRING, problema STRING, solucao STRING, valor NUMBER, status STRING, tecnico_id INT, data_criacao STRING)');
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
        // Notificações ativas (enviadas pelo painel)
        'msg_bancada':              '🔨 Olá {nome}! Seu equipamento *{equipamento}* entrou para a bancada e já está sendo analisado.\n\n📋 *OS Nº {os_id}*\n\nAssim que tivermos novidades, entraremos em contato!',
        'msg_os_pronta':            '🎉 Boas notícias, {nome}! Seu equipamento *{equipamento}* está PRONTO para retirada.\n\n📋 *OS Nº {os_id}*\n💰 Valor: R$ {valor}\n\nAguardamos sua visita!',
        // Fluxo de menu receptivo
        'msg_saudacao':             'Olá *{nome}*! Seja bem-vindo(a)! 😊',
        'msg_menu_opcoes':          'Responda com o *NÚMERO* da opção desejada:\n\n1️⃣ Consultar status do meu aparelho\n2️⃣ Falar com um atendente',
        'msg_pedir_os':             '🔍 Certo! Digite o *NÚMERO DA SUA OS* para eu consultar:',
        'msg_atendente':            '👨‍💻 Ok! Um atendente humano já vai falar com você em breve. Aguarde!',
        // Mensagens de status da OS
        'msg_os_status':            '📋 *OS #{os_id}*\n📱 Equipamento: *{equipamento}*\n📌 Status: *{status}*\n\n_Digite *Menu* para voltar._',
        // Mensagens de erro
        'msg_erro_opcao_invalida':  '⚠️ Opção inválida. Por favor, digite *1* ou *2*.',
        'msg_erro_formato_os':      '⚠️ Formato inválido. Digite apenas o número da OS. Exemplo: *15*',
        'msg_erro_os_nao_encontrada': '❌ Não encontrei a OS *#{os_id}*. Verifique o número e tente novamente ou digite *Menu*.',
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

    const getNextId = async (tableName) => {
        const rows = await dbAll(`SELECT MAX(id) as maxId FROM ${tableName}`);
        return (rows[0] && rows[0].maxId ? rows[0].maxId : 0) + 1;
    };

    const NUMERO_DONO = process.env.NUMERO_DONO || null;
    const userStages = {};

    // =========================================================================
    // 2. SERVIDOR WEB (EXPRESS) + API DO PAINEL
    // =========================================================================
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(cors());

    // Referência global ao cliente WhatsApp (preenchida na seção 3)
    let clientGlobal = null;

    // Envia mensagem WhatsApp via API com filtro anti-spam para contas Business
    const enviarMsgWhatsApp = async (numero, msg) => {
        if (!clientGlobal || !numero) return;
        try {
            const somenteNumeros = numero.replace(/\D/g, '');

            // Resolve o WID correto (evita o erro "No LID for user")
            const wid = await clientGlobal.getNumberId(somenteNumeros);
            if (!wid) {
                log('API', `Número ${somenteNumeros} não encontrado no WhatsApp.`);
                return;
            }

            // === FILTRO ANTI-SPAM PARA CONTAS BUSINESS ===
            // Se for Business e não tiver nos enviado mensagem primeiro, bloqueia.
            try {
                const contact = await clientGlobal.getContactById(wid._serialized);
                const jaMessagou = clientGlobal._contatosQueMessagaram
                    ? clientGlobal._contatosQueMessagaram.has(wid._serialized)
                    : true;

                if (contact && contact.isBusiness && !jaMessagou) {
                    log('API', `[BLOQUEADO] Business ${somenteNumeros} não iniciou conversa. Notificação cancelada.`);
                    return;
                }
            } catch (contactErr) {
                log('API', `Aviso: não foi possível verificar tipo do contato ${somenteNumeros}.`);
            }

            await clientGlobal.sendMessage(wid._serialized, msg);
            log('API', `Mensagem enviada com sucesso para ${somenteNumeros}`);

            // 💡 ESTADO PROATIVO: Adiciona a etiqueta para evitar loops caso o cliente agradeça
            userStages[wid._serialized] = { stage: 'RECEM_NOTIFICADO', ultimaInteracao: Date.now() };
        } catch(e) { log('API', 'Erro ao enviar ZAP: ' + e.message); }
    };

    // --- Rotas OS ---
    app.get('/api/os', async (req, res) => {
        const ordens = await dbAll('SELECT * FROM ordens_servico ORDER BY id DESC');
        res.json(ordens);
    });

    app.post('/api/os', async (req, res) => {
        const { cliente_nome, cliente_telefone, equipamento, problema, categoria } = req.body;
        const hoje = new Date().toISOString().split('T')[0];
        const nextId = await getNextId('ordens_servico');
        await dbRun("INSERT INTO ordens_servico (id, cliente_nome, cliente_telefone, equipamento, categoria, problema, status, data_criacao) VALUES (?, ?, ?, ?, ?, ?, 'recebido', ?)",
            [nextId, cliente_nome, cliente_telefone, equipamento, categoria || 'outros', problema, hoje]);
        res.json({ success: true });
    });

    // Avançar status da OS (Bancada)
    app.post('/api/os/:id/status', async (req, res) => {
        const osId = parseInt(req.params.id);
        const { status, tecnico_id } = req.body;
        await dbRun("UPDATE ordens_servico SET status = ?, tecnico_id = ? WHERE id = ?", [status, tecnico_id, osId]);

        if (status === 'em_andamento') {
            const os = await dbGet("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
            if (os && os.cliente_telefone) {
                // Cooldown: evita múltiplos envios por clique duplo
                const podeNotif = clientGlobal && clientGlobal._podeNotificar
                    ? clientGlobal._podeNotificar(osId, 'bancada') : true;
                if (podeNotif) {
                    let msgBancada = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'msg_bancada'");
                    if (msgBancada) {
                        const msgFormatada = msgBancada.valor
                            .replace(/{equipamento}/g, os.equipamento)
                            .replace(/{os_id}/g, osId)
                            .replace(/{nome}/g, os.cliente_nome || 'Cliente');
                        await enviarMsgWhatsApp(os.cliente_telefone, msgFormatada);
                        log('API', `Notificação de bancada enviada para OS #${osId}`);
                    }
                } else {
                    log('API', `Notificação de bancada OS #${osId} ignorada (cooldown).`);
                }
            }
        }

        res.json({ success: true });
    });

    // Concluir e Faturar OS
    app.post('/api/os/:id/concluir', async (req, res) => {
        const osId = parseInt(req.params.id);
        const { tecnico_id, valor, solucao, gerar_financeiro } = req.body;
        const hoje = new Date().toISOString().split('T')[0];

        await dbRun("UPDATE ordens_servico SET status = 'concluido', solucao = ?, tecnico_id = ?, valor = ? WHERE id = ?", [solucao, tecnico_id, valor, osId]);

        const os = await dbGet("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
        
        if (gerar_financeiro) {
            const transId = await getNextId('transacoes');
            await dbRun("INSERT INTO transacoes (id, os_id, tipo, valor, data, descricao) VALUES (?, ?, 'receita', ?, ?, ?)",
                [transId, osId, parseFloat(valor), hoje, `OS #${osId} - ${os.equipamento}`]);
        }

        if (os.cliente_telefone) {
            const podeNotif = clientGlobal && clientGlobal._podeNotificar
                ? clientGlobal._podeNotificar(osId, 'concluido') : true;
            if (podeNotif) {
                let msgPronta = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'msg_os_pronta'");
                if (msgPronta) {
                    const msgFormatada = msgPronta.valor
                        .replace(/{equipamento}/g, os.equipamento)
                        .replace(/{valor}/g, valor)
                        .replace(/{os_id}/g, osId)
                        .replace(/{nome}/g, os.cliente_nome || 'Cliente');
                    await enviarMsgWhatsApp(os.cliente_telefone, msgFormatada);
                    log('API', `Notificação de OS concluída enviada para OS #${osId}`);
                }
            } else {
                log('API', `Notificação de OS concluída OS #${osId} ignorada (cooldown).`);
            }
        }

        res.json({ success: true });
    });

    app.delete('/api/os/:id', async (req, res) => {
        await dbRun("DELETE FROM ordens_servico WHERE id = ?", [parseInt(req.params.id)]);
        res.json({ success: true });
    });

    // --- Rotas Técnicos ---
    app.get('/api/tecnicos', async (req, res) => {
        res.json(await dbAll("SELECT * FROM tecnicos"));
    });
    app.post('/api/tecnicos', async (req, res) => {
        const nextId = await getNextId('tecnicos');
        await dbRun("INSERT INTO tecnicos (id, nome, comissao) VALUES (?, ?, ?)", [nextId, req.body.nome, req.body.comissao]);
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
        const nextId = await getNextId('transacoes');
        await dbRun("INSERT INTO transacoes (id, tipo, valor, data, descricao) VALUES (?, 'despesa', ?, ?, ?)",
            [nextId, valor, data, descricao]);
        res.json({ success: true });
    });
    app.post('/api/receitas', async (req, res) => {
        const { descricao, valor, data } = req.body;
        const nextId = await getNextId('transacoes');
        await dbRun("INSERT INTO transacoes (id, tipo, valor, data, descricao) VALUES (?, 'receita', ?, ?, ?)",
            [nextId, valor, data, descricao]);
        res.json({ success: true });
    });
    app.delete('/api/transacoes/:id', async (req, res) => {
        await dbRun("DELETE FROM transacoes WHERE id = ?", [parseInt(req.params.id)]);
        res.json({ success: true });
    });

    // --- Rotas Configurações (Genéricas) ---
    // GET: retorna TODAS as configurações como objeto {chave: valor}
    app.get('/api/configuracoes', async (req, res) => {
        const rows = await dbAll("SELECT chave, valor FROM configuracoes");
        const config = {};
        rows.forEach(r => { config[r.chave] = r.valor; });
        res.json(config);
    });
    // POST: recebe objeto {chave: valor, chave2: valor2, ...} e atualiza em lote
    app.post('/api/configuracoes', async (req, res) => {
        const updates = req.body;
        for (const [chave, valor] of Object.entries(updates)) {
            const existe = await dbGet('SELECT id FROM configuracoes WHERE chave = ?', [chave]);
            if (existe) {
                await dbRun('UPDATE configuracoes SET valor = ? WHERE chave = ?', [valor, chave]);
            } else {
                const nextId = await getNextId('configuracoes');
                await dbRun('INSERT INTO configuracoes (id, chave, valor) VALUES (?, ?, ?)', [nextId, chave, valor]);
            }
        }
        res.json({ success: true });
    });
    // Mantém rota legada de nome para não quebrar nada
    app.get('/api/configuracoes/nome', async (req, res) => {
        res.json({ nome: (await dbGet("SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'"))?.valor || '' });
    });

    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`[EXPRESS] Servidor rodando na porta ${PORT}`);
        notificarUI('express', `Rodando (Porta ${PORT})`);
    });

    // =========================================================================
    // 3. WHATSAPP BOT
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
            protocolTimeout: 60000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    clientGlobal = client;

    let botIsReady = false;
    let botReadyTimestamp = null;

    // Set de números que nos enviaram mensagem primeiro
    // Usado por enviarMsgWhatsApp para bloquear notificações para Business que não iniciaram conversa
    const contatosQueMessagaram = new Set();
    clientGlobal._contatosQueMessagaram = contatosQueMessagaram;

    // Cooldown de notificações por OS para evitar envios duplicados
    const notificacaoCooldown = new Map();
    const COOLDOWN_MS = 10000;
    const podeNotificar = (osId, tipo) => {
        const chave = `${osId}_${tipo}`;
        const ultimo = notificacaoCooldown.get(chave) || 0;
        if (Date.now() - ultimo < COOLDOWN_MS) return false;
        notificacaoCooldown.set(chave, Date.now());
        return true;
    };
    clientGlobal._podeNotificar = podeNotificar;

    let authTimeoutLimpar = setTimeout(async () => {
        notificarUI('bot', 'Erro: Sessão corrompida. Limpando dados...');
        try { await client.destroy(); } catch (e) {}
    }, 45000);

    client.on('qr', async (qr) => {
        clearTimeout(authTimeoutLimpar);
        botIsReady = false;
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
        // Proteção contra múltiplos eventos 'ready'
        if (botIsReady) {
            log('BOT', 'Evento ready duplicado ignorado.');
            return;
        }
        botIsReady = true;
        botReadyTimestamp = Date.now();
        log('BOT', 'Robô ONLINE!');
        notificarUI('bot', 'ONLINE! Pronto para atender.');
    });

    client.on('disconnected', async () => {
        botIsReady = false;
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
        try {
            // 🛡️ O "GUARDA-COSTAS" (Filtros de Bloqueio - Gatekeepers)
            if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;
            if (message.fromMe) return;

            const contatosIgnorados = []; // Ex: ['5511999999999@c.us']
            if (contatosIgnorados.includes(message.from)) return;

            // 👻 FILTRO DE TIMESTAMP (Evita Ghost Replies no Startup)
            const msgTimestamp = (message.timestamp || 0) * 1000;
            if (botReadyTimestamp && msgTimestamp < botReadyTimestamp) {
                log('BOT', `Ignorando mensagem antiga/fantasma de ${message.from}`);
                return;
            }

            // 3. Registra que esse número nos enviou mensagem (alimenta o filtro anti-spam)
            contatosQueMessagaram.add(message.from);

            // 4. Filtro Business (mantido original)
            const contact = await message.getContact();

            const texto = (message.body || '').toLowerCase().trim();
            const nomeCliente = contact.pushname || contact.name || 'Cliente';
            const user = message.from;

            const enviarMensagem = async (msg) => {
                try { await client.sendMessage(user, msg); } catch(e) {
                    log('BOT', `Erro ao responder ${user}: ${e.message}`);
                }
            };

            let uState = getUserStage(user);
            if (Date.now() - uState.ultimaInteracao > TIMEOUT_INATIVIDADE_MS) uState.stage = 'MENU';
            uState.ultimaInteracao = Date.now();

            // 💡 CONTROLE DE MENSAGENS PROATIVAS
            if (uState.stage === 'RECEM_NOTIFICADO') {
                const respostasCurtas = ['ok', 'obrigado', 'obrigada', 'valeu', 'show', 'beleza', 'joia', 'blz', 'vlw', 'ta bom', 'tá bom', 'certo', '👍', '🙏', 'top', 'blza', 'ok!'];
                
                // Se a mensagem for pequena e contiver uma palavra de agradecimento/confirmação
                if (texto.length <= 40 && respostasCurtas.some(palavra => texto.includes(palavra))) {
                    log('BOT', `Mensagem curta absorvida silenciosamente de ${user}`);
                    uState.stage = 'IDLE'; // Entra no modo ocioso
                    return; // Retorna cedo, não envia o menu!
                } else if (texto === 'menu' || texto === 'sair' || texto === 'cancelar') {
                    uState.stage = 'MENU';
                } else {
                    // Não é resposta curta, força menu normal
                    uState.stage = 'MENU';
                }
            } else if (texto === 'menu' || texto === 'sair' || texto === 'cancelar') {
                uState.stage = 'MENU';
            }

            // Função auxiliar: busca mensagem do banco e aplica variáveis
            const getMsgConfig = async (chave, vars = {}) => {
                const row = await dbGet('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
                let msg = row?.valor || '';
                for (const [k, v] of Object.entries(vars)) {
                    msg = msg.replace(new RegExp(`{${k}}`, 'g'), v ?? '');
                }
                return msg;
            };

            if (uState.stage === 'MENU') {
                const nomeNegocio = (await dbGet("SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'"))?.valor || 'Assistência';
                const saudacao = await getMsgConfig('msg_saudacao', { nome: nomeCliente });
                const menuOpcoes = await getMsgConfig('msg_menu_opcoes');
                await enviarMensagem(`⚙️ *${nomeNegocio.toUpperCase()}* ⚙️\n\n${saudacao}\n\n${menuOpcoes}`);
                uState.stage = 'AGUARDANDO_OPCAO';
                return;
            }

            if (uState.stage === 'AGUARDANDO_OPCAO') {
                if (texto === '1') {
                    await enviarMensagem(await getMsgConfig('msg_pedir_os'));
                    uState.stage = 'CONSULTANDO_OS';
                } else if (texto === '2') {
                    await enviarMensagem(await getMsgConfig('msg_atendente'));
                    if (NUMERO_DONO) await client.sendMessage(NUMERO_DONO, `⚠️ *ATENÇÃO*: Cliente *${nomeCliente}* (${user.split('@')[0]}) pediu atendimento humano.`);
                    uState.stage = 'MENU';
                } else {
                    await enviarMensagem(await getMsgConfig('msg_erro_opcao_invalida'));
                }
                return;
            }

            if (uState.stage === 'CONSULTANDO_OS') {
                const osId = parseInt(texto.replace(/\D/g, ''));
                if (!osId || isNaN(osId)) {
                    await enviarMensagem(await getMsgConfig('msg_erro_formato_os'));
                    return;
                }
                const os = await dbGet("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
                if (!os) {
                    await enviarMensagem(await getMsgConfig('msg_erro_os_nao_encontrada', { os_id: osId }));
                } else {
                    const statusHuman = os.status === 'recebido' ? '🟡 Na fila (Recebido)' : os.status === 'em_andamento' ? '🔨 Em Manutenção (Bancada)' : '✅ Concluído (Pronto para retirada)';
                    await enviarMensagem(await getMsgConfig('msg_os_status', { os_id: os.id, equipamento: os.equipamento, status: statusHuman }));
                    uState.stage = 'MENU';
                }
                return;
            }
        } catch (e) {
            log('BOT', `Erro no handler de mensagem: ${e.message}`);
        }
    });

    try {
        console.log('[WHATSAPP] Iniciando inicialização do client...');
        await client.initialize();
    } catch (e) {
        console.error('Erro crítico ao iniciar WhatsApp:', e);
        notificarUI('bot', 'ERRO FATAL: Falha ao iniciar robô.');
    }

    // 🧹 GARBAGE COLLECTOR: Limpeza de Sessões Ociosas
    setInterval(() => {
        const agora = Date.now();
        let removidos = 0;
        for (const userId in userStages) {
            if (userStages[userId].ultimaInteracao && (agora - userStages[userId].ultimaInteracao) > TIMEOUT_INATIVIDADE_MS) {
                delete userStages[userId];
                removidos++;
            }
        }
        if (removidos > 0) log('LIMPEZA', `${removidos} sessão(ões) ociosa(s) apagada(s) da memória RAM`);
    }, 15 * 60 * 1000); // Roda a cada 15 min

};
