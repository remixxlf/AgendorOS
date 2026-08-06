const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { execSync } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');

const TIMEOUT_INATIVIDADE_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 10000;

// =========================================================================
// CLASSE: WhatsAppBot
// Responsável por toda a lógica do bot WhatsApp: conexão, QR, anti-spam,
// máquina de estados do menu e garbage collector de sessões.
// =========================================================================
class WhatsAppBot {
    /**
     * @param {string} appDataPath - Caminho do diretório de dados da aplicação
     * @param {import('./Database')} db - Instância do Database
     * @param {import('./Logger')} logger - Instância do Logger
     * @param {Function} notificarUI - Callback para notificar a UI do Electron
     * @param {Electron.BrowserWindow} mainWindow - Janela principal do Electron
     * @param {Object} userStages - Mapa de estágios de conversa (compartilhado com ApiServer)
     */
    constructor(appDataPath, db, logger, notificarUI, mainWindow, userStages) {
        this._appDataPath = appDataPath;
        this._db = db;
        this._logger = logger;
        this._notificarUI = notificarUI;
        this._mainWindow = mainWindow;
        this._userStages = userStages;

        this._client = null;
        this._botIsReady = false;
        this._botReadyTimestamp = null;
        this._contatosQueMessagaram = new Set();
        this._notificacaoCooldown = new Map();
        this._numeroDono = null;
    }

    /**
     * Retorna o client do whatsapp-web.js.
     * @returns {Client|null}
     */
    getClient() {
        return this._client;
    }

    /**
     * Verifica se o contato já enviou mensagem anteriormente (filtro anti-spam).
     * @param {string} serialized - ID serializado do contato
     * @returns {boolean}
     */
    contatoJaMessagou(serialized) {
        return this._contatosQueMessagaram.has(serialized);
    }

    /**
     * Cooldown de notificações por OS para evitar envios duplicados.
     * @param {number} osId - ID da Ordem de Serviço
     * @param {string} tipo - Tipo de notificação (ex: 'bancada', 'concluido')
     * @returns {boolean} true se pode notificar
     */
    podeNotificar(osId, tipo) {
        const chave = `${osId}_${tipo}`;
        const ultimo = this._notificacaoCooldown.get(chave) || 0;
        if (Date.now() - ultimo < COOLDOWN_MS) return false;
        this._notificacaoCooldown.set(chave, Date.now());
        return true;
    }

    // =====================================================================
    // INICIALIZAÇÃO
    // =====================================================================

