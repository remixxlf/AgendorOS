const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: 'Gestor OS - Servidor',
        icon: path.join(__dirname, 'build', 'icon.ico'),
        backgroundColor: '#0f0f0f',
        webPreferences: {
            preload: path.join(__dirname, 'gui', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Remove o menu feio do Windows
    mainWindow.setMenu(null);
    
    // Carrega a interface
    mainWindow.loadFile(path.join(__dirname, 'gui', 'index.html'));
    
    // Inicia o Backend (Express + VenomBot) e passa a janela para ele mandar as atualizações
    require('./index.js')(mainWindow);
}

app.whenReady().then(() => {
    // Configura o aplicativo para iniciar automaticamente com o Windows (Auto-start)
    app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath("exe")
    });

    createWindow();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    // Ao fechar a janela, matar o processo Node por completo
    if (process.platform !== 'darwin') app.quit();
});

// Comunicação: O botão do HTML pede para abrir o painel no navegador padrão
ipcMain.on('open-panel', () => {
    shell.openExternal('http://localhost:3000');
});
