# Regras de Autocorreção e Qualidade (Custom Rule)

REGRA CRÍTICA PARA O AGENTE (Antigravity):
A partir deste momento, antes de finalizar QUALQUER alteração de código, criar um novo arquivo ou fornecer uma resposta conclusiva, você DEVE, obrigatoriamente:

1. Criar um bloco de pensamento explícito e interno (`<thought>`).
2. Revisar a sua própria lógica gerada no mínimo **3 vezes**.
3. Durante essa revisão, você deve procurar ativamente por:
   - Falhas de Segurança (ex: XSS, injeção de SQL, vazamento de dados).
   - Bugs Lógicos (ex: variáveis nulas, tipagem errada, erros de assincronicidade/Promises, escopo de variáveis).
   - Problemas de Performance (ex: loops desnecessários, renderizações excessivas no DOM, vazamento de memória).
   - Arquitetura e Clean Code (ex: o código está modularizado e legível?).
4. Você só deve realizar a chamada final de ferramenta (tool call) de entrega ou emitir a resposta de texto ao usuário APÓS confirmar dentro do seu bloco de pensamento que o código está estruturalmente perfeito e cumpre todos os requisitos acima.
