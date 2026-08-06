/**
 * financeiro.js — Módulo Financeiro e Dashboard
 */

import { escapeHTML, toast, confirmar, formatMoeda, formatarDataHora } from './utils.js';
import { Financeiro } from './api.js';
import { currentCycle } from './cycle.js';

let _chartInstance = null;

export async function loadFinanceiroE_Dashboard() {
    try {
        const transacoes = await Financeiro.dashboard(currentCycle.mes, currentCycle.ano);
        
        let fatMes = 0, despMes = 0;
        const dictRec = {}; const dictDesp = {};

        transacoes.forEach(t => {
            const v = parseFloat(t.valor);
            if (t.tipo === 'receita') fatMes += v;
            if (t.tipo === 'despesa') despMes += v;
            
            const dataDia = t.data ? t.data.split('T')[0] : '';
            if (dataDia) {
                if(t.tipo === 'receita') dictRec[dataDia] = (dictRec[dataDia]||0) + v;
                if(t.tipo === 'despesa') dictDesp[dataDia] = (dictDesp[dataDia]||0) + v;
            }
        });
        
        _setText('dash-fat-mes', formatMoeda(fatMes));
        const lucro = fatMes - despMes;
        const lucroEl = document.getElementById('dash-lucro-mes');
        if (lucroEl) {
            lucroEl.textContent = formatMoeda(lucro);
            lucroEl.className = lucro >= 0 ? 'text-3xl font-bold text-indigo-600 relative' : 'text-3xl font-bold text-rose-600 relative';
        }

        const labels = [];
        const dadosRec = [];
        const dadosDesp = [];
        const numDias = new Date(currentCycle.ano, currentCycle.mes, 0).getDate();
        
        for (let dia = 1; dia <= numDias; dia++) {
            const dStr = `${currentCycle.ano}-${String(currentCycle.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
            labels.push(`${String(dia).padStart(2, '0')}/${String(currentCycle.mes).padStart(2, '0')}`);
            dadosRec.push(dictRec[dStr] || 0);
            dadosDesp.push(dictDesp[dStr] || 0);
        }

        _renderMainChart(labels, dadosRec, dadosDesp);
        
        const tbody = document.getElementById('tabela-transacoes');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (transacoes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-slate-400">Nenhuma movimentação neste período</td></tr>';
        } else {
            transacoes.forEach(t => {
                const isDespesa = t.tipo === 'despesa';
                const color = isDespesa ? 'text-rose-600' : 'text-emerald-600';
                const bgIcon = isDespesa ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600';
                const icon = isDespesa ? 'ph-arrow-down-right' : 'ph-arrow-up-right';
                const sign = isDespesa ? '-' : '+';
                
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 transition-colors';
                tr.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap">${formatarDataHora(t.data)}</td>
                    <td class="px-6 py-4 font-medium text-slate-700 desc-cell"></td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${bgIcon}">
                            <i class="ph-bold ${icon}"></i> ${isDespesa ? 'Despesa' : 'Receita'}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right font-bold ${color}">${sign} ${escapeHTML(formatMoeda(t.valor))}</td>
                    <td class="px-6 py-4 text-center">
                        <button class="btn-del text-slate-400 hover:text-rose-500 transition-colors bg-white hover:bg-rose-50 p-1.5 rounded-lg border border-transparent hover:border-rose-100 shadow-sm" title="Excluir Lançamento (Estorno)">
                            <i class="ph-fill ph-trash text-base"></i>
                        </button>
                    </td>
                `;
                tr.querySelector('.desc-cell').textContent = t.descricao;
                tr.querySelector('.btn-del').addEventListener('click', () => deletarTransacao(t.id));
                tbody.appendChild(tr);
            });
        }
    } catch(e) {
        console.error(e);
        toast('Erro ao carregar dados financeiros', 'error');
    }
}

async function deletarTransacao(id) {
    const ok = await confirmar('Tem certeza que deseja estornar/excluir este lançamento?', 'Excluir');
    if (!ok) return;
    try {
        await Financeiro.excluir(id);
        toast('Lançamento excluído com sucesso.', 'success');
        loadFinanceiroE_Dashboard();
    } catch(e) {
        toast(`Erro ao excluir: ${e.message}`, 'error');
    }
}

export async function adicionarDespesa() {
    const descricao = document.getElementById('inputDespesaDesc')?.value.trim();
    const valor = document.getElementById('inputDespesaValor')?.value.trim();
    if (!descricao || !valor) { toast('Preencha descrição e valor.', 'warning'); return; }
    
    try {
        await Financeiro.despesas({ descricao, valor: parseFloat(valor.replace(',','.')), data: new Date().toISOString() });
        document.getElementById('inputDespesaDesc').value = '';
        document.getElementById('inputDespesaValor').value = '';
        document.getElementById('modalNovaDespesa')?.classList.add('hidden');
        toast('Despesa lançada!', 'success');
        loadFinanceiroE_Dashboard();
    } catch (e) {
        toast(`Erro: ${e.message}`, 'error');
    }
}

export async function adicionarReceita() {
    const descricao = document.getElementById('inputReceitaDesc')?.value.trim();
    const valor = document.getElementById('inputReceitaValor')?.value.trim();
    if (!descricao || !valor) { toast('Preencha descrição e valor.', 'warning'); return; }
    
    try {
        await Financeiro.receitas({ descricao, valor: parseFloat(valor.replace(',','.')), data: new Date().toISOString() });
        document.getElementById('inputReceitaDesc').value = '';
        document.getElementById('inputReceitaValor').value = '';
        document.getElementById('modalNovaReceita')?.classList.add('hidden');
        toast('Receita lançada!', 'success');
        loadFinanceiroE_Dashboard();
    } catch (e) {
        toast(`Erro: ${e.message}`, 'error');
    }
}

function _renderMainChart(labels, receitas, despesas) {
    if (_chartInstance) _chartInstance.destroy();
    if (typeof ApexCharts === 'undefined') return;
    
    const options = {
        series: [{ name: 'Receitas', data: receitas }, { name: 'Despesas', data: despesas }],
        chart: { type: 'area', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false }, zoom: { enabled: false } },
        colors: ['#6366f1', '#f43f5e'],
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { categories: labels, axisBorder: { show: false }, axisTicks: { show: false } },
        yaxis: { labels: { formatter: (value) => "R$ " + value.toFixed(0) } },
        grid: { borderColor: '#f1f5f9', strokeDashArray: 4, yaxis: { lines: { show: true } } },
        legend: { position: 'top', horizontalAlign: 'right' }
    };
    _chartInstance = new ApexCharts(document.querySelector("#mainChart"), options);
    _chartInstance.render();
}

function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
