const express = require('express');
const cors = require('cors');
const path = require('path');

// =========================================================================
// CLASSE: ApiServer
// Responsável por configurar o Express e registrar todas as rotas da API REST.
// =========================================================================
class ApiServer {
    /**
     * @param {import('./Database')} db - Instância do Database
     * @param {import('./Logger')} logger - Instância do Logger
     * @param {Function} notificarUI - Callback para notificar a UI do Electron
     */
    constructor(db, logger, notificarUI) {
        this._db = db;
        this._logger = logger;
        this._notificarUI = notificarUI;
        this._bot = null;
        this._userStages = {};

        this._app = express();
        this._app.use(express.json());
        this._app.use(express.static(path.join(__dirname, '..', 'public')));
        this._app.use(cors());

        this._registrarRotasOS();
        this._registrarRotasTecnicos();
        this._registrarRotasFinanceiro();
        this._registrarRotasConfiguracoes();
    }

    /**
     * Injeta o bot WhatsApp (injeção tardia, pois o bot inicia depois do servidor).
     * @param {import('./WhatsAppBot')} bot - Instância do WhatsAppBot
     */
    setWhatsAppBot(bot) {
        this._bot = bot;
    }

    /**
     * Referência ao mapa de estágios de conversa dos usuários (compartilhado com o Bot).
     * @returns {Object}
     */
    getUserStages() {
        return this._userStages;
    }

    /**
     * Inicia o servidor Express na porta especificada.
     * @param {number} porta - Porta para escutar
     */
    iniciar(porta) {
        this._app.listen(porta, () => {
            console.log(`[EXPRESS] Servidor rodando na porta ${porta}`);
            this._notificarUI('express', `Rodando (Porta ${porta})`);
        });
    }

    // =====================================================================
    // ENVIO DE MENSAGEM WHATSAPP (com filtro anti-spam)
    // =====================================================================

    /**
     * Envia mensagem WhatsApp com filtro anti-spam para contas Business.
     * @param {string} numero - Número do destinatário
     * @param {string} msg - Mensagem a enviar
     */
    async enviarMsgWhatsApp(numero, msg) {
        if (!this._bot || !numero) return;
        const client = this._bot.getClient();
        if (!client) return;

        try {
            const somenteNumeros = numero.replace(/\D/g, '');

            // Resolve o WID correto (evita o erro "No LID for user")
            const wid = await client.getNumberId(somenteNumeros);
            if (!wid) {
                this._logger.log('API', `Número ${somenteNumeros} não encontrado no WhatsApp.`);
                return;
            }

            // === FILTRO ANTI-SPAM PARA CONTAS BUSINESS ===
            try {
                const contact = await client.getContactById(wid._serialized);
                const jaMessagou = this._bot.contatoJaMessagou(wid._serialized);

                if (contact && contact.isBusiness && !jaMessagou) {
                    this._logger.log('API', `[BLOQUEADO] Business ${somenteNumeros} não iniciou conversa. Notificação cancelada.`);
                    return;
                }
            } catch (contactErr) {
                this._logger.log('API', `Aviso: não foi possível verificar tipo do contato ${somenteNumeros}.`);
            }

            await client.sendMessage(wid._serialized, msg);
            this._logger.log('API', `Mensagem enviada com sucesso para ${somenteNumeros}`);

            // Estado proativo: evita loops caso o cliente agradeça
            this._userStages[wid._serialized] = { stage: 'RECEM_NOTIFICADO', ultimaInteracao: Date.now() };
        } catch (e) {
            this._logger.log('API', 'Erro ao enviar ZAP: ' + e.message);
        }
    }

    // =====================================================================
    // ROTAS: ORDENS DE SERVIÇO
    // =====================================================================

