/**
 * estoque.js — Módulo de Estoque de Produtos e PDV
 */

import { escapeHTML, toast, confirmar, formatMoeda } from './utils.js';
import { Produtos, PDV } from './api.js';

// ==================== ESTADO LOCAL ====================
let _produtos = [];
let _carrinhoItens = [];

// ==================== ESTOQUE ====================
export async function loadEstoque() {
    try {
        _produtos = await Produtos.listar();
        const tbody = document.getElementById('tabela-produtos');
        if (!tbody) return;
        tbody.innerHTML = '';

        let totalCusto = 0, totalVenda = 0;

        if (_produtos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Nenhum produto cadastrado. Clique em "Novo Produto" para começar.</td></tr>';
        } else {
            _produtos.forEach(p => {
                totalCusto += (p.preco_custo || 0) * (p.quantidade || 0);
                totalVenda += (p.preco_venda || 0) * (p.quantidade || 0);
                const baixo = p.quantidade <= 2;
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 transition-colors';
                tr.innerHTML = `
                    <td class="px-6 py-4 font-semibold text-slate-800 nome-produto"></td>
                    <td class="px-6 py-4 text-center">
                        <span class="font-bold ${baixo ? 'text-rose-600 bg-rose-50 px-3 py-1 rounded-lg' : 'text-slate-700'}">
                            ${escapeHTML(p.quantidade)}${baixo ? ' <span class="text-xs">⚠️ Baixo</span>' : ''}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right text-slate-600">${escapeHTML(formatMoeda(p.preco_custo))}</td>
                    <td class="px-6 py-4 text-right font-semibold text-emerald-600">${escapeHTML(formatMoeda(p.preco_venda))}</td>
                    <td class="px-6 py-4 text-center">
                        <div class="flex justify-center gap-2">
                            <button data-edit="${p.id}" class="w-9 h-9 flex items-center justify-center bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition-colors" title="Editar">
                                <i class="ph-bold ph-pencil-simple"></i>
                            </button>
                            <button data-del="${p.id}" class="w-9 h-9 flex items-center justify-center bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors" title="Excluir">
                                <i class="ph-bold ph-trash"></i>
                            </button>
                        </div>
                    </td>`;
                tr.querySelector('.nome-produto').textContent = p.nome;
                tr.querySelector('[data-edit]').addEventListener('click', () => _abrirEditar(p.id));
                tr.querySelector('[data-del]').addEventListener('click', () => _deletar(p.id));
                tbody.appendChild(tr);
            });
        }

        _setText('estoque-total-itens', _produtos.length);
        _setText('estoque-valor-custo', formatMoeda(totalCusto));
        _setText('estoque-valor-venda', formatMoeda(totalVenda));
    } catch (e) {
        console.error('Erro ao carregar estoque:', e);
        toast('Erro ao carregar estoque', 'error');
    }
}

function _abrirEditar(id) {
    const p = _produtos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('produtoEditandoId').value = p.id;
    document.getElementById('inputProdutoNome').value = p.nome;
    document.getElementById('inputProdutoQtd').value = p.quantidade;
    document.getElementById('inputProdutoCusto').value = p.preco_custo;
    document.getElementById('inputProdutoVenda').value = p.preco_venda;
    document.getElementById('modalProdutoTitulo').textContent = 'Editar Produto';
    document.getElementById('modalNovoProduto')?.classList.remove('hidden');
}

async function _deletar(id) {
    const ok = await confirmar('Confirma a exclusão deste produto do estoque?', 'Excluir');
    if (!ok) return;
    try {
        await Produtos.excluir(id);
        toast('Produto excluído.', 'success');
        loadEstoque();
    } catch (e) {
        toast(`Erro ao excluir: ${e.message}`, 'error');
    }
}

export async function salvarProduto() {
    const editandoId = document.getElementById('produtoEditandoId')?.value;
    const body = {
        nome:       document.getElementById('inputProdutoNome')?.value.trim(),
        quantidade: parseInt(document.getElementById('inputProdutoQtd')?.value) || 0,
        preco_custo: parseFloat(document.getElementById('inputProdutoCusto')?.value) || 0,
        preco_venda: parseFloat(document.getElementById('inputProdutoVenda')?.value) || 0,
    };
    if (!body.nome) { toast('Informe o nome do produto.', 'warning'); return; }
    try {
        if (editandoId) {
            await Produtos.atualizar(editandoId, body);
            toast('Produto atualizado!', 'success');
        } else {
            await Produtos.criar(body);
            toast('Produto cadastrado!', 'success');
        }
        document.getElementById('modalNovoProduto')?.classList.add('hidden');
        _resetModalProduto();
        loadEstoque();
    } catch (e) {
        toast(`Erro ao salvar produto: ${e.message}`, 'error');
    }
}

function _resetModalProduto() {
    document.getElementById('produtoEditandoId').value = '';
    document.getElementById('inputProdutoNome').value = '';
    document.getElementById('inputProdutoQtd').value = '0';
    document.getElementById('inputProdutoCusto').value = '';
    document.getElementById('inputProdutoVenda').value = '';
    if (document.getElementById('modalProdutoTitulo'))
        document.getElementById('modalProdutoTitulo').textContent = 'Novo Produto';
}

