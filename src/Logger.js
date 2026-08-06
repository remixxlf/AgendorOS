const fs = require('fs');
const path = require('path');

// =========================================================================
// CLASSE: Logger
// Responsável por todo o logging do sistema (console + arquivo de erros).
// =========================================================================
class Logger {
    /**
     * @param {string} appDataPath - Caminho do diretório de dados da aplicação
     */
    constructor(appDataPath) {
        this._logFilePath = path.join(appDataPath, 'erros.log');
    }

    /**
     * Log informativo no console com timestamp e tag.
     * @param {string} tag - Categoria do log (ex: 'DB', 'BOT', 'API')
     * @param {string} mensagem - Mensagem a ser exibida
     */
    log(tag, mensagem) {
        const agora = new Date().toLocaleTimeString('pt-BR');
        console.log(`[${agora}] [${tag}] ${mensagem}`);
    }

    /**
     * Log de erro persistente: exibe no console.error e grava no arquivo erros.log.
     * @param {string} contexto - Contexto onde o erro ocorreu (ex: 'BACKUP', 'MIGRAÇÃO')
     * @param {Error|string|object} erro - O erro a ser registrado
     */
    logErro(contexto, erro) {
        const timestamp = new Date().toISOString();
        const detalhe = erro?.stack || (typeof erro === 'string' ? erro : JSON.stringify(erro));
        const linha = `[${timestamp}] [ERRO] [${contexto}] ${detalhe}\n`;
        console.error(linha);
        if (this._logFilePath) {
            try { fs.appendFileSync(this._logFilePath, linha, 'utf8'); } catch (_) {}
        }
    }
}

module.exports = Logger;
