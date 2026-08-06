/**
 * tecnicos.js — Módulo de Equipe e Comissões
 */

import { escapeHTML, toast, confirmar, formatMoeda } from './utils.js';
import { Tecnicos } from './api.js';
import { currentCycle } from './cycle.js';

export async function loadEquipe() {
    const grid = document.getElementById('grid-tecnicos');
    if (!grid) return;
    grid.innerHTML = '<p class="text-slate-400">Carregando...</p>';
    try {
        const tecnicos = await Tecnicos.listar();
        grid.innerHTML = '';
        tecnicos.forEach(t => {
            const card = document.createElement('div');
            card.className = 'bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center relative group overflow-hidden';
            card.innerHTML = `
                <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="btn-del text-slate-300 hover:text-rose-500 transition-colors"><i class="ph-fill ph-trash text-lg"></i></button>
                </div>
                <div class="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-2xl mb-4 shrink-0">
                    <i class="ph-fill ph-user"></i>
                </div>
                <h3 class="font-bold text-slate-800 text-lg nome-tec"></h3>
                <p class="text-indigo-600 font-medium text-sm mt-1 bg-indigo-50 px-3 py-1 rounded-full">${escapeHTML(t.comissao)}% de Comissão</p>
            `;
            card.querySelector('.nome-tec').textContent = t.nome;
            card.querySelector('.btn-del').addEventListener('click', () => deletarTecnico(t.id));
            grid.appendChild(card);
        });
    } catch(e) {
        toast('Erro ao carregar técnicos', 'error');
    }
}

export async function salvarTecnico() {
    const nome = document.getElementById('inputNomeTecnico')?.value.trim();
    const comissao = document.getElementById('inputComissaoTecnico')?.value.trim();
    if (!nome) { toast('Preencha o nome do técnico.', 'warning'); return; }
    
    const btn = document.getElementById('btnAddTecnico');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i>...';
    
    try {
        await Tecnicos.criar({ nome, comissao: comissao || 0 });
        document.getElementById('inputNomeTecnico').value = '';
        document.getElementById('inputComissaoTecnico').value = '';
        document.getElementById('modalNovoTecnico')?.classList.add('hidden');
        toast('Técnico cadastrado!', 'success');
        loadEquipe();
    } catch(e) {
        toast(`Erro: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = 'Cadastrar';
    }
}

async function deletarTecnico(id) {
    const ok = await confirmar('Tem certeza que deseja apagar este técnico?', 'Apagar');
    if (!ok) return;
    try {
        await Tecnicos.excluir(id);
        toast('Técnico excluído!', 'success');
        loadEquipe();
    } catch(e) {
        toast(`Erro: ${e.message}`, 'error');
    }
}

export async function loadComissoes() {
    const grid = document.getElementById('grid-comissoes');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-3 text-center py-10"><i class="ph ph-spinner animate-spin text-3xl text-indigo-500 mb-2"></i><p class="text-slate-500">Calculando comissões...</p></div>';
    
    try {
        const comissoes = await Tecnicos.comissoes(currentCycle.mes, currentCycle.ano);
        
        if (comissoes.length === 0) {
            grid.innerHTML = '<div class="col-span-3 text-center text-slate-400 py-10">Nenhum técnico cadastrado.</div>';
            return;
        }

        grid.innerHTML = '';
        comissoes.forEach(c => {
            const faturamento = c.faturamento_gerado || 0;
            const aReceber = c.valor_receber || 0;
            const osCount = c.total_os || 0;
            
            const card = document.createElement('div');
            card.className = 'bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all';
            card.innerHTML = `
                <div class="flex items-center gap-4 mb-5 border-b border-slate-100 pb-4">
                    <div class="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl shrink-0">
                        <i class="ph-fill ph-user-focus"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-slate-800 text-lg nome-tec"></h3>
                        <p class="text-slate-500 text-sm font-medium">Comissão Base: <span class="text-indigo-600">${escapeHTML(c.comissao)}%</span></p>
                    </div>
                </div>
                
                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <span class="text-slate-500 text-sm">Serviços Concluídos:</span>
                        <span class="font-semibold text-slate-700">${escapeHTML(osCount)} OS</span>
                    </div>
                    
                    <div class="flex justify-between items-center">
                        <span class="text-slate-500 text-sm">Faturamento Gerado:</span>
                        <span class="font-medium text-emerald-600">${escapeHTML(formatMoeda(faturamento))}</span>
                    </div>
                    
                    <div class="pt-4 border-t border-slate-100 flex justify-between items-end">
                        <span class="text-slate-700 font-medium">A Receber no Mês:</span>
                        <span class="text-2xl font-bold text-indigo-600">${escapeHTML(formatMoeda(aReceber))}</span>
                    </div>
                </div>
            `;
            card.querySelector('.nome-tec').textContent = c.nome;
            grid.appendChild(card);
        });
    } catch(e) {
        grid.innerHTML = '<p class="text-rose-500">Erro ao carregar comissões.</p>';
        toast('Erro ao carregar comissões', 'error');
    }
}
