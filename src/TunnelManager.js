/**
 * Gerencia o túnel reverso usando o Cloudflare Tunnels (untun) para expor a porta local para a internet sem telas de aviso.
 */
class TunnelManager {
    constructor(db, logger, notificarUI) {
        this._db = db;
        this._logger = logger;
        this._notificarUI = notificarUI;
        this._url = null;
        this._tunnel = null;
    }

    async inicializar(port) {
        try {
            this._notificarUI('bot', 'Iniciando túnel público...');
            this._logger.log('TUNNEL', 'Conectando ao Cloudflare Tunnel (Sem telas de aviso)...');
            
            // Dynamic import para compatibilidade de módulos ES (untun) no CommonJS
            const { startTunnel } = await import('untun');

            this._tunnel = await startTunnel({ port });
            this._url = await this._tunnel.getURL();

            this._logger.log('TUNNEL', `Cloudflare Tunnel conectado com sucesso: ${this._url}`);
            
            await this._db.setTunnelUrl(this._url);
            this._notificarUI('bot', 'Túnel online!');
            
        } catch (error) {
            this._logger.logErro('TUNNEL', error);
            this._notificarUI('bot', 'Erro no túnel');
            console.error('Erro ao iniciar Túnel:', error);
        }
    }

    async getUrl() {
        if (!this._url) {
            return await this._db.getTunnelUrl();
        }
        return this._url;
    }
}

module.exports = TunnelManager;
