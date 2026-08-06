require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const cron = require('node-cron');

// =========================================================================
// CLASSE: Database
// Responsável por toda a interação com o SQLite: inicialização, migrações,
// backups, integridade e queries CRUD.
// =========================================================================
class Database {
    /**
     * @param {string} appDataPath - Caminho do diretório de dados da aplicação
     * @param {import('./Logger')} logger - Instância do Logger
     */
    constructor(appDataPath, logger) {
        this._appDataPath = appDataPath;
        this._logger = logger;
        this._dbFile = path.join(appDataPath, 'banco_os.sqlite');
        this._oldJsonDb = path.join(appDataPath, 'banco_os.json');
        this._db = null;
        this._notificarUI = null;
    }

    /**
     * Define a função de callback para notificar a UI (Electron).
     * @param {Function} fn - Callback (tipo, mensagem)
     */
    setNotificarUI(fn) {
        this._notificarUI = fn;
    }

    // =====================================================================
    // INICIALIZAÇÃO
    // =====================================================================

    /**
     * Abre o banco, configura PRAGMAs, cria tabelas, executa migrações,
     * verifica integridade, faz backup e agenda backups automáticos.
     */
    async inicializar() {
        this._db = await open({
            filename: this._dbFile,
            driver: sqlite3.Database
        });

        // PRAGMAs de segurança e performance
        await this._db.run('PRAGMA journal_mode = WAL;');
        await this._db.run('PRAGMA synchronous = NORMAL;');
        await this._db.run('PRAGMA cache_size = -32000;');
        await this._db.run('PRAGMA foreign_keys = ON;');
        await this._db.run('PRAGMA temp_store = MEMORY;');
        this._logger.log('DB', 'WAL mode e PRAGMAs de segurança ativados.');

        // Criação das tabelas
        await this._db.exec(`
            CREATE TABLE IF NOT EXISTS ordens_servico (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_nome TEXT, cliente_telefone TEXT, equipamento TEXT, categoria TEXT, problema TEXT, solucao TEXT, valor REAL, status TEXT, tecnico_id INTEGER, data_criacao TEXT);
            CREATE TABLE IF NOT EXISTS tecnicos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, comissao INTEGER);
            CREATE TABLE IF NOT EXISTS transacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, os_id INTEGER, tipo TEXT, valor REAL, data TEXT, descricao TEXT);
            CREATE TABLE IF NOT EXISTS configuracoes (id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, valor TEXT);
        `);

        // Migração JSON → SQLite (legado)
        await this._migrarDadosLegados();

        // Integridade + Backup
        await this.verificarIntegridade();
        await this.realizarBackup();
        this._agendarBackupAutomatico();

        // Seed de configurações padrão
        await this._seedConfiguracoes();

        // Migração do NUMERO_DONO do .env para o banco
        await this._migrarNumeroDono();
    }

    // =====================================================================
    // QUERIES CRUD (Helpers Públicos)
    // =====================================================================

    async all(sql, params = []) {
        return await this._db.all(sql, params);
    }

    async run(sql, params = []) {
        return await this._db.run(sql, params);
    }

    async get(sql, params = []) {
        return await this._db.get(sql, params);
    }

    /**
     * Retorna o próximo ID disponível para a tabela informada.
     * @param {string} tableName - Nome da tabela
     * @returns {Promise<number>}
     */
    async getNextId(tableName) {
        const rows = await this.all(`SELECT MAX(id) as maxId FROM ${tableName}`);
        return (rows[0] && rows[0].maxId ? rows[0].maxId : 0) + 1;
    }

    /**
     * Retorna o valor de uma configuração pelo nome da chave.
     * @param {string} chave - A chave da configuração
     * @returns {Promise<string|null>}
     */
    async getConfig(chave) {
        const row = await this.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
        return row?.valor || null;
    }

