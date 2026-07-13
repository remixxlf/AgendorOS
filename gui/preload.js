// Importamos duas ferramentas de dentro do Electron:
// - contextBridge: Cria uma ponte segura entre o Node.js (backend) e o HTML (frontend).
// - ipcRenderer: Permite escutar e enviar mensagens para o processo principal (main.js).
const { contextBridge, ipcRenderer } = require('electron');

// Expondo as funções para o mundo principal (o seu arquivo HTML)
// Isso vai criar um objeto chamado "window.electronAPI" lá no seu script do HTML.
contextBridge.exposeInMainWorld('electronAPI', {
    
    // Escuta atualizações de status. Quando o main.js enviar um 'update-status', ele chama o callback.
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    
    // Aqui estamos abrindo um canal de comunicação chamado 'qr-code' para que a tela possa ouvir...
    // Quando o robô gerar a imagem do QR, ele manda pra cá, e passamos para o HTML.
    onQRCode: (callback) => ipcRenderer.on('qr-code', (event, qrBase64) => callback(qrBase64)),
    
    // Função para o HTML enviar uma mensagem pedindo para abrir o painel web.
    openPanel: () => ipcRenderer.send('open-panel')
});
