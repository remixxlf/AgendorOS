/**
 * cycle.js — Controle global de ciclo mensal
 * Exporta o estado compartilhado e funções de navegação entre meses.
 */

import { toast } from './utils.js';

export const NOMES_MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const hojeData = new Date();

// Estado reativo compartilhado entre módulos
export const currentCycle = {
    mes: hojeData.getMonth() + 1,
    ano: hojeData.getFullYear()
};

// Callbacks para notificar módulos quando o ciclo muda
const _listeners = [];

export function onCycleChange(callback) {
    _listeners.push(callback);
}

export function atualizarTextoCiclo() {
    const texto = `${NOMES_MESES[currentCycle.mes - 1]} de ${currentCycle.ano}`;
    const ids = ['nome-ciclo-mensal-dash', 'nome-ciclo-mensal-os', 'nome-ciclo-mensal-comis', 'nome-ciclo-mensal-rel'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = texto;
    });
}

export async function alterarCicloMensal(delta) {
    let novoMes = currentCycle.mes + delta;
    let novoAno = currentCycle.ano;
    if (novoMes > 12) { novoMes = 1; novoAno++; }
    else if (novoMes < 1) { novoMes = 12; novoAno--; }
    currentCycle.mes = novoMes;
    currentCycle.ano = novoAno;
    atualizarTextoCiclo();
    // Notifica todos os módulos registrados
    for (const fn of _listeners) {
        await fn(currentCycle);
    }
}

// Expõe para chamadas via onclick no HTML
window.alterarCicloMensal = alterarCicloMensal;