    /**
     * Busca um template de mensagem do banco e aplica variáveis de substituição.
     * @param {string} chave - Chave da configuração (ex: 'msg_bancada')
     * @param {Object} vars - Objeto com variáveis para substituir (ex: { nome: 'João' })
     * @returns {Promise<string>}
     */
    async getMsgConfig(chave, vars = {}) {
        const row = await this.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave]);
        let msg = row?.valor || '';
        for (const [k, v] of Object.entries(vars)) {
            msg = msg.replace(new RegExp(`{${k}}`, 'g'), v ?? '');
        }
        return msg;
    }

    /**
     * Retorna o número do dono configurado (do banco ou do .env).
     * @returns {Promise<string|null>}
     */
    async getNumeroDono() {
        const row = await this.get("SELECT valor FROM configuracoes WHERE chave = 'numero_dono'");
        return row?.valor || process.env.NUMERO_DONO || null;
    }

    // =====================================================================
    // BACKUP
    // =====================================================================

    async realizarBackup() {
        const backupDir = path.join(this._appDataPath, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupFile = path.join(backupDir, `banco_os_backup_${timestamp}.sqlite`);

        try {
            await new Promise((resolve, reject) => {
                this._db.driver.backup(backupFile, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            this._logger.log('BACKUP', `Backup criado: ${path.basename(backupFile)}`);
            await this._limparBackupsAntigos(backupDir, 7);
        } catch (err) {
            this._logger.logErro('BACKUP', err);
        }
    }

    async verificarIntegridade() {
        try {
            const resultado = await this._db.all('PRAGMA integrity_check;');
            if (resultado[0]?.integrity_check === 'ok') {
                this._logger.log('DB', 'Integridade do banco: ✅ OK');
                return true;
            } else {
                const detalhes = JSON.stringify(resultado);
                this._logger.logErro('INTEGRIDADE', `Banco corrompido! Detalhes: ${detalhes}`);
                if (this._notificarUI) this._notificarUI('error', '⚠️ O banco de dados pode estar corrompido! Verifique erros.log.');
                return false;
            }
        } catch (err) {
            this._logger.logErro('INTEGRIDADE', err);
            return false;
        }
    }

    // =====================================================================
    // MÉTODOS PRIVADOS
    // =====================================================================

    _agendarBackupAutomatico() {
        cron.schedule('0 */6 * * *', () => {
            this._logger.log('BACKUP', 'Iniciando backup agendado (6h)...');
            this.realizarBackup();
        });
    }

    async _limparBackupsAntigos(backupDir, manter = 7) {
        try {
            const arquivos = fs.readdirSync(backupDir)
                .filter(f => f.endsWith('.sqlite'))
                .map(f => ({ nome: f, mtime: fs.statSync(path.join(backupDir, f)).mtime }))
                .sort((a, b) => b.mtime - a.mtime);

            const paraExcluir = arquivos.slice(manter);
            for (const arq of paraExcluir) {
                fs.unlinkSync(path.join(backupDir, arq.nome));
                this._logger.log('BACKUP', `Backup antigo removido: ${arq.nome}`);
            }
        } catch (err) {
            this._logger.logErro('BACKUP_LIMPEZA', err);
        }
    }

    async _migrarDadosLegados() {
        if (!fs.existsSync(this._oldJsonDb)) return;

        try {
            const data = JSON.parse(fs.readFileSync(this._oldJsonDb, 'utf8'));
            const countOS = await this.get('SELECT COUNT(*) as count FROM ordens_servico');

            if (countOS.count === 0 && data.ordens_servico && data.ordens_servico.length > 0) {
                console.log("[MIGRAÇÃO] Migrando dados do JSON para SQLite...");
                for (const os of data.ordens_servico) {
                    await this.run('INSERT INTO ordens_servico (id, cliente_nome, cliente_telefone, equipamento, categoria, problema, solucao, valor, status, tecnico_id, data_criacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [os.id, os.cliente_nome, os.cliente_telefone, os.equipamento, os.categoria, os.problema, os.solucao, os.valor, os.status, os.tecnico_id, os.data_criacao]);
                }
                for (const t of (data.tecnicos || [])) {
                    await this.run('INSERT INTO tecnicos (id, nome, comissao) VALUES (?, ?, ?)', [t.id, t.nome, t.comissao]);
                }
                for (const tr of (data.transacoes || [])) {
                    await this.run('INSERT INTO transacoes (id, os_id, tipo, valor, data, descricao) VALUES (?, ?, ?, ?, ?, ?)', [tr.id, tr.os_id, tr.tipo, tr.valor, tr.data, tr.descricao]);
                }
                for (const cfg of (data.configuracoes || [])) {
                    await this.run('INSERT INTO configuracoes (id, chave, valor) VALUES (?, ?, ?)', [cfg.id, cfg.chave, cfg.valor]);
                }
                fs.renameSync(this._oldJsonDb, this._oldJsonDb + '.bkp');
                console.log("[MIGRAÇÃO] Concluída com sucesso! Backup salvo em .json.bkp");
            }
        } catch (e) {
            this._logger.logErro('MIGRAÇÃO_JSON', e);
        }
    }

    async _seedConfiguracoes() {
        const confResult = await this.get("SELECT COUNT(*) as c FROM configuracoes");
        if (confResult.c === 0) {
            await this.run("INSERT INTO configuracoes (chave, valor) VALUES ('nome_negocio', 'Minha Assistência')");
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
            const row = await this.get('SELECT * FROM configuracoes WHERE chave = ?', [chave]);
            if (!row) {
                await this.run("INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", [chave, valor]);
            }
        }
    }

    async _migrarNumeroDono() {
        const numeroDonoBanco = await this.get("SELECT valor FROM configuracoes WHERE chave = 'numero_dono'");
        if (!numeroDonoBanco && process.env.NUMERO_DONO) {
            await this.run("INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('numero_dono', ?)", [process.env.NUMERO_DONO]);
            this._logger.log('CONFIG', 'NUMERO_DONO migrado do .env para o banco de dados.');
        }
    }
}

module.exports = Database;
