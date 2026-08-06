/**
 * config.js — Módulo de Configurações do Sistema
 */

import { toast } from './utils.js';
import { Config } from './api.js';

export async function loadConfig() {
    try {
        const cfg = await Config.carregar();

        const get = (id) => document.getElementById(id);
        
        const setVal = (id, key) => { if (get(id)) get(id).value = cfg[key] || ''; };

        // Loja
        setVal('config-nome-negocio', 'nome_negocio');

        // Notificações
        setVal('config-msg-bancada', 'msg_bancada');
        setVal('config-msg-os-pronta', 'msg_os_pronta');

        // Menu
        setVal('config-msg-saudacao', 'msg_saudacao');
        setVal('config-msg-menu-opcoes', 'msg_menu_opcoes');
        setVal('config-msg-pedir-os', 'msg_pedir_os');
        setVal('config-msg-os-status', 'msg_os_status');
        setVal('config-msg-atendente', 'msg_atendente');

        // Erros
        setVal('config-msg-erro-opcao', 'msg_erro_opcao_invalida');
        setVal('config-msg-erro-formato', 'msg_erro_formato_os');
        setVal('config-msg-erro-os', 'msg_erro_os_nao_encontrada');
    } catch(e) {
        console.error(e);
        toast('Erro ao carregar configurações', 'error');
    }
}

export async function salvarConfig() {
    const btn = document.getElementById('btnSalvarConfigGeral');
    if (!btn) return;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin text-xl"></i> Salvando...';

    const getVal = (id) => document.getElementById(id)?.value || '';

    const payload = {
        'nome_negocio':             getVal('config-nome-negocio').trim(),
        'msg_bancada':              getVal('config-msg-bancada'),
        'msg_os_pronta':            getVal('config-msg-os-pronta'),
        'msg_saudacao':             getVal('config-msg-saudacao'),
        'msg_menu_opcoes':          getVal('config-msg-menu-opcoes'),
        'msg_pedir_os':             getVal('config-msg-pedir-os'),
        'msg_os_status':            getVal('config-msg-os-status'),
        'msg_atendente':            getVal('config-msg-atendente'),
        'msg_erro_opcao_invalida':  getVal('config-msg-erro-opcao'),
        'msg_erro_formato_os':      getVal('config-msg-erro-formato'),
        'msg_erro_os_nao_encontrada': getVal('config-msg-erro-os'),
    };

    try {
        await Config.salvar(payload);
        toast('Configurações salvas com sucesso!', 'success');
    } catch(e) {
        toast(`Erro ao salvar: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = '<i class="ph-fill ph-floppy-disk text-xl"></i> Salvar Todas as Configurações';
    }
}
