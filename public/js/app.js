/**
 * app.js — Ponto de Entrada Principal (Main Entry Point)
 * 
 * Substitui o antigo script.js monolítico.
 * Conecta todos os módulos ES e inicializa a aplicação.
 */

import { atualizarTextoCiclo, onCycleChange } from './cycle.js';
import { carregarOS, criarNovaOS, salvarConclusao, mudarStatus, abrirRecibo, abrirConcluir } from './kanban.js';
import { loadEstoque, salvarProduto, loadPDV, finalizarVenda, limparCarrinho } from './estoque.js';
import { loadFinanceiroE_Dashboard, adicionarDespesa, adicionarReceita } from './financeiro.js';
import { loadEquipe, salvarTecnico, loadComissoes } from './tecnicos.js';
import { loadConfig, salvarConfig } from './config.js';
import { initChecklist, getSelectedAvarias, clearAvarias } from './checklist.js';

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inicializar Ciclo Mensal e UI Base
    atualizarTextoCiclo();
    
    // 2. Escutar mudanças no ciclo mensal
    onCycleChange(async () => {
        await loadFinanceiroE_Dashboard();
        await carregarOS();
        if (document.getElementById('comissoes-view').classList.contains('active')) {
            loadComissoes();
        }
    });

    // 3. Inicializar Checklist (Kanban)
    initChecklist();

    // 4. Carregar Dados Iniciais (Aba Padrão: Dashboard/Financeiro e OS)
    carregarOS();
    loadFinanceiroE_Dashboard();

    // 5. Configurar Navegação em Abas
    configurarNavegacao();

    // 6. Configurar Listeners de Eventos Globais (Botões)
    configurarEventos();

    // 7. Configurar IPC com Electron (se rodando no desktop)
    configurarIPC();
});

// ==================== NAVEGAÇÃO ====================
function configurarNavegacao() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Limpar ativos
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active', 'bg-indigo-600/10', 'text-indigo-400'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

            // Setar novo ativo
            const targetId = btn.getAttribute('data-target');
            btn.classList.add('active', 'bg-indigo-600/10', 'text-indigo-400');
            document.getElementById(targetId)?.classList.add('active');

            // Lazy Load condicional de dados das abas
            if (targetId === 'os-view') carregarOS();
            if (targetId === 'tecnicos-view') loadEquipe();
            if (targetId === 'comissoes-view') loadComissoes();
            if (targetId === 'estoque-view') loadEstoque();
            if (targetId === 'pdv-view') { loadEstoque(); loadPDV(); }
            if (targetId === 'config-view') loadConfig();
        });
    });
}

// ==================== EVENTOS (LIGAR UI AOS MÓDULOS) ====================
function configurarEventos() {
    // ---- Kanban ----
    document.getElementById('btnSalvarNovaOS')?.addEventListener('click', () => {
        const data = {
            cliente_nome: document.getElementById('osNome')?.value.trim(),
            cliente_telefone: document.getElementById('osZap')?.value.trim(),
            equipamento: document.getElementById('osEqp')?.value.trim(),
            categoria: document.getElementById('osCat')?.value,
            problema: document.getElementById('osProb')?.value.trim(),
            checklist: getSelectedAvarias()
        };
        if(!data.cliente_nome || !data.equipamento) {
            import('./utils.js').then(m => m.toast('Preencha Nome e Equipamento.', 'warning'));
            return;
        }
        criarNovaOS(data).then(() => {
            document.getElementById('osNome').value = '';
            document.getElementById('osZap').value = '';
            document.getElementById('osEqp').value = '';
            document.getElementById('osProb').value = '';
            clearAvarias();
        });
    });

    document.getElementById('btnSalvarConclusao')?.addEventListener('click', salvarConclusao);

    // Escuta evento customizado disparado pelo kanban ao concluir (para atualizar dashboard)
    document.addEventListener('gestor:financeiro:atualizar', () => {
        loadFinanceiroE_Dashboard();
    });

    // ---- Financeiro ----
    document.getElementById('btnAddDespesa')?.addEventListener('click', adicionarDespesa);
    document.getElementById('btnAddReceita')?.addEventListener('click', adicionarReceita);

    // ---- Estoque & PDV ----
    document.getElementById('btnSalvarProduto')?.addEventListener('click', salvarProduto);
    document.getElementById('btnFinalizarVenda')?.addEventListener('click', finalizarVenda);
    document.getElementById('btnLimparCarrinho')?.addEventListener('click', limparCarrinho);

    // ---- Equipe ----
    document.getElementById('btnAddTecnico')?.addEventListener('click', salvarTecnico);

    // ---- Config ----
    document.getElementById('btnSalvarConfigGeral')?.addEventListener('click', salvarConfig);
}

// ==================== IPC (ELECTRON) ====================
function configurarIPC() {
    // Se window.electronAPI estiver disponível (injetado via preload.js do Electron)
    if (window.electronAPI) {
        window.electronAPI.onUpdateStatus((data) => {
            if (data.type === 'bot') {
                const dot = document.getElementById('bot-status-dot');
                const text = document.getElementById('bot-status-text');
                if(text) text.textContent = data.msg;
                if(dot) {
                    if (data.msg.includes('ONLINE')) {
                        dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
                    } else {
                        dot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]';
                    }
                }
            }
        });
    } else {
        // Fallback legado se a pessoa estiver rodando o script no browser e tiver window.require (NodeIntegration inseguro)
        if (window.require) {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.on('update-status', (event, data) => {
                    if (data.type === 'bot') {
                        const dot = document.getElementById('bot-status-dot');
                        const text = document.getElementById('bot-status-text');
                        if(text) text.textContent = data.msg;
                        if(dot) {
                            if (data.msg.includes('ONLINE')) {
                                dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
                            } else {
                                dot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]';
                            }
                        }
                    }
                });
            } catch(e) {}
        }
    }
}

// ==================== EXPORTS PARA WINDOW (EVITAR REESCREVER HTML INLINE) ====================
// Alguns botões no index.html usam onclick="funcao()". Para que eles funcionem
// com ES modules, precisamos anexar essas funções no escopo window.
window.kanban = { mudarStatus, abrirRecibo, abrirConcluir };
