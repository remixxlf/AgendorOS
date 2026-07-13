// DOM
const navOS = document.getElementById('navOS');
const navFinanceiro = document.getElementById('navFinanceiro');
const navEquipe = document.getElementById('navEquipe');

const sectionOS = document.getElementById('sectionOS');
const sectionFinanceiro = document.getElementById('sectionFinanceiro');
const sectionEquipe = document.getElementById('sectionEquipe');

const colRecebido = document.getElementById('colRecebido');
const colAndamento = document.getElementById('colAndamento');
const colConcluido = document.getElementById('colConcluido');
const badgeRecebido = document.getElementById('badgeRecebido');
const badgeAndamento = document.getElementById('badgeAndamento');
const badgeConcluido = document.getElementById('badgeConcluido');

const modalNovaOS = document.getElementById('modalNovaOS');
const modalConcluirOS = document.getElementById('modalConcluirOS');

// Tabs
function switchTab(activeNav, activeSection) {
  [navOS, navFinanceiro, navEquipe].forEach(n => n.classList.remove('active'));
  [sectionOS, sectionFinanceiro, sectionEquipe].forEach(s => s.style.display = 'none');
  activeNav.classList.add('active');
  activeSection.style.display = 'block';
}

navOS.addEventListener('click', () => { switchTab(navOS, sectionOS); carregarOS(); });
navFinanceiro.addEventListener('click', () => { switchTab(navFinanceiro, sectionFinanceiro); loadFinanceiro(); });
navEquipe.addEventListener('click', () => { switchTab(navEquipe, sectionEquipe); loadEquipe(); });

// ==================== OS LOGIC ====================
async function carregarOS() {
    try {
        const res = await fetch('/api/os');
        const ordens = await res.json();
        
        colRecebido.innerHTML = '';
        colAndamento.innerHTML = '';
        colConcluido.innerHTML = '';
        
        let cR = 0, cA = 0, cC = 0;

        ordens.forEach(os => {
            const card = document.createElement('div');
            card.className = 'os-card';
            
            let actions = '';
            if (os.status === 'recebido') {
                cR++;
                actions = `<div class="os-actions">
                    <button class="btn-action next" onclick="mudarStatusOS(${os.id}, 'em_andamento')">Passar para Bancada ➔</button>
                </div>`;
            } else if (os.status === 'em_andamento') {
                cA++;
                actions = `<div class="os-actions">
                    <button class="btn-action next" onclick="abrirModalConcluir(${os.id})">✅ Finalizar Serviço</button>
                </div>`;
            } else if (os.status === 'concluido') {
                cC++;
                actions = `<div class="os-actions" style="justify-content:space-between; color:var(--text-muted); font-size:0.75rem;">
                    <span>R$ ${os.valor}</span>
                    <span>Entregue</span>
                </div>`;
            }

            card.innerHTML = `
                <div class="os-id">OS #${os.id}</div>
                <div class="os-equipamento">${os.equipamento}</div>
                <div class="os-cliente">👤 ${os.cliente_nome} <br>📞 ${os.cliente_telefone || 'Sem contato'}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:8px;"><strong>Defeito:</strong> ${os.problema}</div>
                ${os.solucao ? `<div style="font-size:0.8rem; color:var(--accent); margin-bottom:8px;"><strong>Solução:</strong> ${os.solucao}</div>` : ''}
                ${actions}
            `;

            if (os.status === 'recebido') colRecebido.appendChild(card);
            if (os.status === 'em_andamento') colAndamento.appendChild(card);
            if (os.status === 'concluido') colConcluido.appendChild(card);
        });

        badgeRecebido.textContent = cR;
        badgeAndamento.textContent = cA;
        badgeConcluido.textContent = cC;

    } catch (e) { console.error(e); }
}

// Criar Nova OS
document.getElementById('btnNovaOS').addEventListener('click', () => modalNovaOS.classList.add('ativo'));

document.getElementById('btnSalvarNovaOS').addEventListener('click', async () => {
    const data = {
        cliente_nome: document.getElementById('osNome').value.trim(),
        cliente_telefone: document.getElementById('osZap').value.trim(),
        equipamento: document.getElementById('osEqp').value.trim(),
        problema: document.getElementById('osProb').value.trim()
    };
    if(!data.cliente_nome || !data.equipamento) return alert('Preencha pelo menos Nome e Equipamento.');
    
    await fetch('/api/os', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(data)
    });
    
    modalNovaOS.classList.remove('ativo');
    document.getElementById('osNome').value = '';
    document.getElementById('osZap').value = '';
    document.getElementById('osEqp').value = '';
    document.getElementById('osProb').value = '';
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
    
    modalConcluirOS.classList.add('ativo');
}