    /**
     * Inicializa o bot: detecta Chrome, cria o client, registra eventos e conecta.
     */
    async inicializar() {
        this._numeroDono = await this._db.getNumeroDono();

        const chromePath = this._encontrarChrome();
        if (!chromePath) {
            this._notificarUI('bot', 'ERRO: Chrome não encontrado!');
            return;
        }

        this._client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'gestor-os-bot',
                dataPath: path.join(this._appDataPath, 'whatsapp_os_session')
            }),
            puppeteer: {
                headless: true,
                executablePath: chromePath,
                protocolTimeout: 60000,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            }
        });

        this._registrarEventos();
        this._iniciarGarbageCollector();

        try {
            console.log('[WHATSAPP] Iniciando inicialização do client...');
            await this._client.initialize();
        } catch (e) {
            this._logger.logErro('WHATSAPP_INIT', e);
            this._notificarUI('bot', 'ERRO FATAL: Falha ao iniciar robô.');
        }
    }

    // =====================================================================
    // DETECÇÃO DO CHROME
    // =====================================================================

    _encontrarChrome() {
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

    // =====================================================================
    // EVENTOS DO CLIENT (QR, Ready, Disconnected, Message)
    // =====================================================================

    _registrarEventos() {
        const client = this._client;

        // Timeout de autenticação
        let authTimeoutLimpar = setTimeout(async () => {
            this._notificarUI('bot', 'Erro: Sessão corrompida. Limpando dados...');
            try { await client.destroy(); } catch (e) {}
        }, 45000);

        client.on('qr', async (qr) => {
            clearTimeout(authTimeoutLimpar);
            this._botIsReady = false;
            try {
                const qrBase64 = await qrcode.toDataURL(qr);
                if (this._mainWindow) {
                    this._mainWindow.webContents.send('qr-code', qrBase64);
                    this._notificarUI('bot', 'Aguardando leitura do QR Code...');
                }
            } catch (e) { console.error(e); }
        });

        client.on('ready', async () => {
            clearTimeout(authTimeoutLimpar);
            if (this._botIsReady) {
                this._logger.log('BOT', 'Evento ready duplicado ignorado.');
                return;
            }
            this._botIsReady = true;
            this._botReadyTimestamp = Date.now();
            this._logger.log('BOT', 'Robô ONLINE!');
            this._notificarUI('bot', 'ONLINE! Pronto para atender.');
        });

        client.on('disconnected', async () => {
            this._botIsReady = false;
            this._notificarUI('bot', `Desconectado.`);
            try { await client.destroy(); } catch (e) {}
        });

        client.on('message', (message) => this._handleMessage(message));
    }

    // =====================================================================
    // MÁQUINA DE ESTADOS (Handler de Mensagens)
    // =====================================================================

    async _handleMessage(message) {
        try {
            // Filtros de Bloqueio (Gatekeepers)
            if (message.from === 'status@broadcast' || message.from.includes('@g.us')) return;
            if (message.fromMe) return;

            const contatosIgnorados = [];
            if (contatosIgnorados.includes(message.from)) return;

            // Filtro de Timestamp (evita Ghost Replies no Startup)
            const msgTimestamp = (message.timestamp || 0) * 1000;
            if (this._botReadyTimestamp && msgTimestamp < this._botReadyTimestamp) {
                this._logger.log('BOT', `Ignorando mensagem antiga/fantasma de ${message.from}`);
                return;
            }

            // Registra que esse número nos enviou mensagem
            this._contatosQueMessagaram.add(message.from);

            const contact = await message.getContact();
            const texto = (message.body || '').toLowerCase().trim();
            const nomeCliente = contact.pushname || contact.name || 'Cliente';
            const user = message.from;
            const client = this._client;
            const db = this._db;

            const enviarMensagem = async (msg) => {
                try { await client.sendMessage(user, msg); } catch (e) {
                    this._logger.log('BOT', `Erro ao responder ${user}: ${e.message}`);
                }
            };

            let uState = this._getUserStage(user);
            if (Date.now() - uState.ultimaInteracao > TIMEOUT_INATIVIDADE_MS) uState.stage = 'MENU';
            uState.ultimaInteracao = Date.now();

            // Controle de Mensagens Proativas
            if (uState.stage === 'RECEM_NOTIFICADO') {
                const respostasCurtas = ['ok', 'obrigado', 'obrigada', 'valeu', 'show', 'beleza', 'joia', 'blz', 'vlw', 'ta bom', 'tá bom', 'certo', '👍', '🙏', 'top', 'blza', 'ok!'];

                if (texto.length <= 40 && respostasCurtas.some(palavra => texto.includes(palavra))) {
                    this._logger.log('BOT', `Mensagem curta absorvida silenciosamente de ${user}`);
                    uState.stage = 'IDLE';
                    return;
                } else if (texto === 'menu' || texto === 'sair' || texto === 'cancelar') {
                    uState.stage = 'MENU';
                } else {
                    uState.stage = 'MENU';
                }
            } else if (texto === 'menu' || texto === 'sair' || texto === 'cancelar') {
                uState.stage = 'MENU';
            }

            // Estado: MENU
            if (uState.stage === 'MENU') {
                const nomeNegocio = await db.getConfig('nome_negocio') || 'Assistência';
                const saudacao = await db.getMsgConfig('msg_saudacao', { nome: nomeCliente });
                const menuOpcoes = await db.getMsgConfig('msg_menu_opcoes');
                await enviarMensagem(`⚙️ *${nomeNegocio.toUpperCase()}* ⚙️\n\n${saudacao}\n\n${menuOpcoes}`);
                uState.stage = 'AGUARDANDO_OPCAO';
                return;
            }

            // Estado: AGUARDANDO_OPCAO
            if (uState.stage === 'AGUARDANDO_OPCAO') {
                if (texto === '1') {
                    await enviarMensagem(await db.getMsgConfig('msg_pedir_os'));
                    uState.stage = 'CONSULTANDO_OS';
                } else if (texto === '2') {
                    await enviarMensagem(await db.getMsgConfig('msg_atendente'));
                    if (this._numeroDono) await client.sendMessage(this._numeroDono, `⚠️ *ATENÇÃO*: Cliente *${nomeCliente}* (${user.split('@')[0]}) pediu atendimento humano.`);
                    uState.stage = 'MENU';
                } else {
                    await enviarMensagem(await db.getMsgConfig('msg_erro_opcao_invalida'));
                }
                return;
            }

            // Estado: CONSULTANDO_OS
            if (uState.stage === 'CONSULTANDO_OS') {
                const osId = parseInt(texto.replace(/\D/g, ''));
                if (!osId || isNaN(osId)) {
                    await enviarMensagem(await db.getMsgConfig('msg_erro_formato_os'));
                    return;
                }
                const os = await db.get("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
                if (!os) {
                    await enviarMensagem(await db.getMsgConfig('msg_erro_os_nao_encontrada', { os_id: osId }));
                } else {
                    const statusHuman = os.status === 'recebido' ? '🟡 Na fila (Recebido)' : os.status === 'em_andamento' ? '🔨 Em Manutenção (Bancada)' : '✅ Concluído (Pronto para retirada)';
                    let resp = await db.getMsgConfig('msg_os_status', { os_id: os.id, equipamento: os.equipamento, status: statusHuman });
                    const urlTunnel = await db.getTunnelUrl();
                    if (urlTunnel) {
                        resp += `\n\n🌐 *Acompanhe em tempo real e veja seu recibo aqui:*\n${urlTunnel}/publico/os/${os.id}`;
                    }
                    await enviarMensagem(resp);
                    uState.stage = 'MENU';
                }
                return;
            }
        } catch (e) {
            this._logger.log('BOT', `Erro no handler de mensagem: ${e.message}`);
        }
    }

    _getUserStage(user) {
        if (!this._userStages[user]) {
            this._userStages[user] = { stage: 'MENU', ultimaInteracao: Date.now() };
        }
        return this._userStages[user];
    }

    // =====================================================================
    // DISPARO PROATIVO DE MENSAGENS (Notificações)
    // =====================================================================

    async enviarNotificacaoOS(telefone, osId, tipo) {
        if (!this._botIsReady || !this._client) return;
        try {
            // Formatar telefone para o padrão WhatsApp BR
            let numero = telefone.replace(/\D/g, '');
            if (!numero) return;
            if (!numero.startsWith('55')) numero = `55${numero}`;
            if (numero.length === 12) numero = `${numero.substring(0, 4)}9${numero.substring(4)}`; // adiciona o 9

            const wid = `${numero}@c.us`;
            
            const os = await this._db.get("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
            if (!os) return;

            let msg = '';
            if (tipo === 'criada') {
                msg = `Olá ${os.cliente_nome}! Sua Ordem de Serviço *#${os.id}* (${os.equipamento}) foi registrada na nossa assistência. 🛠️`;
            } else if (tipo === 'em_andamento') {
                msg = `Boas notícias, ${os.cliente_nome}! Seu aparelho *#${os.id}* acabou de ir para a bancada e está em manutenção. 🔨`;
            } else if (tipo === 'concluido') {
                msg = `Olá ${os.cliente_nome}! O serviço no seu aparelho *#${os.id}* foi concluído! ✅ Já pode vir retirar.`;
            }

            const urlTunnel = await this._db.getTunnelUrl();
            if (urlTunnel) {
                msg += `\n\n🌐 *Acompanhe os detalhes em tempo real:*\n${urlTunnel}/publico/os/${os.id}`;
            }

            await this._client.sendMessage(wid, msg);
            this._logger.log('BOT', `Notificação '${tipo}' enviada ativamente para ${wid}`);
            
            // Coloca o cliente no estado 'RECEM_NOTIFICADO' para evitar que o bot mostre o menu se ele só mandar "ok"
            if (!this._userStages[wid]) this._userStages[wid] = { stage: 'RECEM_NOTIFICADO', ultimaInteracao: Date.now() };
            else {
                this._userStages[wid].stage = 'RECEM_NOTIFICADO';
                this._userStages[wid].ultimaInteracao = Date.now();
            }

        } catch (e) {
            this._logger.logErro('BOT', e);
        }
    }

    // =====================================================================
    // GARBAGE COLLECTOR DE SESSÕES OCIOSAS
    // =====================================================================

    _iniciarGarbageCollector() {
        setInterval(() => {
            const agora = Date.now();
            let removidos = 0;
            for (const userId in this._userStages) {
                if (this._userStages[userId].ultimaInteracao && (agora - this._userStages[userId].ultimaInteracao) > TIMEOUT_INATIVIDADE_MS) {
                    delete this._userStages[userId];
                    removidos++;
                }
            }
            if (removidos > 0) this._logger.log('LIMPEZA', `${removidos} sessão(ões) ociosa(s) apagada(s) da memória RAM`);
        }, 15 * 60 * 1000);
    }
}

module.exports = WhatsAppBot;
