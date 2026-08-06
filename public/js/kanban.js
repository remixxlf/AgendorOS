/**
 * kanban.js — Módulo de Ordens de Serviço (Kanban)
 */

import { escapeHTML, toast, confirmar, formatMoeda } from './utils.js';
import { OS } from './api.js';
import { currentCycle } from './cycle.js';

// ==================== RENDERIZAÇÃO DO KANBAN ====================
export async function carregarOS() {
    try {
        const ordens = await OS.listar(currentCycle.mes, currentCycle.ano);

        const colR = document.getElementById('colRecebido');
        const colA = document.getElementById('colAndamento');
        const colC = document.getElementById('colConcluido');
        if (!colR) return;

        colR.innerHTML = ''; colA.innerHTML = ''; colC.innerHTML = '';

        let cR = 0, cA = 0, cC = 0;
        let statConcluido = 0, statFaturado = 0;
        const prefixoMes = `${currentCycle.ano}-${String(currentCycle.mes).padStart(2, '0')}-`;
        const prefixoAtual = `${currentCycle.ano}-${String(currentCycle.mes).padStart(2, '0')}`;

        ordens.forEach(os => {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-3 group transition-shadow hover:shadow-md cursor-default';

            const doCiclo = os.data_criacao?.startsWith(prefixoMes);
            if (doCiclo && os.status === 'concluido') {
                statConcluido++;
                statFaturado += parseFloat(os.valor || 0);
            }

            let actions = '';
            let statusBadge = '';

            if (os.status === 'recebido') {
                cR++;
                statusBadge = '<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Aguardando</span>';
                actions = `
                    <div class="flex gap-2 mt-2 pt-3 border-t border-slate-100">
                        <button onclick="window.kanban.mudarStatus(${os.id}, 'em_andamento')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-lg text-sm font-semibold transition-colors flex justify-center items-center gap-1.5">
                            <i class="ph-bold ph-arrow-right"></i> Bancada
                        </button>
                        <button onclick="window.kanban.abrirRecibo(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors">
                            <i class="ph-bold ph-printer"></i>
                        </button>
                    </div>`;
            } else if (os.status === 'em_andamento') {
                cA++;
                statusBadge = '<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Analisando</span>';
                actions = `
                    <div class="flex gap-2 mt-2 pt-3 border-t border-slate-100">
                        <button onclick="window.kanban.abrirConcluir(${os.id})" class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 py-2 rounded-lg text-sm font-semibold transition-colors flex justify-center items-center gap-1.5">
                            <i class="ph-bold ph-check"></i> Finalizar
                        </button>
                        <button onclick="window.kanban.abrirRecibo(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors">
                            <i class="ph-bold ph-printer"></i>
                        </button>
                    </div>`;
            } else if (os.status === 'concluido') {
                cC++;
                statusBadge = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Pronto</span>';
                actions = `
                    <div class="flex justify-between items-center mt-2 pt-3 border-t border-slate-100">
                        <div class="font-bold text-emerald-600">${escapeHTML(formatMoeda(os.valor))}</div>
                        <button onclick="window.kanban.abrirRecibo(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors">
                            <i class="ph-bold ph-printer"></i>
                        </button>
                    </div>`;
            }

            const mesOS = os.data_criacao?.substring(0, 7);
            const dataBadge = mesOS && mesOS !== prefixoAtual
                ? `<span class="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">${
                    new Date(os.data_criacao).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase()
                  }</span>`
                : '';

            // Usa textContent para dados do usuário — evita XSS
            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-slate-400">#${os.id} ${dataBadge}</span>
                    ${statusBadge}
                </div>
                <div>
                    <h3 class="font-bold text-slate-800 text-lg leading-tight card-equipamento"></h3>
                    <div class="flex items-center gap-1.5 text-slate-500 text-sm mt-1">
                        <i class="ph-fill ph-user text-slate-400"></i>
                        <span class="card-cliente"></span>
                    </div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-sm text-slate-600">
                    <span class="font-semibold text-slate-700">Defeito:</span>
                    <span class="card-problema"></span>
                </div>
                ${os.solucao ? '<div class="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100/50 text-sm text-emerald-700"><span class="font-semibold">Solução:</span> <span class="card-solucao"></span></div>' : ''}
                ${actions}
            `;

            // Injeção segura via textContent (anti-XSS)
            card.querySelector('.card-equipamento').textContent = os.equipamento || '';
            card.querySelector('.card-cliente').textContent = os.cliente_nome || '';
            card.querySelector('.card-problema').textContent = os.problema || 'Não informado';
            if (os.solucao) card.querySelector('.card-solucao').textContent = os.solucao;

            if (os.status === 'recebido') colR.appendChild(card);
            else if (os.status === 'em_andamento') colA.appendChild(card);
            else if (os.status === 'concluido') colC.appendChild(card);
        });

        // Contadores colunas Kanban
        _setText('count-recebido', cR);
        _setText('count-andamento', cA);
        _setText('count-concluido', cC);

        // Cards de resumo do mês
        _setText('os-stat-recebido', cR);
        _setText('os-stat-andamento', cA);
        _setText('os-stat-concluido', statConcluido);
        _setText('os-stat-faturado', formatMoeda(statFaturado));

        // Dashboard
        _setText('dash-os-hoje', cR + cA + cC);
        _setText('dash-os-bancada', cA);

        // Waffle chart
        _renderWaffleChart(ordens);

    } catch (e) {
        console.error('Erro ao carregar OS:', e);
        toast('Erro ao carregar ordens de serviço', 'error');
    }
}

// ==================== AÇÕES ====================
export async function mudarStatus(id, novoStatus) {
    try {
        await OS.mudarStatus(id, novoStatus, null);
        carregarOS();
    } catch (e) {
        toast(`Erro ao mudar status: ${e.message}`, 'error');
    }
}

export async function abrirRecibo(id) {
    try {
        // Abre o recibo (gerado pelo backend) em nova aba para impressão
        window.open(`/api/os/${id}/recibo`, '_blank');
    } catch (e) {
        toast('Erro ao abrir recibo', 'error');
    }
}

let _osAtualConcluir = null;

export async function abrirConcluir(id) {
    _osAtualConcluir = id;
    const select = document.getElementById('concTecnico');
    if (!select) return;
    select.innerHTML = '<option value="">Carregando...</option>';
    try {
        const tecnicos = await (await import('./api.js')).Tecnicos.listar();
        select.innerHTML = '<option value="">Selecione o técnico...</option>';
        tecnicos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nome; // textContent = seguro
            select.appendChild(opt);
        });
    } catch (e) {
        select.innerHTML = '<option value="">Erro ao carregar técnicos</option>';
    }
    document.getElementById('modalConcluirOS')?.classList.remove('hidden');
}

export async function salvarConclusao() {
    const solucao        = document.getElementById('concSolucao')?.value.trim();
    const tecnico_id     = document.getElementById('concTecnico')?.value;
    const valor          = document.getElementById('concValor')?.value.trim();
    const gerarFinanceiro = document.getElementById('concGerarFinanceiro')?.checked;

    if (!tecnico_id || !valor) { toast('Preencha Técnico e Valor.', 'warning'); return; }

    const btn = document.getElementById('btnSalvarConclusao');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Concluindo...';

    try {
        await OS.concluir(_osAtualConcluir, {
            solucao,
            tecnico_id,
            valor: parseFloat(valor.replace(',', '.')),
            gerar_financeiro: gerarFinanceiro
        });
        document.getElementById('modalConcluirOS')?.classList.add('hidden');
        document.getElementById('concSolucao').value = '';
        document.getElementById('concValor').value = '';
        document.getElementById('concGerarFinanceiro').checked = true;
        toast('OS concluída e faturada com sucesso!', 'success');
        carregarOS();
        // Dispara evento para financeiro atualizar
        document.dispatchEvent(new CustomEvent('gestor:financeiro:atualizar'));
    } catch (e) {
        toast(`Erro ao concluir OS: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = 'Faturar';
    }
}

// ==================== NOVA OS ====================
export async function criarNovaOS(data) {
    const btn = document.getElementById('btnSalvarNovaOS');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Criando...';
    try {
        const r = await OS.criar(data);
        document.getElementById('modalNovaOS')?.classList.add('hidden');
        toast(`OS #${r.id} criada com sucesso!`, 'success');
        carregarOS();
    } catch (e) {
        toast(`Erro ao criar OS: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = 'Criar OS';
    }
}

// ==================== WAFFLE CHART ====================
function _renderWaffleChart(ordens) {
    const { currentCycle } = window._cycle || {};
    let smart = 0, note = 0, pc = 0, outros = 0, total = 0;
    const mes = currentCycle?.mes;
    const ano = currentCycle?.ano;

    ordens.forEach(o => {
        if (o.status !== 'concluido') return;
        if (o.data_criacao) {
            const d = new Date(o.data_criacao);
            if (!isNaN(d.getTime()) && (d.getMonth() + 1 !== mes || d.getFullYear() !== ano)) return;
        }
        total++;
        const cat = o.categoria || 'outros';
        if (cat === 'smartphone') smart++;
        else if (cat === 'notebook') note++;
        else if (cat === 'pc') pc++;
        else outros++;
    });

    if (total === 0) total = 1;
    const pSmart = Math.round((smart / total) * 100) || 0;
    const pNote  = Math.round((note  / total) * 100) || 0;
    const pPc    = Math.round((pc    / total) * 100) || 0;
    const pOutros = 100 - (pSmart + pNote + pPc);

    const container = document.getElementById('waffle-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 100; i++) {
        const div = document.createElement('div');
        div.className = 'waffle-cell';
        if      (i < pSmart)             div.style.backgroundColor = '#6366f1';
        else if (i < pSmart + pNote)     div.style.backgroundColor = '#10b981';
        else if (i < pSmart + pNote + pPc) div.style.backgroundColor = '#f59e0b';
        else                             div.style.backgroundColor = '#cbd5e1';
        container.appendChild(div);
    }

    const legend = document.getElementById('waffle-legend');
    if (legend) {
        legend.innerHTML = `
            <div class="flex items-center justify-between text-sm"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-indigo-500"></div><span class="text-slate-600 font-medium">Smartphones</span></div><span class="font-bold text-slate-800">${pSmart}%</span></div>
            <div class="flex items-center justify-between text-sm"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-emerald-500"></div><span class="text-slate-600 font-medium">Notebooks</span></div><span class="font-bold text-slate-800">${pNote}%</span></div>
            <div class="flex items-center justify-between text-sm"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-amber-500"></div><span class="text-slate-600 font-medium">Desktops / PCs</span></div><span class="font-bold text-slate-800">${pPc}%</span></div>
            <div class="flex items-center justify-between text-sm"><div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-slate-300"></div><span class="text-slate-600 font-medium">Outros / Vendas</span></div><span class="font-bold text-slate-800">${pOutros}%</span></div>
        `;
    }
}

function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
