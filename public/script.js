// ==================== NAVEGAÇÃO ====================
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Remover active de todos
        document.querySelectorAll('.nav-btn').forEach(b => {
            b.classList.remove('active', 'bg-indigo-600/10', 'text-indigo-400');
        });
        document.querySelectorAll('.tab-content').forEach(t => {
            t.classList.remove('active');
        });

        // Adicionar active ao clicado
        const targetId = btn.getAttribute('data-target');
        btn.classList.add('active', 'bg-indigo-600/10', 'text-indigo-400');
        document.getElementById(targetId).classList.add('active');

        // Carregar dados dependendo da aba
        if (targetId === 'os-view') carregarOS();
        if (targetId === 'tecnicos-view') loadEquipe();
        if (targetId === 'comissoes-view') loadComissoes();
        if (targetId === 'relatorios-view' || targetId === 'dashboard-view') loadFinanceiroE_Dashboard();
        if (targetId === 'config-view') loadConfig();
    });
});

// ==================== DASHBOARD & FINANCEIRO ====================
let chartInstance = null;

async function loadFinanceiroE_Dashboard() {
    try {
        const res = await fetch('/api/financeiro/dashboard');
        const transacoes = await res.json();
        
        let fatTotal = 0, fatMes = 0, despMes = 0;
        const labels = [];
        const dadosRec = [];
        const dadosDesp = [];
        
        // Agrupar por data (simplificado)
        const dictRec = {}; const dictDesp = {};
        const hoje = new Date();
        const mesAtual = hoje.getMonth();
        const anoAtual = hoje.getFullYear();

        transacoes.forEach(t => {
            const v = parseFloat(t.valor);
            const dataT = new Date(t.data);
            
            // Faturamento Total (Toda vida) - usado em OS/Lucro? Nao, fatMês
            if (t.tipo === 'receita') fatTotal += v;
            
            if (dataT.getMonth() === mesAtual && dataT.getFullYear() === anoAtual) {
                if (t.tipo === 'receita') fatMes += v;
                if (t.tipo === 'despesa') despMes += v;
            }

            if(t.tipo === 'receita') dictRec[t.data] = (dictRec[t.data]||0) + v;
            if(t.tipo === 'despesa') dictDesp[t.data] = (dictDesp[t.data]||0) + v;
        });
        
        // Atualizar Dashboard
        document.getElementById('dash-fat-mes').textContent = `R$ ${fatMes.toFixed(2).replace('.',',')}`;
        const lucro = fatMes - despMes;
        const lucroEl = document.getElementById('dash-lucro-mes');
        lucroEl.textContent = `R$ ${lucro.toFixed(2).replace('.',',')}`;
        lucroEl.className = lucro >= 0 ? 'text-3xl font-bold text-indigo-600 relative' : 'text-3xl font-bold text-rose-600 relative';

        // Gráfico últimos 15 dias (ApexCharts)
        for(let i=14; i>=0; i--) {
            const d = new Date(); d.setDate(d.getDate()-i);
            const dStr = d.toISOString().split('T')[0];
            labels.push(dStr.split('-').reverse().slice(0,2).join('/'));
            dadosRec.push(dictRec[dStr] || 0);
            dadosDesp.push(dictDesp[dStr] || 0);
        }

        renderMainChart(labels, dadosRec, dadosDesp);
        
        // Tabela de Transações (Relatórios)
        const tbody = document.getElementById('tabela-transacoes');
        tbody.innerHTML = '';
        if (transacoes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-slate-400">Nenhuma movimentação</td></tr>';
        } else {
            [...transacoes].reverse().forEach(t => {
                const isDespesa = t.tipo === 'despesa';
                const color = isDespesa ? 'text-rose-600' : 'text-emerald-600';
                const bgIcon = isDespesa ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600';
                const icon = isDespesa ? 'ph-arrow-down-right' : 'ph-arrow-up-right';
                const sign = isDespesa ? '-' : '+';
                
                let dateStr = t.data;
                if(dateStr.includes('-')) {
                    const parts = dateStr.split('-');
                    if(parts.length === 3) dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }

                tbody.innerHTML += `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-6 py-4 whitespace-nowrap">${dateStr}</td>
                        <td class="px-6 py-4 font-medium text-slate-700">${t.descricao}</td>
                        <td class="px-6 py-4">
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${bgIcon}">
                                <i class="ph-bold ${icon}"></i> ${isDespesa ? 'Despesa' : 'Receita'}
                            </span>
                        </td>
                        <td class="px-6 py-4 text-right font-bold ${color}">${sign} R$ ${parseFloat(t.valor).toFixed(2).replace('.', ',')}</td>
                        <td class="px-6 py-4 text-center">
                            <button onclick="deletarTransacao(${t.id})" class="text-slate-400 hover:text-rose-500 transition-colors bg-white hover:bg-rose-50 p-1.5 rounded-lg border border-transparent hover:border-rose-100 shadow-sm" title="Excluir Lançamento (Estorno)">
                                <i class="ph-fill ph-trash text-base"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
        }
    } catch(e) { console.error(e); }
}

function renderMainChart(labels, receitas, despesas) {
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    var options = {
        series: [{
            name: 'Receitas',
            data: receitas
        }, {
            name: 'Despesas',
            data: despesas
        }],
        chart: {
            type: 'area',
            height: 320,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: false },
            zoom: { enabled: false }
        },
        colors: ['#6366f1', '#f43f5e'],
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] }
        },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: {
            categories: labels,
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: { formatter: (value) => "R$ " + value.toFixed(0) }
        },
        grid: {
            borderColor: '#f1f5f9',
            strokeDashArray: 4,
            yaxis: { lines: { show: true } }
        },
        legend: { position: 'top', horizontalAlign: 'right' }
    };

    chartInstance = new ApexCharts(document.querySelector("#mainChart"), options);
    chartInstance.render();
}

function renderWaffleChart(ordens) {
    // Conta ocorrências de equipamentos por palavra-chave para agrupar
    let smart = 0, note = 0, pc = 0, outros = 0;
    let total = 0;
    
    ordens.forEach(o => {
        if (o.status !== 'concluido') return;
        total++;
        const cat = o.categoria || 'outros';
        if (cat === 'smartphone') smart++;
        else if (cat === 'notebook') note++;
        else if (cat === 'pc') pc++;
        else outros++;
    });

    if (total === 0) total = 1; // Evita divisão por zero

    const pSmart = Math.round((smart / total) * 100) || 0;
    const pNote = Math.round((note / total) * 100) || 0;
    const pPc = Math.round((pc / total) * 100) || 0;
    const pOutros = 100 - (pSmart + pNote + pPc); // O resto

    const container = document.getElementById('waffle-container');
    container.innerHTML = '';
    
    let totalSquares = 100;
    for(let i=0; i<totalSquares; i++) {
        const div = document.createElement('div');
        div.className = 'waffle-cell';
        if (i < pSmart) div.style.backgroundColor = '#6366f1'; // Indigo
        else if (i < pSmart + pNote) div.style.backgroundColor = '#10b981'; // Emerald
        else if (i < pSmart + pNote + pPc) div.style.backgroundColor = '#f59e0b'; // Amber
        else div.style.backgroundColor = '#cbd5e1'; // Slate
        container.appendChild(div);
    }

    const legend = document.getElementById('waffle-legend');
    legend.innerHTML = `
        <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-indigo-500"></div><span class="text-slate-600 font-medium">Smartphones</span></div>
            <span class="font-bold text-slate-800">${pSmart}%</span>
        </div>
        <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-emerald-500"></div><span class="text-slate-600 font-medium">Notebooks</span></div>
            <span class="font-bold text-slate-800">${pNote}%</span>
        </div>
        <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-amber-500"></div><span class="text-slate-600 font-medium">Desktops / PCs</span></div>
            <span class="font-bold text-slate-800">${pPc}%</span>
        </div>
        <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2"><div class="w-3 h-3 rounded-full bg-slate-300"></div><span class="text-slate-600 font-medium">Outros / Vendas</span></div>
            <span class="font-bold text-slate-800">${pOutros}%</span>
        </div>
    `;
}

// Lançar Despesa
document.getElementById('btnAddDespesa').addEventListener('click', async () => {
    const descricao = document.getElementById('inputDespesaDesc').value.trim();
    const valor = document.getElementById('inputDespesaValor').value.trim();
    if(!descricao || !valor) return;
    
    const data = new Date().toISOString().split('T')[0];
    await fetch('/api/despesas', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ descricao, valor: parseFloat(valor.replace(',','.')), data })
    });
    
    document.getElementById('inputDespesaDesc').value = '';
    document.getElementById('inputDespesaValor').value = '';
    document.getElementById('modalNovaDespesa').classList.add('hidden');
    loadFinanceiroE_Dashboard();
});

// Lançar Receita Avulsa
document.getElementById('btnAddReceita').addEventListener('click', async () => {
    const descricao = document.getElementById('inputReceitaDesc').value.trim();
    const valor = document.getElementById('inputReceitaValor').value.trim();
    if(!descricao || !valor) return;
    
    const data = new Date().toISOString().split('T')[0];
    await fetch('/api/receitas', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ descricao, valor: parseFloat(valor.replace(',','.')), data })
    });
    
    document.getElementById('inputReceitaDesc').value = '';
    document.getElementById('inputReceitaValor').value = '';
    document.getElementById('modalNovaReceita').classList.add('hidden');
    loadFinanceiroE_Dashboard();
});

// Excluir Transação (Estorno)
let transacaoIdParaExcluir = null;

function deletarTransacao(id) {
    transacaoIdParaExcluir = id;
    document.getElementById('modalConfirmarExclusao').classList.remove('hidden');
}

document.getElementById('btnConfirmarExclusaoTransacao').addEventListener('click', async () => {
    if(!transacaoIdParaExcluir) return;
    const btn = document.getElementById('btnConfirmarExclusaoTransacao');
    const txtOriginal = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Excluindo...';
    
    await fetch(`/api/transacoes/${transacaoIdParaExcluir}`, { method: 'DELETE' });
    
    document.getElementById('modalConfirmarExclusao').classList.add('hidden');
    btn.innerHTML = txtOriginal;
    transacaoIdParaExcluir = null;
    loadFinanceiroE_Dashboard();
});

// ==================== ORDENS DE SERVIÇO ====================
async function carregarOS() {
    try {
        const res = await fetch('/api/os');
        const ordens = await res.json();
        
        const colR = document.getElementById('colRecebido');
        const colA = document.getElementById('colAndamento');
        const colC = document.getElementById('colConcluido');
        
        colR.innerHTML = ''; colA.innerHTML = ''; colC.innerHTML = '';
        
        let cR = 0, cA = 0, cC = 0;

        ordens.forEach(os => {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col gap-3 group transition-shadow hover:shadow-md cursor-default';
            
            let actions = '';
            let statusBadge = '';
            
            if (os.status === 'recebido') {
                cR++;
                statusBadge = '<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Aguardando</span>';
                actions = `
                    <div class="flex gap-2 mt-2 pt-3 border-t border-slate-100">
                        <button onclick="mudarStatusOS(${os.id}, 'em_andamento')" class="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-lg text-sm font-semibold transition-colors flex justify-center items-center gap-1.5"><i class="ph-bold ph-arrow-right"></i> Bancada</button>
                        <button onclick="abrirModalImprimir(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"><i class="ph-bold ph-printer"></i></button>
                    </div>`;
            } else if (os.status === 'em_andamento') {
                cA++;
                statusBadge = '<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Analisando</span>';
                actions = `
                    <div class="flex gap-2 mt-2 pt-3 border-t border-slate-100">
                        <button onclick="abrirModalConcluir(${os.id})" class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 py-2 rounded-lg text-sm font-semibold transition-colors flex justify-center items-center gap-1.5"><i class="ph-bold ph-check"></i> Finalizar</button>
                        <button onclick="abrirModalImprimir(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"><i class="ph-bold ph-printer"></i></button>
                    </div>`;
            } else if (os.status === 'concluido') {
                cC++;
                statusBadge = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Pronto</span>';
                actions = `
                    <div class="flex justify-between items-center mt-2 pt-3 border-t border-slate-100">
                        <div class="font-bold text-emerald-600">R$ ${os.valor}</div>
                        <button onclick="abrirModalImprimir(${os.id})" class="w-10 h-10 flex justify-center items-center bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"><i class="ph-bold ph-printer"></i></button>
                    </div>`;
            }

            card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-slate-400">#${os.id}</span>
                    ${statusBadge}
                </div>
                <div>
                    <h3 class="font-bold text-slate-800 text-lg leading-tight">${os.equipamento}</h3>
                    <div class="flex items-center gap-1.5 text-slate-500 text-sm mt-1">
                        <i class="ph-fill ph-user text-slate-400"></i> ${os.cliente_nome}
                    </div>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-sm text-slate-600">
                    <span class="font-semibold text-slate-700">Defeito:</span> ${os.problema || 'Não informado'}
                </div>
                ${os.solucao ? `<div class="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100/50 text-sm text-emerald-700"><span class="font-semibold">Solução:</span> ${os.solucao}</div>` : ''}
                ${actions}
            `;

            if (os.status === 'recebido') colR.appendChild(card);
            if (os.status === 'em_andamento') colA.appendChild(card);
            if (os.status === 'concluido') colC.appendChild(card);
        });

        document.getElementById('count-recebido').textContent = cR;
        document.getElementById('count-andamento').textContent = cA;
        document.getElementById('count-concluido').textContent = cC;
        
        // Atualiza Dashboard com OS
        document.getElementById('dash-os-hoje').textContent = cR + cA + cC; // Total geral ou poderia ser só hoje
        document.getElementById('dash-os-bancada').textContent = cA;

        // Atualiza o Waffle
        renderWaffleChart(ordens);

    } catch (e) { console.error(e); }
}

// Criar Nova OS
document.getElementById('btnSalvarNovaOS').addEventListener('click', async () => {
    const data = {
        cliente_nome: document.getElementById('osNome').value.trim(),
        cliente_telefone: document.getElementById('osZap').value.trim(),
        equipamento: document.getElementById('osEqp').value.trim(),
        categoria: document.getElementById('osCat').value,
        problema: document.getElementById('osProb').value.trim()
    };
    if(!data.cliente_nome || !data.equipamento) return alert('Preencha pelo menos Nome e Equipamento.');
    
    const btn = document.getElementById('btnSalvarNovaOS');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Criando...';
    
    await fetch('/api/os', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
    });
    
    document.getElementById('modalNovaOS').classList.add('hidden');
    document.getElementById('osNome').value = '';
    document.getElementById('osZap').value = '';
    document.getElementById('osEqp').value = '';
    document.getElementById('osProb').value = '';
    btn.innerHTML = 'Criar OS';
    carregarOS();
});