    _registrarRotasOS() {
        const app = this._app;
        const db = this._db;

        // Listar todas as OS
        app.get('/api/os', async (req, res) => {
            const ordens = await db.all('SELECT * FROM ordens_servico ORDER BY id DESC');
            res.json(ordens);
        });

        // Criar nova OS
        app.post('/api/os', async (req, res) => {
            const { cliente_nome, cliente_telefone, equipamento, problema, categoria } = req.body;
            const hoje = new Date().toISOString();
            const nextId = await db.getNextId('ordens_servico');
            await db.run(
                "INSERT INTO ordens_servico (id, cliente_nome, cliente_telefone, equipamento, categoria, problema, status, data_criacao) VALUES (?, ?, ?, ?, ?, ?, 'recebido', ?)",
                [nextId, cliente_nome, cliente_telefone, equipamento, categoria || 'outros', problema, hoje]
            );
            res.json({ success: true });
        });

        // Avançar status da OS (Bancada)
        app.post('/api/os/:id/status', async (req, res) => {
            const osId = parseInt(req.params.id);
            const { status, tecnico_id } = req.body;
            await db.run("UPDATE ordens_servico SET status = ?, tecnico_id = ? WHERE id = ?", [status, tecnico_id, osId]);

            if (status === 'em_andamento') {
                const os = await db.get("SELECT * FROM ordens_servico WHERE id = ?", [osId]);
                if (os && os.cliente_telefone) {
                    const podeNotif = this._bot ? this._bot.podeNotificar(osId, 'bancada') : true;
                    if (podeNotif) {
                        let msgBancada = await db.get("SELECT valor FROM configuracoes WHERE chave = 'msg_bancada'");
                        if (msgBancada) {
                            const msgFormatada = msgBancada.valor
                                .replace(/{equipamento}/g, os.equipamento)
                                .replace(/{os_id}/g, osId)
                                .replace(/{nome}/g, os.cliente_nome || 'Cliente');
                            await this.enviarMsgWhatsApp(os.cliente_telefone, msgFormatada);
                            this._logger.log('API', `Notificação de bancada enviada para OS #${osId}`);
                        }
                    } else {
                        this._logger.log('API', `Notificação de bancada OS #${osId} ignorada (cooldown).`);
                    }
                }
            }

            res.json({ success: true });
        });

        // Concluir e Faturar OS
        app.post('/api/os/:id/concluir', async (req, res) => {
            const osId = parseInt(req.params.id);
            const { tecnico_id, valor, solucao, gerar_financeiro } = req.body;
            const hoje = new Date().toISOString();

            await db.run("UPDATE ordens_servico SET status = 'concluido', solucao = ?, tecnico_id = ?, valor = ? WHERE id = ?", [solucao, tecnico_id, valor, osId]);

            const os = await db.get("SELECT * FROM ordens_servico WHERE id = ?", [osId]);

            if (gerar_financeiro) {
                const transId = await db.getNextId('transacoes');
                await db.run("INSERT INTO transacoes (id, os_id, tipo, valor, data, descricao) VALUES (?, ?, 'receita', ?, ?, ?)",
                    [transId, osId, parseFloat(valor), hoje, `OS #${osId} - ${os.equipamento}`]);

                // Gerar despesa de comissão
                const tecnico = await db.get("SELECT comissao, nome FROM tecnicos WHERE id = ?", [tecnico_id]);
                if (tecnico && tecnico.comissao > 0) {
                    const despId = await db.getNextId('transacoes');
                    const valorComissao = parseFloat(valor) * (tecnico.comissao / 100);
                    await db.run("INSERT INTO transacoes (id, os_id, tipo, valor, data, descricao) VALUES (?, ?, 'despesa', ?, ?, ?)",
                        [despId, osId, valorComissao, hoje, `Comissão OS #${osId} - Tec: ${tecnico.nome}`]);
                }
            }

            if (os.cliente_telefone) {
                const podeNotif = this._bot ? this._bot.podeNotificar(osId, 'concluido') : true;
                if (podeNotif) {
                    let msgPronta = await db.get("SELECT valor FROM configuracoes WHERE chave = 'msg_os_pronta'");
                    if (msgPronta) {
                        const msgFormatada = msgPronta.valor
                            .replace(/{equipamento}/g, os.equipamento)
                            .replace(/{valor}/g, valor)
                            .replace(/{os_id}/g, osId)
                            .replace(/{nome}/g, os.cliente_nome || 'Cliente');
                        await this.enviarMsgWhatsApp(os.cliente_telefone, msgFormatada);
                        this._logger.log('API', `Notificação de OS concluída enviada para OS #${osId}`);
                    }
                } else {
                    this._logger.log('API', `Notificação de OS concluída OS #${osId} ignorada (cooldown).`);
                }
            }

            res.json({ success: true });
        });

        // Excluir OS
        app.delete('/api/os/:id', async (req, res) => {
            await db.run("DELETE FROM ordens_servico WHERE id = ?", [parseInt(req.params.id)]);
            res.json({ success: true });
        });
    }

    // =====================================================================
    // ROTAS: TÉCNICOS
    // =====================================================================

