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
        this._registrarRotasEstoque();
        this._registrarRotasPDV();
        this._registrarRotasPublicas();
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
     * @param {number} [osId] - ID da OS para gerar o link (opcional)
     */
    async enviarMsgWhatsApp(numero, msg, osId = null) {
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

            // Se foi passado um osId, anexa o link público
            if (osId) {
                const urlTunnel = await this._db.getTunnelUrl();
                if (urlTunnel) {
                    msg += `\n\n🌐 *Acompanhe em tempo real e veja seu recibo aqui:*\n${urlTunnel}/publico/os/${osId}`;
                }
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

        // Listar OS filtradas por mês/ano
        app.get('/api/os', async (req, res) => {
            const { mes, ano } = req.query;
            let ordens;
            if (mes && ano) {
                const prefixo = `${parseInt(ano)}-${parseInt(mes).toString().padStart(2, '0')}-`;
                // OS abertas aparecem sempre (independente do mês), concluídas só do mês selecionado
                ordens = await db.all(
                    `SELECT * FROM ordens_servico
                     WHERE status IN ('recebido', 'em_andamento')
                        OR (status = 'concluido' AND data_criacao LIKE ?)
                     ORDER BY id DESC`,
                    [`${prefixo}%`]
                );
            } else {
                ordens = await db.all('SELECT * FROM ordens_servico ORDER BY id DESC');
            }
            res.json(ordens);
        });

        // Criar nova OS
        app.post('/api/os', async (req, res) => {
            const { cliente_nome, cliente_telefone, equipamento, problema, categoria, checklist } = req.body;
            const hoje = new Date().toISOString();
            const nextId = await db.getNextId('ordens_servico');
            await db.run(
                "INSERT INTO ordens_servico (id, cliente_nome, cliente_telefone, equipamento, categoria, problema, status, data_criacao, checklist) VALUES (?, ?, ?, ?, ?, ?, 'recebido', ?, ?)",
                [nextId, cliente_nome, cliente_telefone, equipamento, categoria || 'outros', problema, hoje, JSON.stringify(checklist || {})]
            );

            // Notificação proativa de criação
            if (cliente_telefone) {
                const msgCriada = `Olá ${cliente_nome}! Sua Ordem de Serviço *#${nextId}* (${equipamento}) foi registrada na nossa assistência. 🛠️`;
                await this.enviarMsgWhatsApp(cliente_telefone, msgCriada, nextId);
            }

            res.json({ success: true, id: nextId });
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
                            await this.enviarMsgWhatsApp(os.cliente_telefone, msgFormatada, osId);
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
                        await this.enviarMsgWhatsApp(os.cliente_telefone, msgFormatada, osId);
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

    // =====================================================================
    // ROTAS: ESTOQUE DE PRODUTOS
    // =====================================================================

    _registrarRotasEstoque() {
        const app = this._app;
        const db = this._db;

        // Listar todos os produtos
        app.get('/api/produtos', async (req, res) => {
            res.json(await db.getAllProdutos());
        });

        // Criar produto
        app.post('/api/produtos', async (req, res) => {
            try {
                const id = await db.createProduto(req.body);
                res.json({ success: true, id });
            } catch (e) {
                res.status(400).json({ success: false, error: e.message });
            }
        });

        // Atualizar produto
        app.put('/api/produtos/:id', async (req, res) => {
            try {
                await db.updateProduto(parseInt(req.params.id), req.body);
                res.json({ success: true });
            } catch (e) {
                res.status(400).json({ success: false, error: e.message });
            }
        });

        // Excluir produto
        app.delete('/api/produtos/:id', async (req, res) => {
            await db.deleteProduto(parseInt(req.params.id));
            res.json({ success: true });
        });

        // Buscar peças usadas numa OS
        app.get('/api/os/:id/produtos', async (req, res) => {
            res.json(await db.getProdutosOS(parseInt(req.params.id)));
        });

        // Associar peça usada a uma OS
        app.post('/api/os/:id/produtos', async (req, res) => {
            try {
                const { produto_id, quantidade } = req.body;
                await db.addProdutoOS(parseInt(req.params.id), produto_id, quantidade || 1);
                res.json({ success: true });
            } catch (e) {
                res.status(400).json({ success: false, error: e.message });
            }
        });

        // Recibo de OS — retorna HTML para impressão
        app.get('/api/os/:id/recibo', async (req, res) => {
            try {
                const osId = parseInt(req.params.id);
                const os = await db.get('SELECT * FROM ordens_servico WHERE id = ?', [osId]);
                if (!os) return res.status(404).send('OS não encontrada');

                const nomeLoja = await db.getConfig('nome_negocio') || 'Assistência Técnica';
                const pecas = await db.getProdutosOS(osId);
                const custoPecas = await db.getCustoTotalOS(osId);

                const statusHuman = {
                    recebido: 'Em Aberto / Aguardando Análise',
                    em_andamento: 'Na Bancada — Em Manutenção',
                    concluido: 'Concluído — Pronto para Retirada'
                }[os.status] || os.status;

                const pecasHtml = pecas.length > 0
                    ? `<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
                        <thead><tr style="background:#f5f5f5">
                            <th style="text-align:left;padding:6px 8px;border:1px solid #ddd">Peça / Material</th>
                            <th style="text-align:center;padding:6px 8px;border:1px solid #ddd">Qtd</th>
                            <th style="text-align:right;padding:6px 8px;border:1px solid #ddd">Vlr. Unit.</th>
                            <th style="text-align:right;padding:6px 8px;border:1px solid #ddd">Total</th>
                        </tr></thead>
                        <tbody>${pecas.map(p => `<tr>
                            <td style="padding:6px 8px;border:1px solid #ddd">${p.nome}</td>
                            <td style="text-align:center;padding:6px 8px;border:1px solid #ddd">${p.quantidade}</td>
                            <td style="text-align:right;padding:6px 8px;border:1px solid #ddd">R$ ${Number(p.preco_venda_aplicado).toFixed(2)}</td>
                            <td style="text-align:right;padding:6px 8px;border:1px solid #ddd">R$ ${(p.quantidade * p.preco_venda_aplicado).toFixed(2)}</td>
                        </tr>`).join('')}</tbody>
                      </table>`
                    : '<p style="color:#888;font-size:13px">Nenhuma peça registrada.</p>';

                const dataFormatada = os.data_criacao
                    ? new Date(os.data_criacao).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—';

                let checklistItems = [];
                try {
                    const chk = typeof os.checklist === 'string' ? JSON.parse(os.checklist || '[]') : (os.checklist || []);
                    if (Array.isArray(chk)) {
                        checklistItems = chk;
                    } else if (typeof chk === 'object' && chk !== null) {
                        const labels = {
                            tela_trincada: '🖥️ Tela Trincada',
                            camera_defeito: '📷 Câmera com defeito',
                            botoes_danificados: '🔘 Botões danificados',
                            carcaca_amassada: '💥 Carcaça amassada',
                            conector_danificado: '🔌 Conector danificado',
                            alto_falante_defeito: '🔊 Alto-falante com defeito'
                        };
                        for (const [k, v] of Object.entries(chk)) {
                            if (v) checklistItems.push(labels[k] || k);
                        }
                    }
                } catch(e) {}

                const checklistHtml = checklistItems.length > 0
                    ? `<div class="box" style="background:#fff8e1;border-color:#ffe082"><strong style="color:#b78103">Avarias Constatadas na Entrada:</strong><br>${checklistItems.join(' • ')}</div>`
                    : '<div class="box" style="color:#666">Nenhuma avaria prévia apontada na entrada.</div>';

                const html = `<!DOCTYPE html><html lang="pt-BR"><head>
                <meta charset="UTF-8"><title>Recibo OS #${osId}</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body { font-family: Arial, sans-serif; color: #111; background: #fff; padding: 32px; max-width: 780px; margin: auto; }
                    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 24px; }
                    .logo { font-size: 22px; font-weight: bold; }
                    .logo small { display: block; font-size: 12px; font-weight: normal; color: #666; margin-top: 4px; }
                    .os-num { text-align: right; }
                    .os-num strong { font-size: 22px; }
                    .os-num small { display: block; font-size: 12px; color: #666; }
                    .section { margin-bottom: 22px; }
                    .section-title { font-weight: bold; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #444; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 12px; }
                    .row { display: flex; gap: 24px; margin-bottom: 10px; flex-wrap: wrap; }
                    .field { flex: 1; min-width: 180px; }
                    .field label { display: block; font-size: 11px; color: #777; text-transform: uppercase; margin-bottom: 3px; }
                    .field span { font-weight: bold; font-size: 14px; }
                    .box { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 12px; font-size: 13px; line-height: 1.5; }
                    .status-badge { display: inline-block; background: #111; color: #fff; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
                    .valor-destaque { font-size: 28px; font-weight: bold; color: #111; }
                    .footer { margin-top: 48px; display: flex; justify-content: space-between; }
                    .assinatura { text-align: center; width: 240px; }
                    .assinatura-linha { border-bottom: 1px solid #111; margin-bottom: 8px; height: 48px; }
                    @media print { @page { margin: 1.5cm; } body { padding: 0; } }
                </style>
                <script>window.onload = () => window.print();</script>
                </head><body>
                <div class="header">
                    <div class="logo">${nomeLoja}<small>Ordem de Serviço — Recibo</small></div>
                    <div class="os-num"><small>Nº da OS</small><strong>#${osId.toString().padStart(4, '0')}</strong><small>${dataFormatada}</small></div>
                </div>
                <div class="section">
                    <div class="section-title">Dados do Cliente</div>
                    <div class="row">
                        <div class="field"><label>Nome</label><span>${os.cliente_nome || '—'}</span></div>
                        <div class="field"><label>WhatsApp</label><span>${os.cliente_telefone || '—'}</span></div>
                    </div>
                </div>
                <div class="section">
                    <div class="section-title">Equipamento</div>
                    <div class="row">
                        <div class="field"><label>Modelo</label><span>${os.equipamento || '—'}</span></div>
                        <div class="field"><label>Categoria</label><span>${os.categoria || '—'}</span></div>
                        <div class="field"><label>Status Atual</label><span class="status-badge">${statusHuman}</span></div>
                    </div>
                </div>
                <div class="section">
                    <div class="section-title">Inspeção Visual de Entrada (Checklist)</div>
                    ${checklistHtml}
                </div>
                <div class="section">
                    <div class="section-title">Defeito Relatado</div>
                    <div class="box">${os.problema || 'Não informado'}</div>
                </div>
                ${os.solucao ? `<div class="section"><div class="section-title">Solução Aplicada</div><div class="box">${os.solucao}</div></div>` : ''}
                <div class="section">
                    <div class="section-title">Peças e Materiais Utilizados</div>
                    ${pecasHtml}
                </div>
                <div class="section">
                    <div class="section-title">Valor do Serviço</div>
                    <span class="valor-destaque">R$ ${os.valor ? Number(os.valor).toFixed(2) : '0,00'}</span>
                </div>
                <div class="footer">
                    <div class="assinatura"><div class="assinatura-linha"></div><small>Assinatura do Técnico</small></div>
                    <div class="assinatura"><div class="assinatura-linha"></div><small>Assinatura do Cliente</small></div>
                </div>
                </body></html>`;

                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.send(html);
            } catch (e) {
                this._logger.logErro('RECIBO', e);
                res.status(500).send('Erro ao gerar recibo');
            }
        });
    }

    // =====================================================================
    // ROTAS: PDV RÁPIDO (Venda de Balcão)
    // =====================================================================

    _registrarRotasPDV() {
        const app = this._app;
        const db = this._db;

        // Registrar venda de balcão (PDV) com Transação
        app.post('/api/pdv/venda', async (req, res) => {
            const { itens } = req.body;
            if (!itens || !Array.isArray(itens) || itens.length === 0) {
                return res.status(400).json({ success: false, error: 'Carrinho vazio' });
            }

            try {
                await db.beginTransaction();
                
                let totalVenda = 0;
                const hoje = new Date().toISOString();
                const descricoes = [];

                for (const item of itens) {
                    const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
                    if (!produto) throw new Error(`Produto ID ${item.produto_id} não encontrado`);
                    if (produto.quantidade < item.quantidade) throw new Error(`Estoque insuficiente para: ${produto.nome}`);

                    const subtotal = produto.preco_venda * item.quantidade;
                    totalVenda += subtotal;
                    descricoes.push(`${item.quantidade}x ${produto.nome}`);

                    // Baixa no estoque
                    await db.ajustarEstoque(item.produto_id, -item.quantidade);
                }

                // Lança como receita no financeiro
                const transId = await db.getNextId('transacoes');
                await db.run(
                    "INSERT INTO transacoes (id, tipo, valor, data, descricao) VALUES (?, 'receita', ?, ?, ?)",
                    [transId, totalVenda, hoje, `Venda de Balcão: ${descricoes.join(', ')}`]
                );

                await db.commit();
                res.json({ success: true, total: totalVenda });
            } catch (e) {
                await db.rollback();
                this._logger.logErro('PDV', e);
                res.status(400).json({ success: false, error: e.message });
            }
        });
    }

    // =====================================================================
    // ROTAS: PÁGINA PÚBLICA (Consulta de Status sem Login)
    // =====================================================================

    _registrarRotasPublicas() {
        const app = this._app;
        const db = this._db;

        app.get('/publico/os/:id', async (req, res) => {
            try {
                const osId = parseInt(req.params.id);
                const os = await db.get('SELECT id, cliente_nome, equipamento, status, data_criacao FROM ordens_servico WHERE id = ?', [osId]);

                if (!os) {
                    return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OS Não Encontrada</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f4f7fa"><h2 style="color:#e74c3c">❌ OS #${osId} não encontrada</h2><p>Verifique o número e tente novamente.</p></body></html>`);
                }

                const nomeLoja = await db.getConfig('nome_negocio') || 'Assistência Técnica';

                const statusConfig = {
                    recebido:    { emoji: '🟡', texto: 'Aguardando Análise', cor: '#f39c12', desc: 'Seu equipamento foi recebido e está na fila para análise.' },
                    em_andamento:{ emoji: '🔨', texto: 'Em Manutenção', cor: '#3498db', desc: 'Seu equipamento está na bancada sendo reparado pela nossa equipe.' },
                    concluido:   { emoji: '✅', texto: 'Pronto para Retirada!', cor: '#27ae60', desc: 'O reparo foi concluído! Você já pode vir retirar seu equipamento.' }
                }[os.status] || { emoji: '❓', texto: os.status, cor: '#666', desc: '' };

                const dataFormatada = os.data_criacao
                    ? new Date(os.data_criacao).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
                    : '—';

                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Status da OS #${os.id} — ${nomeLoja}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: white; border-radius: 20px; max-width: 420px; width: 100%; padding: 36px 28px; box-shadow: 0 10px 40px rgba(0,0,0,0.08); }
  .loja { font-size: 13px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .os-id { font-size: 28px; font-weight: 800; color: #1a202c; margin-bottom: 24px; }
  .status-badge { display: flex; align-items: center; gap: 12px; background: #f7fafc; border-radius: 14px; padding: 16px 20px; margin-bottom: 20px; border-left: 4px solid ${statusConfig.cor}; }
  .status-emoji { font-size: 32px; }
  .status-texto { font-size: 18px; font-weight: 700; color: ${statusConfig.cor}; }
  .status-desc { font-size: 13px; color: #718096; margin-top: 2px; line-height: 1.4; }
  .info-grid { display: grid; gap: 12px; margin-top: 20px; }
  .info-item label { font-size: 11px; color: #a0aec0; text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 3px; }
  .info-item span { font-size: 15px; font-weight: 600; color: #2d3748; }
  .footer-note { margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0; text-align: center; line-height: 1.5; }
</style>
</head><body>
<div class="card">
  <div class="loja">${nomeLoja}</div>
  <div class="os-id">OS #${os.id.toString().padStart(4, '0')}</div>
  <div class="status-badge">
    <div class="status-emoji">${statusConfig.emoji}</div>
    <div><div class="status-texto">${statusConfig.texto}</div><div class="status-desc">${statusConfig.desc}</div></div>
  </div>
  <div class="info-grid">
    <div class="info-item"><label>Equipamento</label><span>${os.equipamento}</span></div>
    <div class="info-item"><label>Cliente</label><span>${os.cliente_nome}</span></div>
    <div class="info-item"><label>Data de Entrada</label><span>${dataFormatada}</span></div>
  </div>
  <div class="footer-note">Atualizado automaticamente. Em caso de dúvidas, entre em contato com nossa equipe.</div>
</div>
</body></html>`);
            } catch (e) {
                this._logger.logErro('PAGINA_PUBLICA', e);
                res.status(500).send('Erro interno');
            }
        });
    }
}

module.exports = ApiServer;