document.getElementById('btnSalvarConclusao').addEventListener('click', async () => {
    const solucao = document.getElementById('concSolucao').value.trim();
    const tecnico_id = document.getElementById('concTecnico').value;
    const valor = document.getElementById('concValor').value.trim();
    
    if(!tecnico_id || !valor) return alert('Preencha Técnico e Valor.');
    
    await fetch(`/api/os/${osAtualConcluir}/concluir`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ solucao, tecnico_id, valor: parseFloat(valor.replace(',','.')) })
    });
    
    modalConcluirOS.classList.remove('ativo');
    document.getElementById('concSolucao').value = '';
    document.getElementById('concValor').value = '';
    carregarOS();
});

// ==================== EQUIPE ====================
async function loadEquipe() {
    const lista = document.getElementById('listaTecnicos');
    lista.innerHTML = 'Carregando...';
    try {
        const res = await fetch('/api/tecnicos');
        const tecnicos = await res.json();
        lista.innerHTML = '';
        tecnicos.forEach(t => {
            lista.innerHTML += `<li style="background:var(--bg-elevated); padding:10px 15px; border-radius:8px; display:flex; justify-content:space-between;">
                <span>${t.nome} <small style="color:var(--accent)">(${t.comissao}% comissão)</small></span>
                <button style="background:none; border:none; color:var(--danger); cursor:pointer;" onclick="deletarTecnico(${t.id})">Excluir</button>
            </li>`;
        });
    } catch(e){}
}
document.getElementById('btnAddTecnico').addEventListener('click', async () => {
    const nome = document.getElementById('inputNomeTecnico').value.trim();
    const comissao = document.getElementById('inputComissaoTecnico').value.trim();
    if(!nome) return;
    await fetch('/api/tecnicos', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ nome, comissao: comissao || 0 })
    });
    document.getElementById('inputNomeTecnico').value = '';
    document.getElementById('inputComissaoTecnico').value = '';
    loadEquipe();
});
async function deletarTecnico(id) {
    if(confirm('Apagar técnico?')) {
        await fetch(`/api/tecnicos/${id}`, {method: 'DELETE'});
        loadEquipe();
    }
}

// ==================== FINANCEIRO ====================
let chartInstance = null;
async function loadFinanceiro() {
    const res = await fetch('/api/financeiro/dashboard');
    const transacoes = await res.json();
    
    let fat = 0, desp = 0;
    const labels = [];
    const dadosRec = [];
    const dadosDesp = [];
    
    // Simplificando pra demonstração: agrupar por data real
    const dictRec = {}; const dictDesp = {};
    transacoes.forEach(t => {
        const v = parseFloat(t.valor);
        if(t.tipo === 'receita') { fat += v; dictRec[t.data] = (dictRec[t.data]||0) + v; }
        if(t.tipo === 'despesa') { desp += v; dictDesp[t.data] = (dictDesp[t.data]||0) + v; }
    });
    
    document.getElementById('finFaturamento').textContent = `R$ ${fat.toFixed(2).replace('.',',')}`;
    document.getElementById('finDespesas').textContent = `R$ ${desp.toFixed(2).replace('.',',')}`;
    const lucro = fat - desp;
    document.getElementById('finLucro').textContent = `R$ ${lucro.toFixed(2).replace('.',',')}`;
    document.getElementById('finLucro').style.color = lucro >= 0 ? 'var(--accent)' : 'var(--danger)';

    // Gráfico ultimos 7 dias
    for(let i=6; i>=0; i--) {
        const d = new Date(); d.setDate(d.getDate()-i);
        const dStr = d.toISOString().split('T')[0];
        labels.push(dStr.split('-').reverse().slice(0,2).join('/'));
        dadosRec.push(dictRec[dStr] || 0);
        dadosDesp.push(dictDesp[dStr] || 0);
    }

    const ctx = document.getElementById('financeChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    
    Chart.defaults.color = '#A0A0A0';
    Chart.defaults.font.family = "'Inter', sans-serif";
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Receita', data: dadosRec, borderColor: '#6DEAED', backgroundColor: 'rgba(109,234,237,0.1)', fill: true, tension: 0.4 },
            { label: 'Despesa', data: dadosDesp, borderColor: '#FF6B6B', backgroundColor: 'transparent', fill: false, tension: 0.4 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

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
    loadFinanceiro();
});

// Setup Inicial
(() => {
    carregarOS();
    // Atualiza status do bot (IPC se estiver rodando no Electron)
    if(window.require) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('update-status', (event, data) => {
            if(data.type === 'bot') {
                const dot = document.getElementById('statusDot');
                const text = document.getElementById('statusText');
                text.textContent = data.msg;
                if(data.msg.includes('ONLINE')) dot.className = 'status-dot online';
                else dot.className = 'status-dot';
            }
        });
    }
})();