// Alterar Status Simples
async function mudarStatusOS(id, novoStatus) {
    await fetch(`/api/os/${id}/status`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ status: novoStatus })
    });
    carregarOS();
}

// Concluir OS
let osAtualConcluir = null;
async function abrirModalConcluir(id) {
    osAtualConcluir = id;
    const select = document.getElementById('concTecnico');
    select.innerHTML = '<option value="">Carregando...</option>';
    
    const res = await fetch('/api/tecnicos');
    const tecnicos = await res.json();
    select.innerHTML = '<option value="">Selecione o técnico...</option>';
    tecnicos.forEach(t => {
        select.innerHTML += `<option value="${t.id}">${t.nome}</option>`;
    });
    
    document.getElementById('modalConcluirOS').classList.remove('hidden');
}

document.getElementById('btnSalvarConclusao').addEventListener('click', async () => {
    const solucao = document.getElementById('concSolucao').value.trim();
    const tecnico_id = document.getElementById('concTecnico').value;
    const valor = document.getElementById('concValor').value.trim();
    const gerarFinanceiro = document.getElementById('concGerarFinanceiro').checked;
    
    if(!tecnico_id || !valor) return alert('Preencha Técnico e Valor.');
    
    const btn = document.getElementById('btnSalvarConclusao');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Concluindo...';
    
    await fetch(`/api/os/${osAtualConcluir}/concluir`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ solucao, tecnico_id, valor: parseFloat(valor.replace(',','.')), gerar_financeiro: gerarFinanceiro })
    });
    
    document.getElementById('modalConcluirOS').classList.add('hidden');
    document.getElementById('concSolucao').value = '';
    document.getElementById('concValor').value = '';
    document.getElementById('concGerarFinanceiro').checked = true; // resetar
    btn.innerHTML = 'Faturar';
    carregarOS();
    loadFinanceiroE_Dashboard(); // Atualiza dashboard caso tenha gerado financeiro
});

