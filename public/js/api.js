/**
 * api.js — Camada de abstração de comunicação com o backend
 *
 * Centraliza todos os fetch() em um único lugar.
 * Benefícios:
 *   - Fácil migração futura para IPC (Electron) sem tocar nos módulos de UI
 *   - Tratamento de erros padronizado
 *   - Fácil adição de autenticação/headers globais
 */

const BASE = ''; // Prefixo base (deixar vazio para URLs relativas ao localhost)

async function _req(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || `Erro ${res.status}`);
    }
    // Rotas que retornam HTML (recibo) não fazem json()
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) return res.text();
    return res.json();
}

const get  = (path)         => _req('GET',    path);
const post = (path, body)   => _req('POST',   path, body);
const put  = (path, body)   => _req('PUT',    path, body);
const del  = (path)         => _req('DELETE', path);

// ==================== ORDENS DE SERVIÇO ====================
export const OS = {
    listar:     (mes, ano)      => get(`/api/os?mes=${mes}&ano=${ano}`),
    criar:      (data)          => post('/api/os', data),
    mudarStatus:(id, status, tecnico_id) => post(`/api/os/${id}/status`, { status, tecnico_id }),
    concluir:   (id, data)      => post(`/api/os/${id}/concluir`, data),
    excluir:    (id)            => del(`/api/os/${id}`),
    recibo:     (id)            => get(`/api/os/${id}/recibo`),
    produtos:   {
        listar: (osId)          => get(`/api/os/${osId}/produtos`),
        add:    (osId, d)       => post(`/api/os/${osId}/produtos`, d),
    }
};

// ==================== TÉCNICOS ====================
export const Tecnicos = {
    listar:     ()              => get('/api/tecnicos'),
    criar:      (data)          => post('/api/tecnicos', data),
    excluir:    (id)            => del(`/api/tecnicos/${id}`),
    comissoes:  (mes, ano)      => get(`/api/tecnicos/comissoes?mes=${mes}&ano=${ano}`),
};

// ==================== FINANCEIRO ====================
export const Financeiro = {
    dashboard:  (mes, ano)      => get(`/api/financeiro/dashboard?mes=${mes}&ano=${ano}`),
    despesas:   (data)          => post('/api/despesas', data),
    receitas:   (data)          => post('/api/receitas', data),
    excluir:    (id)            => del(`/api/transacoes/${id}`),
};

// ==================== PRODUTOS / ESTOQUE ====================
export const Produtos = {
    listar:     ()              => get('/api/produtos'),
    criar:      (data)          => post('/api/produtos', data),
    atualizar:  (id, data)      => put(`/api/produtos/${id}`, data),
    excluir:    (id)            => del(`/api/produtos/${id}`),
};

// ==================== PDV ====================
export const PDV = {
    venda:      (itens)         => post('/api/pdv/venda', { itens }),
};

// ==================== CONFIGURAÇÕES ====================
export const Config = {
    carregar:   ()              => get('/api/configuracoes'),
    nome:       ()              => get('/api/configuracoes/nome'),
    salvar:     (data)          => post('/api/configuracoes', data),
};