    _registrarRotasTecnicos() {
        const app = this._app;
        const db = this._db;

        app.get('/api/tecnicos', async (req, res) => {
            res.json(await db.all("SELECT * FROM tecnicos"));
        });

        app.get('/api/tecnicos/comissoes', async (req, res) => {
            const { mes, ano } = req.query;
            const dataAtual = new Date();
            const mm = mes ? parseInt(mes) : dataAtual.getMonth() + 1;
            const yyyy = ano ? parseInt(ano) : dataAtual.getFullYear();
            const mmStr = mm.toString().padStart(2, '0');
            const prefixoData = `${yyyy}-${mmStr}-`;

            const query = `
                SELECT t.id, t.nome, t.comissao,
                    COUNT(os.id) as total_os,
                    SUM(os.valor) as faturamento_gerado,
                    SUM(os.valor - IFNULL(exp.total_despesas, 0)) as faturamento_liquido,
                    SUM((os.valor - IFNULL(exp.total_despesas, 0)) * (t.comissao / 100.0)) as valor_receber
                FROM tecnicos t
                LEFT JOIN ordens_servico os ON os.tecnico_id = t.id AND os.status = 'concluido' AND os.data_criacao LIKE ?
                LEFT JOIN (
                    SELECT os_id, SUM(valor) AS total_despesas
                    FROM transacoes
                    WHERE tipo = 'despesa'
                    GROUP BY os_id
                ) exp ON exp.os_id = os.id
                GROUP BY t.id, t.nome, t.comissao;
            `;
            const resultados = await db.all(query, [`${prefixoData}%`]);
            res.json(resultados);
        });

        app.post('/api/tecnicos', async (req, res) => {
            const nextId = await db.getNextId('tecnicos');
            await db.run("INSERT INTO tecnicos (id, nome, comissao) VALUES (?, ?, ?)", [nextId, req.body.nome, req.body.comissao]);
            res.json({ success: true });
        });

        app.delete('/api/tecnicos/:id', async (req, res) => {
            await db.run("DELETE FROM tecnicos WHERE id = ?", [parseInt(req.params.id)]);
            res.json({ success: true });
        });
    }

    // =====================================================================
    // ROTAS: FINANCEIRO
    // =====================================================================

    _registrarRotasFinanceiro() {
        const app = this._app;
        const db = this._db;

        app.get('/api/financeiro/dashboard', async (req, res) => {
            const { mes, ano } = req.query;
            let prefixoData;
            if (mes && ano) {
                const mmStr = parseInt(mes).toString().padStart(2, '0');
                prefixoData = `${parseInt(ano)}-${mmStr}-`;
            } else {
                const hoje = new Date();
                const mmStr = (hoje.getMonth() + 1).toString().padStart(2, '0');
                prefixoData = `${hoje.getFullYear()}-${mmStr}-`;
            }
            const query = "SELECT * FROM transacoes WHERE data LIKE ? ORDER BY id DESC";
            res.json(await db.all(query, [`${prefixoData}%`]));
        });

        app.post('/api/despesas', async (req, res) => {
            const { descricao, valor, data } = req.body;
            const nextId = await db.getNextId('transacoes');
            const dataTransacao = data ? (data.includes('T') ? data : new Date(data).toISOString()) : new Date().toISOString();
            await db.run("INSERT INTO transacoes (id, tipo, valor, data, descricao) VALUES (?, 'despesa', ?, ?, ?)",
                [nextId, valor, dataTransacao, descricao]);
            res.json({ success: true });
        });

        app.post('/api/receitas', async (req, res) => {
            const { descricao, valor, data } = req.body;
            const nextId = await db.getNextId('transacoes');
            const dataTransacao = data ? (data.includes('T') ? data : new Date(data).toISOString()) : new Date().toISOString();
            await db.run("INSERT INTO transacoes (id, tipo, valor, data, descricao) VALUES (?, 'receita', ?, ?, ?)",
                [nextId, valor, dataTransacao, descricao]);
            res.json({ success: true });
        });

        app.delete('/api/transacoes/:id', async (req, res) => {
            await db.run("DELETE FROM transacoes WHERE id = ?", [parseInt(req.params.id)]);
            res.json({ success: true });
        });
    }

    // =====================================================================
    // ROTAS: CONFIGURAÇÕES
    // =====================================================================

    _registrarRotasConfiguracoes() {
        const app = this._app;
        const db = this._db;

        // GET: retorna TODAS as configurações como objeto {chave: valor}
        app.get('/api/configuracoes', async (req, res) => {
            const rows = await db.all("SELECT chave, valor FROM configuracoes");
            const config = {};
            rows.forEach(r => { config[r.chave] = r.valor; });
            res.json(config);
        });

        // POST: recebe objeto {chave: valor, chave2: valor2, ...} e atualiza em lote
        app.post('/api/configuracoes', async (req, res) => {
            const updates = req.body;
            for (const [chave, valor] of Object.entries(updates)) {
                const existe = await db.get('SELECT id FROM configuracoes WHERE chave = ?', [chave]);
                if (existe) {
                    await db.run('UPDATE configuracoes SET valor = ? WHERE chave = ?', [valor, chave]);
                } else {
                    const nextId = await db.getNextId('configuracoes');
                    await db.run('INSERT INTO configuracoes (id, chave, valor) VALUES (?, ?, ?)', [nextId, chave, valor]);
                }
            }
            res.json({ success: true });
        });

        // Mantém rota legada de nome para não quebrar nada
        app.get('/api/configuracoes/nome', async (req, res) => {
            res.json({ nome: (await db.get("SELECT valor FROM configuracoes WHERE chave = 'nome_negocio'"))?.valor || '' });
        });
    }
}

module.exports = ApiServer;
