// =========================================================================
// ORQUESTRADOR PRINCIPAL (index.js)
// Instancia as classes, injeta dependências e inicializa tudo na ordem correta.
// =========================================================================
const { app: electronApp } = require('electron');

const Logger = require('./src/Logger');
const Database = require('./src/Database');
const ApiServer = require('./src/ApiServer');
const WhatsAppBot = require('./src/WhatsAppBot');
const TunnelManager = require('./src/TunnelManager');

/**
 * Ponto de entrada da aplicação. Chamado pelo main.js do Electron.
 * @param {Electron.BrowserWindow} mainWindow - Janela principal do Electron
 */
module.exports = async function startApp(mainWindow) {
    // Callback para enviar atualizações de status à janela do Electron
    const notificarUI = (tipo, mensagem) => {
        if (mainWindow) mainWindow.webContents.send('update-status', { type: tipo, msg: mensagem });
    };

    // 1. Caminho de dados da aplicação
    const appDataPath = electronApp.getPath('userData');

    // 2. Logger — logging no console + arquivo de erros
    const logger = new Logger(appDataPath);

    // 3. Database — SQLite: init, PRAGMAs, tabelas, migração, backup, seed
    const db = new Database(appDataPath, logger);
    db.setNotificarUI(notificarUI);
    await db.inicializar();

    // 4. ApiServer — Express: todas as rotas REST
    const api = new ApiServer(db, logger, notificarUI);
    api.iniciar(3000);

    // 4.1 TunnelManager — Expõe o local via Ngrok
    const tunnel = new TunnelManager(db, logger, notificarUI);
    // Inicializa em background (não trava o boot)
    tunnel.inicializar(3000).catch(e => console.error("Ngrok Init falhou:", e));

    // 5. WhatsAppBot — Conexão, QR, máquina de estados do menu
    const bot = new WhatsAppBot(appDataPath, db, logger, notificarUI, mainWindow, api.getUserStages());
    api.setWhatsAppBot(bot);
    await bot.inicializar();
};