// ==================== EQUIPE ====================
async function loadEquipe() {
    const grid = document.getElementById('grid-tecnicos');
    grid.innerHTML = '<p class="text-slate-400">Carregando...</p>';
    try {
        const res = await fetch('/api/tecnicos');
        const tecnicos = await res.json();
        grid.innerHTML = '';
        tecnicos.forEach(t => {
            grid.innerHTML += `
                <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col items-center text-center relative group overflow-hidden">
                    <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="deletarTecnico(${t.id})" class="text-slate-300 hover:text-rose-500 transition-colors"><i class="ph-fill ph-trash text-lg"></i></button>
                    </div>
                    <div class="w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-2xl mb-4 shrink-0">
                        <i class="ph-fill ph-user"></i>
                    </div>
                    <h3 class="font-bold text-slate-800 text-lg">${t.nome}</h3>
                    <p class="text-indigo-600 font-medium text-sm mt-1 bg-indigo-50 px-3 py-1 rounded-full">${t.comissao}% de Comissão</p>
                </div>
            `;
        });
    } catch(e){}
}

document.getElementById('btnAddTecnico').addEventListener('click', async () => {
    const nome = document.getElementById('inputNomeTecnico').value.trim();
    const comissao = document.getElementById('inputComissaoTecnico').value.trim();
    if(!nome) return;
    
    const btn = document.getElementById('btnAddTecnico');
    btn.innerHTML = '...';
    
    await fetch('/api/tecnicos', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ nome, comissao: comissao || 0 })
    });
    
    document.getElementById('inputNomeTecnico').value = '';
    document.getElementById('inputComissaoTecnico').value = '';
    document.getElementById('modalNovoTecnico').classList.add('hidden');
    btn.innerHTML = 'Cadastrar';
    loadEquipe();
});