// ==================== PDV RÁPIDO ====================
export function loadPDV() {
    const grid = document.getElementById('pdv-grid-produtos');
    if (!grid) return;
    grid.innerHTML = '';

    if (_produtos.length === 0) {
        grid.innerHTML = '<p class="col-span-3 text-slate-400 text-sm text-center py-8">Nenhum produto no estoque. Cadastre produtos na aba "Estoque" primeiro.</p>';
        return;
    }

    _produtos.forEach(p => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl p-4 text-left transition-all active:scale-95 ${p.quantidade === 0 ? 'opacity-40 cursor-not-allowed' : ''}`;
        card.disabled = p.quantidade === 0;
        // textContent para evitar XSS nos nomes dos produtos
        const nomeEl = document.createElement('p');
        nomeEl.className = 'font-semibold text-slate-800 text-sm leading-tight';
        nomeEl.textContent = p.nome;
        card.appendChild(nomeEl);
        card.insertAdjacentHTML('beforeend', `
            <p class="text-indigo-600 font-bold mt-1">${escapeHTML(formatMoeda(p.preco_venda))}</p>
            <p class="text-slate-400 text-xs mt-1">${escapeHTML(p.quantidade)} em estoque</p>
        `);
        card.addEventListener('click', () => _adicionarAoCarrinho(p));
        grid.appendChild(card);
    });

    _renderCarrinho();
}

function _adicionarAoCarrinho(produto) {
    const existente = _carrinhoItens.find(i => i.produto_id === produto.id);
    if (existente) {
        if (existente.quantidade >= produto.quantidade) {
            toast(`Estoque insuficiente para "${produto.nome}"`, 'warning');
            return;
        }
        existente.quantidade++;
    } else {
        _carrinhoItens.push({ produto_id: produto.id, nome: produto.nome, preco: produto.preco_venda, quantidade: 1, estoque_max: produto.quantidade });
    }
    _renderCarrinho();
}

function _renderCarrinho() {
    const container = document.getElementById('pdv-carrinho');
    const vazio     = document.getElementById('pdv-carrinho-vazio');
    const totalEl   = document.getElementById('pdv-total');
    if (!container) return;

    container.querySelectorAll('.carrinho-item').forEach(el => el.remove());

    if (_carrinhoItens.length === 0) {
        if (vazio) vazio.style.display = 'block';
        if (totalEl) totalEl.textContent = 'R$ 0,00';
        return;
    }
    if (vazio) vazio.style.display = 'none';

    let total = 0;
    _carrinhoItens.forEach((item, i) => {
        total += item.preco * item.quantidade;
        const div = document.createElement('div');
        div.className = 'carrinho-item flex justify-between items-center bg-slate-50 rounded-xl px-4 py-3 border border-slate-100';
        const nomeEl = document.createElement('p');
        nomeEl.className = 'font-semibold text-slate-800 text-sm';
        nomeEl.textContent = item.nome;
        div.innerHTML = `
            <div><div class="item-nome-placeholder"></div><p class="text-indigo-600 text-sm">${escapeHTML(formatMoeda(item.preco))} × ${item.quantidade}</p></div>
            <div class="flex items-center gap-2">
                <button data-idx="${i}" data-delta="-1" class="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors text-lg font-bold">−</button>
                <span class="font-bold w-4 text-center">${item.quantidade}</span>
                <button data-idx="${i}" data-delta="1" class="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 transition-colors text-lg font-bold">+</button>
            </div>`;
        div.querySelector('.item-nome-placeholder').replaceWith(nomeEl);
        div.querySelectorAll('button[data-delta]').forEach(btn => {
            btn.addEventListener('click', () => _ajustarQtd(parseInt(btn.dataset.idx), parseInt(btn.dataset.delta)));
        });
        container.appendChild(div);
    });
    if (totalEl) totalEl.textContent = formatMoeda(total);
}

function _ajustarQtd(index, delta) {
    const item = _carrinhoItens[index];
    item.quantidade += delta;
    if (item.quantidade <= 0) _carrinhoItens.splice(index, 1);
    else if (item.quantidade > item.estoque_max) {
        item.quantidade = item.estoque_max;
        toast(`Estoque máximo de "${item.nome}" atingido.`, 'warning');
    }
    _renderCarrinho();
}

export function limparCarrinho() {
    _carrinhoItens = [];
    _renderCarrinho();
}

export async function finalizarVenda() {
    if (_carrinhoItens.length === 0) { toast('Adicione ao menos um item ao carrinho.', 'warning'); return; }
    const btn = document.getElementById('btnFinalizarVenda');
    btn.textContent = 'Processando...';
    btn.disabled = true;
    try {
        const data = await PDV.venda(_carrinhoItens.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade })));
        toast(`Venda finalizada! Total: ${formatMoeda(data.total)}`, 'success');
        _carrinhoItens = [];
        loadEstoque();
        loadPDV();
    } catch (e) {
        toast(`Erro na venda: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = '<i class="ph-bold ph-check-circle"></i> Finalizar Venda';
        btn.disabled = false;
    }
}

function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