async function deletarTecnico(id) {
    if(confirm('Tem certeza que deseja apagar este técnico?')) {
        await fetch(`/api/tecnicos/${id}`, {method: 'DELETE'});
        loadEquipe();
    }
}

// ==================== COMISSÕES ====================
async function loadComissoes() {
    const grid = document.getElementById('grid-comissoes');
    grid.innerHTML = '<div class="col-span-3 text-center py-10"><i class="ph ph-spinner animate-spin text-3xl text-indigo-500 mb-2"></i><p class="text-slate-500">Calculando comissões...</p></div>';
    
    try {
        const res = await fetch('/api/tecnicos/comissoes');
        const comissoes = await res.json();
        
        if (comissoes.length === 0) {
            grid.innerHTML = '<div class="col-span-3 text-center text-slate-400 py-10">Nenhum técnico cadastrado.</div>';
            return;
        }

        grid.innerHTML = '';
        comissoes.forEach(c => {
            const faturamento = c.faturamento_gerado || 0;
            const aReceber = c.valor_receber || 0;
            const osCount = c.total_os || 0;
            
            grid.innerHTML += `
                <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all">
                    <div class="flex items-center gap-4 mb-5 border-b border-slate-100 pb-4">
                        <div class="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl shrink-0">
                            <i class="ph-fill ph-user-focus"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-slate-800 text-lg">${c.nome}</h3>
                            <p class="text-slate-500 text-sm font-medium">Comissão Base: <span class="text-indigo-600">${c.comissao}%</span></p>
                        </div>
                    </div>
                    
                    <div class="space-y-4">
                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 text-sm">Serviços Concluídos:</span>
                            <span class="font-semibold text-slate-700">${osCount} OS</span>
                        </div>
                        
                        <div class="flex justify-between items-center">
                            <span class="text-slate-500 text-sm">Faturamento Gerado:</span>
                            <span class="font-medium text-emerald-600">R$ ${faturamento.toFixed(2).replace('.', ',')}</span>
                        </div>
                        
                        <div class="pt-4 border-t border-slate-100 flex justify-between items-end">
                            <span class="text-slate-700 font-medium">A Receber no Mês:</span>
                            <span class="text-2xl font-bold text-indigo-600">R$ ${aReceber.toFixed(2).replace('.', ',')}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    } catch(e) {
        console.error(e);
        grid.innerHTML = '<p class="text-rose-500">Erro ao carregar comissões.</p>';
    }
}

// ==================== CONFIGURAÇÕES ====================
async function loadConfig() {
    try {
        const res = await fetch('/api/configuracoes');
        const cfg = await res.json();

        // Loja
        document.getElementById('config-nome-negocio').value = cfg['nome_negocio'] || '';

        // Notificações Ativas
        document.getElementById('config-msg-bancada').value = cfg['msg_bancada'] || '';
        document.getElementById('config-msg-os-pronta').value = cfg['msg_os_pronta'] || '';

        // Menu Receptivo
        document.getElementById('config-msg-saudacao').value = cfg['msg_saudacao'] || '';
        document.getElementById('config-msg-menu-opcoes').value = cfg['msg_menu_opcoes'] || '';
        document.getElementById('config-msg-pedir-os').value = cfg['msg_pedir_os'] || '';
        document.getElementById('config-msg-os-status').value = cfg['msg_os_status'] || '';
        document.getElementById('config-msg-atendente').value = cfg['msg_atendente'] || '';

        // Erros
        document.getElementById('config-msg-erro-opcao').value = cfg['msg_erro_opcao_invalida'] || '';
        document.getElementById('config-msg-erro-formato').value = cfg['msg_erro_formato_os'] || '';
        document.getElementById('config-msg-erro-os').value = cfg['msg_erro_os_nao_encontrada'] || '';
    } catch(e) { console.error(e); }
}

document.getElementById('btnSalvarConfigGeral').addEventListener('click', async () => {
    const btn = document.getElementById('btnSalvarConfigGeral');
    btn.innerHTML = '<i class="ph ph-spinner animate-spin text-xl"></i> Salvando...';

    const payload = {
        'nome_negocio':             document.getElementById('config-nome-negocio').value.trim(),
        'msg_bancada':              document.getElementById('config-msg-bancada').value,
        'msg_os_pronta':            document.getElementById('config-msg-os-pronta').value,
        'msg_saudacao':             document.getElementById('config-msg-saudacao').value,
        'msg_menu_opcoes':          document.getElementById('config-msg-menu-opcoes').value,
        'msg_pedir_os':             document.getElementById('config-msg-pedir-os').value,
        'msg_os_status':            document.getElementById('config-msg-os-status').value,
        'msg_atendente':            document.getElementById('config-msg-atendente').value,
        'msg_erro_opcao_invalida':  document.getElementById('config-msg-erro-opcao').value,
        'msg_erro_formato_os':      document.getElementById('config-msg-erro-formato').value,
        'msg_erro_os_nao_encontrada': document.getElementById('config-msg-erro-os').value,
    };

    await fetch('/api/configuracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    setTimeout(() => {
        btn.innerHTML = '<i class="ph-fill ph-floppy-disk text-xl"></i> Salvar Todas as Configurações';
    }, 600);
});

// ==================== IMPRESSÃO ====================
async function abrirModalImprimir(id) {
    const res = await fetch('/api/os');
    const todas = await res.json();
    const os = todas.find(o => o.id === id);
    if (!os) return;

    const configRes = await fetch('/api/configuracoes/nome');
    const configData = await configRes.json();
    const nomeNegocio = configData.nome || 'Assistência Técnica';

    const statusMap = { recebido: 'Recebido', em_andamento: 'Em Bancada', concluido: 'Concluído' };
    const statusLabel = statusMap[os.status] || os.status;
    const dataCriacao = os.data_criacao || new Date().toLocaleDateString('pt-BR');

    const html = `
      <div class="print-header">
        <div class="print-logo">
          ${nomeNegocio}
          <small>Ordem de Serviço Oficial</small>
        </div>
        <div class="print-os-num">
          #${os.id}
          <small>Data: ${dataCriacao}</small>
        </div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Dados do Cliente</div>
        <div class="print-row">
          <div class="print-field"><label>Nome</label><span>${os.cliente_nome}</span></div>
          <div class="print-field"><label>WhatsApp</label><span>${os.cliente_telefone || 'Não informado'}</span></div>
        </div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Equipamento</div>
        <div class="print-row">
          <div class="print-field"><label>Modelo</label><span>${os.equipamento}</span></div>
          <div class="print-field"><label>Status</label><span>${statusLabel}</span></div>
        </div>
      </div>

      <div class="print-section">
        <div class="print-section-title">Defeito Relatado</div>
        <div class="print-problema">${os.problema || 'Nenhum problema descrito.'}</div>
      </div>

      ${os.solucao ? `
      <div class="print-section">
        <div class="print-section-title">Solução Aplicada</div>
        <div class="print-solucao">${os.solucao}</div>
      </div>` : ''}

      <div class="print-footer">
        <div class="print-assinatura">
          <div class="print-assinatura-linha"></div>
          <small>Assinatura do Cliente</small>
        </div>
        ${os.valor ? `
        <div class="print-valor-destaque">
          R$ ${parseFloat(os.valor).toFixed(2).replace('.',',')}
          <small>Valor Total</small>
        </div>` : '<div></div>'}
        <div class="print-assinatura">
          <div class="print-assinatura-linha"></div>
          <small>Assinatura do Técnico</small>
        </div>
      </div>
    `;

    document.getElementById('printArea').innerHTML = html;
    
    // Pequeno delay para garantir o render antes da impressora
    setTimeout(() => {
        window.print();
    }, 100);
}

// ==================== INICIALIZAÇÃO ====================
(() => {
    carregarOS();
    loadFinanceiroE_Dashboard();
    
    // Conexão IPC com o Bot do Electron
    if(window.require) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('update-status', (event, data) => {
            if(data.type === 'bot') {
                const dot = document.getElementById('bot-status-dot');
                const text = document.getElementById('bot-status-text');
                text.textContent = data.msg;
                if(data.msg.includes('ONLINE')) {
                    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
                } else {
                    dot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]';
                }
            }
        });
    }
})();
