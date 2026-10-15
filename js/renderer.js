const { ipcRenderer } = require('electron');

let carrinho = [];
let ultimaVendaConcluida = null;
let dadosDashboardCache = null;

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// SISTEMA DE NOTIFICAÇÃO TOAST FLUTUANTE (SUBSTITUI ALERT E NÃO BLOQUEIA A TELA)
window.mostrarNotificacao = function(mensagem, tipo = 'warning') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  
  const icones = { error: '⚠️', success: '✅', warning: '🔔' };
  toast.innerHTML = `<span>${icones[tipo] || 'ℹ️'}</span> <span>${mensagem}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
};

// DESTRAVA A TELA IMEDIATAMENTE FECHANDO TODOS OS MODAIS
window.desbloquearTela = function() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.add('hidden');
    m.style.display = 'none';
  });
  document.body.style.pointerEvents = 'auto';
  
  const campoBusca = document.getElementById('campo-busca');
  const paginaCaixa = document.getElementById('page-caixa');
  if (campoBusca && paginaCaixa && paginaCaixa.classList.contains('active')) {
    setTimeout(() => {
      campoBusca.focus();
    }, 50);
  }
};

function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.remove('hidden');
    m.style.display = 'flex';
  }
}

function fecharModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.classList.add('hidden');
    m.style.display = 'none';
  }
  window.desbloquearTela();
}

// CAPTURADOR GLOBAL DE ERROS PARA EVITAR TRAVAMENTO DE TELA
window.onerror = function(msg, url, line) {
  console.error(`[Erro Front-End] ${msg} (Linha ${line})`);
  window.desbloquearTela();
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  console.error('[Promessa Rejeitada]', event.reason);
  window.desbloquearTela();
});

// PRESSIONAR 'ESC' OU CLICAR FORA DO MODAL DESTRAVA A INTERFACE
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.desbloquearTela();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const dataEl = document.getElementById('data-atual');
  if (dataEl) dataEl.innerText = new Date().toLocaleString('pt-BR');

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        window.desbloquearTela();
      }
    });
  });

  const inputBusca = document.getElementById('busca-estoque');
  const btnFiltrar = document.getElementById('btn-filtrar-estoque');
  const btnLimparEstoque = document.getElementById('btn-limpar-filtro-estoque');

  if (btnFiltrar) {
    btnFiltrar.onclick = (e) => {
      e.preventDefault();
      carregarEstoque();
    };
  }

  if (inputBusca) {
    inputBusca.oninput = () => carregarEstoque();
    inputBusca.onkeypress = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        carregarEstoque();
      }
    };
  }

  if (btnLimparEstoque) {
    btnLimparEstoque.onclick = (e) => {
      e.preventDefault();
      if (inputBusca) inputBusca.value = '';
      carregarEstoque();
    };
  }

  carregarDashboard();
});

// Navegação entre Páginas
window.navegarPara = function(pagina) {
  window.desbloquearTela();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

  const pageTarget = document.getElementById(`page-${pagina}`);
  if (pageTarget) pageTarget.classList.add('active');

  const titulos = {
    dashboard: 'Dashboard',
    caixa: 'Caixa',
    estoque: 'Estoque',
    vendas: 'Vendas'
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.innerText = titulos[pagina] || 'PDV';

  if (pagina === 'dashboard') carregarDashboard();
  if (pagina === 'vendas') carregarVendas();
  if (pagina === 'estoque') carregarEstoque();
  if (pagina === 'caixa') {
    setTimeout(() => {
      const campo = document.getElementById('campo-busca');
      if (campo) campo.focus();
    }, 100);
  }
};

// Backup da Base de Dados
const btnBackup = document.getElementById('btn-backup-db');
if (btnBackup) {
  btnBackup.addEventListener('click', async () => {
    try {
      const res = await ipcRenderer.invoke('fazer-backup');
      if (res.success) {
        window.mostrarNotificacao('Backup salvo com sucesso!', 'success');
      } else if (res.error) {
        window.mostrarNotificacao('Erro ao realizar backup: ' + res.error, 'error');
      }
    } catch (err) {
      window.mostrarNotificacao('Falha no backup: ' + err.message, 'error');
    } finally {
      window.desbloquearTela();
    }
  });
}

// Dashboard
const selectFiltroDashboard = document.getElementById('filtro-dashboard');
if (selectFiltroDashboard) {
  selectFiltroDashboard.addEventListener('change', () => carregarDashboard());
}

async function carregarDashboard() {
  try {
    const filtro = selectFiltroDashboard ? selectFiltroDashboard.value : 'todos';
    const res = await ipcRenderer.invoke('obter-dados-dashboard', filtro);
    if (res.success) {
      const d = res.data;
      dadosDashboardCache = d;

      document.getElementById('dash-faturamento').innerText = formatarMoeda(d.faturamento);
      document.getElementById('dash-lucro').innerText = formatarMoeda(d.lucro_bruto);
      document.getElementById('dash-vendas-qtd').innerText = d.qtd_vendas;
      document.getElementById('dash-ticket').innerText = formatarMoeda(d.ticket_medio);
      document.getElementById('dash-upt').innerText = (d.upt || 0).toFixed(1);
      document.getElementById('dash-valor-estoque').innerText = formatarMoeda(d.valor_estoque);

      if (d.curva_abc) {
        document.getElementById('abc-a').innerText = `${d.curva_abc.classeA} produto(s)`;
        document.getElementById('abc-b').innerText = `${d.curva_abc.classeB} produto(s)`;
        document.getElementById('abc-c').innerText = `${d.curva_abc.classeC} produto(s)`;
      }

      const containerTop = document.getElementById('dash-top-vendidos');
      if (d.top_vendidos && d.top_vendidos.length > 0) {
        const medalhas = ['🥇', '🥈', '🥉'];
        containerTop.innerHTML = d.top_vendidos.map((item, idx) => `
          <div class="dash-row">
            <div>
              <strong>${medalhas[idx] || '🎖️'} ${item.nome_produto}</strong><br>
              <span style="font-size:12px; color:#6b7280;">${item.qtd_total} un. vendida(s)</span>
            </div>
            <div style="font-weight:700; color:#2ecc71;">${formatarMoeda(item.valor_total)}</div>
          </div>
        `).join('');
      } else {
        containerTop.innerHTML = `<p style="color:#9ca3af; padding: 10px 0;">Nenhuma venda registrada no período selecionado.</p>`;
      }
    }
  } catch (err) {
    console.error('Erro ao carregar Dashboard:', err);
  }
}

// Fechamento de Caixa
const btnAbrirFechamento = document.getElementById('btn-abrir-fechamento');
if (btnAbrirFechamento) {
  btnAbrirFechamento.addEventListener('click', async () => {
    await carregarDashboard();
    if (dadosDashboardCache) {
      document.getElementById('fechamento-qtd').innerText = dadosDashboardCache.qtd_vendas;
      document.getElementById('fechamento-total').innerText = formatarMoeda(dadosDashboardCache.faturamento);
      document.getElementById('fechamento-lucro').innerText = formatarMoeda(dadosDashboardCache.lucro_bruto);
      abrirModal('modal-fechamento');
    }
  });
}

const btnImpFechamento = document.getElementById('btn-imprimir-fechamento');
if (btnImpFechamento) {
  btnImpFechamento.addEventListener('click', async () => {
    if (dadosDashboardCache) {
      await ipcRenderer.invoke('imprimir-fechamento', dadosDashboardCache);
    }
  });
}

const btnFecharFechamento = document.getElementById('btn-fechar-fechamento-modal');
if (btnFecharFechamento) {
  btnFecharFechamento.addEventListener('click', () => {
    fecharModal('modal-fechamento');
  });
}

// Caixa
const campoBusca = document.getElementById('campo-busca');
const btnAdicionarBusca = document.getElementById('btn-adicionar-busca');
const selectFormaPagamento = document.getElementById('forma-pagamento');
const secaoDinheiro = document.getElementById('secao-dinheiro');
const inputValorRecebido = document.getElementById('valor-recebido');
const inputValorDesconto = document.getElementById('valor-desconto');
const displayTroco = document.getElementById('troco-display');

if (selectFormaPagamento) {
  selectFormaPagamento.addEventListener('change', () => {
    if (selectFormaPagamento.value === 'Dinheiro') {
      secaoDinheiro.style.display = 'flex';
    } else {
      secaoDinheiro.style.display = 'none';
      inputValorRecebido.value = '';
      displayTroco.innerText = formatarMoeda(0);
    }
  });
}

if (inputValorDesconto) {
  inputValorDesconto.addEventListener('input', () => {
    atualizarCarrinho();
  });
}

function calcularTroco(totalFinal) {
  const recebido = parseFloat(inputValorRecebido.value) || 0;
  const troco = recebido > totalFinal ? recebido - totalFinal : 0;
  displayTroco.innerText = formatarMoeda(troco);
}

if (inputValorRecebido) {
  inputValorRecebido.addEventListener('input', () => {
    const subtotal = carrinho.reduce((sum, item) => sum + item.total, 0);
    const desconto = parseFloat(inputValorDesconto.value) || 0;
    const totalFinal = Math.max(0, subtotal - desconto);
    calcularTroco(totalFinal);
  });
}

async function processarBusca() {
  if (!campoBusca) return;
  const termo = campoBusca.value.trim();
  if (!termo) return;

  try {
    const res = await ipcRenderer.invoke('buscar-produto', termo);
    if (res.success && res.data.length > 0) {
      adicionarAoCarrinho(res.data[0]);
      campoBusca.value = '';
    } else {
      window.mostrarNotificacao(`Produto "${termo}" não encontrado no estoque!`, 'warning');
      campoBusca.select();
    }
  } catch (err) {
    window.mostrarNotificacao('Erro ao buscar produto: ' + err.message, 'error');
  } finally {
    setTimeout(() => {
      if (campoBusca) {
        campoBusca.focus();
        campoBusca.disabled = false;
      }
    }, 50);
  }
}

if (campoBusca) {
  campoBusca.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processarBusca();
    }
  });
}

if (btnAdicionarBusca) {
  btnAdicionarBusca.addEventListener('click', (e) => {
    e.preventDefault();
    processarBusca();
  });
}

function adicionarAoCarrinho(produto) {
  const itemExistente = carrinho.find(item => item.id === produto.id);
  if (itemExistente) {
    itemExistente.quantidade += 1;
    itemExistente.total = itemExistente.quantidade * itemExistente.preco_venda;
  } else {
    carrinho.push({
      id: produto.id,
      codigo_barras: produto.codigo_barras || 'N/A',
      nome: produto.nome,
      quantidade: 1,
      preco_venda: produto.preco_venda,
      total: produto.preco_venda
    });
  }
  atualizarCarrinho();
}

// Item Avulso
const btnAddAvulso = document.getElementById('btn-add-avulso');
if (btnAddAvulso) {
  btnAddAvulso.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      const nomeInput = document.getElementById('avulso-nome');
      const valorInput = document.getElementById('avulso-valor');
      
      const nome = nomeInput.value.trim();
      const valor = parseFloat(valorInput.value);

      if (!nome || isNaN(valor) || valor <= 0) {
        window.mostrarNotificacao('Informe a descrição e um valor maior que zero!', 'warning');
        return;
      }

      carrinho.push({
        id: null,
        codigo_barras: 'AVULSO',
        nome: nome.toUpperCase(),
        quantidade: 1,
        preco_venda: valor,
        total: valor
      });

      nomeInput.value = '';
      valorInput.value = '';
      atualizarCarrinho();
    } finally {
      setTimeout(() => {
        if (campoBusca) campoBusca.focus();
      }, 50);
    }
  });
}

window.removerItem = function(index) {
  carrinho.splice(index, 1);
  atualizarCarrinho();
};

function atualizarCarrinho() {
  const tbody = document.getElementById('lista-carrinho');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  let subtotal = 0;

  if (carrinho.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #9ca3af; padding: 25px;">Aguardando leitura de produtos...</td></tr>`;
    document.getElementById('total-venda-display').innerText = formatarMoeda(0);
    document.getElementById('subtotal-info').style.display = 'none';
    if (inputValorRecebido) inputValorRecebido.value = '';
    if (inputValorDesconto) inputValorDesconto.value = '';
    if (displayTroco) displayTroco.innerText = formatarMoeda(0);
    return;
  }

  carrinho.forEach((item, index) => {
    subtotal += item.total;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${item.nome}</strong></td>
      <td>${item.quantidade}</td>
      <td>${formatarMoeda(item.preco_venda)}</td>
      <td><strong>${formatarMoeda(item.total)}</strong></td>
      <td style="text-align: center;">
        <button onclick="removerItem(${index})" style="color:#e74c3c; background:none; border:none; cursor:pointer; font-weight:bold; font-size:16px;">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const desconto = parseFloat(inputValorDesconto.value) || 0;
  const totalFinal = Math.max(0, subtotal - desconto);

  document.getElementById('total-venda-display').innerText = formatarMoeda(totalFinal);

  if (desconto > 0) {
    document.getElementById('subtotal-info').innerText = `Subtotal: ${formatarMoeda(subtotal)} | Desconto: -${formatarMoeda(desconto)}`;
    document.getElementById('subtotal-info').style.display = 'block';
  } else {
    document.getElementById('subtotal-info').style.display = 'none';
  }

  calcularTroco(totalFinal);
}

// Finalizar Venda
document.addEventListener('keydown', (e) => {
  if (e.key === 'F9') {
    e.preventDefault();
    finalizarVendaAcao();
  }
});

const btnFinalizar = document.getElementById('btn-finalizar');
if (btnFinalizar) {
  btnFinalizar.addEventListener('click', (e) => {
    e.preventDefault();
    finalizarVendaAcao();
  });
}

async function finalizarVendaAcao() {
  if (carrinho.length === 0) {
    window.mostrarNotificacao('O carrinho está vazio!', 'warning');
    return;
  }

  try {
    const subtotal = carrinho.reduce((sum, item) => sum + item.total, 0);
    const desconto = parseFloat(inputValorDesconto.value) || 0;
    const totalFinal = Math.max(0, subtotal - desconto);
    const formaPagamento = selectFormaPagamento.value;
    const valorRecebido = parseFloat(inputValorRecebido.value) || 0;

    if (formaPagamento === 'Dinheiro' && valorRecebido < totalFinal) {
      window.mostrarNotificacao(`Valor recebido (${formatarMoeda(valorRecebido)}) é menor que o total!`, 'warning');
      if (inputValorRecebido) inputValorRecebido.focus();
      return;
    }

    const troco = formaPagamento === 'Dinheiro' ? (valorRecebido - totalFinal) : 0;

    const dadosVenda = {
      numero_venda: 'VENDA-' + Date.now(),
      subtotal: subtotal,
      desconto: desconto,
      total: totalFinal,
      forma_pagamento: formaPagamento,
      valor_recebido: valorRecebido,
      troco: troco,
      itens: [...carrinho]
    };

    const res = await ipcRenderer.invoke('finalizar-venda', dadosVenda);
    if (res.success) {
      dadosVenda.id = res.vendaId;
      ultimaVendaConcluida = dadosVenda;

      document.getElementById('modal-num-venda').innerText = `#${res.vendaId}`;
      document.getElementById('modal-pagamento').innerText = dadosVenda.forma_pagamento;
      document.getElementById('modal-total').innerText = formatarMoeda(dadosVenda.total);

      if (desconto > 0) {
        document.getElementById('modal-linha-desconto').style.display = 'flex';
        document.getElementById('modal-desconto').innerText = `- ${formatarMoeda(desconto)}`;
      } else {
        document.getElementById('modal-linha-desconto').style.display = 'none';
      }

      if (formaPagamento === 'Dinheiro' && valorRecebido > 0) {
        document.getElementById('modal-linha-recebido').style.display = 'flex';
        document.getElementById('modal-linha-troco').style.display = 'flex';
        document.getElementById('modal-recebido').innerText = formatarMoeda(valorRecebido);
        document.getElementById('modal-troco').innerText = formatarMoeda(troco);
      } else {
        document.getElementById('modal-linha-recebido').style.display = 'none';
        document.getElementById('modal-linha-troco').style.display = 'none';
      }

      abrirModal('modal-cupom');

      carrinho = [];
      if (inputValorRecebido) inputValorRecebido.value = '';
      if (inputValorDesconto) inputValorDesconto.value = '';
      if (displayTroco) displayTroco.innerText = formatarMoeda(0);
      atualizarCarrinho();
      carregarDashboard();
    } else {
      window.mostrarNotificacao('Erro ao finalizar venda: ' + res.error, 'error');
    }
  } catch (err) {
    window.mostrarNotificacao('Erro inesperado: ' + err.message, 'error');
  }
}

// Modais do Cupom
function fecharModalCupom() {
  fecharModal('modal-cupom');
}

const btnImprimirModal = document.getElementById('btn-imprimir-modal');
if (btnImprimirModal) {
  btnImprimirModal.addEventListener('click', async () => {
    if (ultimaVendaConcluida) {
      await ipcRenderer.invoke('imprimir-cupom', ultimaVendaConcluida);
    }
    fecharModalCupom();
  });
}

const btnWhatsappModal = document.getElementById('btn-whatsapp-modal');
if (btnWhatsappModal) {
  btnWhatsappModal.addEventListener('click', () => {
    if (!ultimaVendaConcluida) return;

    const v = ultimaVendaConcluida;
    const dataHora = new Date().toLocaleString('pt-BR');

    let itensTexto = v.itens.map(i => `• ${i.nome || i.nome_produto} (${i.quantidade}x) - R$ ${(i.total || i.total_item).toFixed(2)}`).join('\n');

    const textoWhatsApp = `🛍️ *COMPROVANTE DE COMPRA*\n-----------------------------------\nData: ${dataHora}\nPedido: ${v.numero_venda || '#' + v.id}\n\n*ITENS:*\n${itensTexto}\n\n*Forma de Pagamento:* ${v.forma_pagamento}\n*TOTAL:* R$ ${v.total.toFixed(2)}\n-----------------------------------\nObrigado pela preferência! ❤️`;

    navigator.clipboard.writeText(textoWhatsApp).then(() => {
      window.mostrarNotificacao('Comprovante copiado para o WhatsApp!', 'success');
    }).catch(err => {
      window.mostrarNotificacao('Erro ao copiar: ' + err, 'error');
    });
  });
}

const btnPdfModal = document.getElementById('btn-pdf-modal');
if (btnPdfModal) {
  btnPdfModal.addEventListener('click', async () => {
    if (!ultimaVendaConcluida) return;

    const res = await ipcRenderer.invoke('salvar-cupom-pdf', ultimaVendaConcluida);
    if (res.success) {
      window.mostrarNotificacao('PDF salvo com sucesso!', 'success');
    } else if (res.error) {
      window.mostrarNotificacao('Erro ao gerar PDF: ' + res.error, 'error');
    }
  });
}

const btnFecharModal = document.getElementById('btn-fechar-modal');
if (btnFecharModal) {
  btnFecharModal.addEventListener('click', fecharModalCupom);
}

// Limpar Venda
const btnLimpar = document.getElementById('btn-limpar');
if (btnLimpar) {
  btnLimpar.addEventListener('click', (e) => {
    e.preventDefault();
    if (carrinho.length === 0) return;

    if (confirm(`Atenção: Deseja realmente limpar os ${carrinho.length} item(ns) do carrinho?`)) {
      carrinho = [];
      if (inputValorRecebido) inputValorRecebido.value = '';
      if (inputValorDesconto) inputValorDesconto.value = '';
      if (displayTroco) displayTroco.innerText = formatarMoeda(0);
      atualizarCarrinho();
    }
    setTimeout(() => {
      if (campoBusca) campoBusca.focus();
    }, 50);
  });
}

// Vendas
const selectFiltroVendas = document.getElementById('filtro-vendas');
if (selectFiltroVendas) {
  selectFiltroVendas.addEventListener('change', () => carregarVendas());
}

async function carregarVendas() {
  const filtro = selectFiltroVendas ? selectFiltroVendas.value : 'todos';
  const res = await ipcRenderer.invoke('obter-lista-vendas', filtro);
  const tbody = document.getElementById('tabela-vendas-body');
  if (!tbody) return;

  if (res.success) {
    if (!res.data || res.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#9ca3af; padding:20px;">Nenhuma venda cadastrada no período selecionado.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.data.map(v => {
      const dataFormatada = v.data_venda ? new Date(v.data_venda).toLocaleString('pt-BR') : 'Data Indisponível';
      const pagamento = v.forma_pagamento || 'Dinheiro';
      const qtdItensTotal = v.total_unidades || (v.itens ? v.itens.reduce((acc, i) => acc + i.quantidade, 0) : 0);

      const linhasItensHTML = v.itens && v.itens.length > 0 
        ? v.itens.map(i => `
            <tr>
              <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb;"><strong>${i.nome_produto}</strong></td>
              <td style="padding: 6px 10px; text-align: center; border-bottom: 1px solid #e5e7eb;">${i.quantidade} un.</td>
              <td style="padding: 6px 10px; text-align: right; border-bottom: 1px solid #e5e7eb;">${formatarMoeda(i.preco_unitario)}</td>
              <td style="padding: 6px 10px; text-align: right; border-bottom: 1px solid #e5e7eb;"><strong>${formatarMoeda(i.total_item)}</strong></td>
            </tr>
          `).join('')
        : `<tr><td colspan="4" style="text-align:center; color:#9ca3af; padding:10px;">Nenhum item detalhado encontrado.</td></tr>`;

      return `
        <tr style="cursor: pointer; transition: background 0.15s;" onclick="toggleDetalhesVenda(${v.id})" id="linha-venda-${v.id}">
          <td>
            <span id="icone-expandir-${v.id}" style="display: inline-block; transition: transform 0.2s; font-size: 12px; margin-right: 4px; color: #6b3a6d;">▶</span>
            <strong style="color: #6b3a6d;">#${v.id}</strong>
          </td>
          <td>${dataFormatada}</td>
          <td><span style="background:#e0e7ff; color:#3730a3; padding:3px 8px; border-radius:12px; font-weight:600; font-size:12px;">${pagamento}</span></td>
          <td><strong>${qtdItensTotal} item(ns)</strong></td>
          <td><strong style="color: #2ecc71; font-size: 15px;">${formatarMoeda(v.total)}</strong></td>
          <td style="text-align: center; display: flex; gap: 6px; justify-content: center;" onclick="event.stopPropagation();">
            <button onclick="reimprimirCupom(${v.id})" style="background:#e0e7ff; color:#3730a3; border:none; padding:6px 10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">
              🖨️ Reimprimir
            </button>
            <button onclick="cancelarVenda(${v.id})" style="background:#fce8e6; color:#c53929; border:none; padding:6px 10px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">
              🗑️ Cancelar
            </button>
          </td>
        </tr>

        <tr id="detalhes-venda-${v.id}" style="display: none; background-color: #fafafa;">
          <td colspan="6" style="padding: 12px 20px; border-bottom: 2px solid #e5e7eb;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
              <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 8px;">
                🛍️ Itens Comprados nesta Venda (#${v.id})
              </div>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                  <tr style="background: #f3f4f6; color: #374151;">
                    <th style="text-align: left; padding: 6px 10px; font-size: 11px;">PRODUTO</th>
                    <th style="text-align: center; padding: 6px 10px; font-size: 11px; width: 100px;">QTD</th>
                    <th style="text-align: right; padding: 6px 10px; font-size: 11px; width: 120px;">VALOR UNIT.</th>
                    <th style="text-align: right; padding: 6px 10px; font-size: 11px; width: 120px;">SUBTOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  ${linhasItensHTML}
                </tbody>
              </table>
              ${v.desconto > 0 ? `<div style="text-align: right; margin-top: 8px; font-size: 12px; color: #c53929;">Desconto Aplicado: - ${formatarMoeda(v.desconto)}</div>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
}

window.toggleDetalhesVenda = function(vendaId) {
  const painel = document.getElementById(`detalhes-venda-${vendaId}`);
  const icone = document.getElementById(`icone-expandir-${vendaId}`);
  
  if (painel) {
    const estaVisivel = painel.style.display !== 'none';
    painel.style.display = estaVisivel ? 'none' : 'table-row';
    if (icone) {
      icone.style.transform = estaVisivel ? 'rotate(0deg)' : 'rotate(90deg)';
    }
  }
};

window.reimprimirCupom = async function(vendaId) {
  const res = await ipcRenderer.invoke('obter-detalhes-venda', vendaId);
  if (res.success) {
    await ipcRenderer.invoke('imprimir-cupom', res.data);
  } else {
    window.mostrarNotificacao('Erro ao buscar dados: ' + res.error, 'error');
  }
};

window.cancelarVenda = async function(vendaId) {
  if (confirm(`Tem certeza que deseja cancelar a venda #${vendaId}? Os itens serão devolvidos ao estoque.`)) {
    const res = await ipcRenderer.invoke('cancelar-venda', vendaId);
    if (res.success) {
      window.mostrarNotificacao('Venda cancelada com sucesso!', 'success');
      carregarVendas();
      carregarDashboard();
    } else {
      window.mostrarNotificacao('Erro ao cancelar: ' + res.error, 'error');
    }
  }
};

// Estoque
async function carregarEstoque() {
  const inputEl = document.getElementById('busca-estoque');
  const termo = inputEl ? inputEl.value.trim() : '';

  const res = await ipcRenderer.invoke('obter-lista-estoque', termo);
  const tbody = document.getElementById('tabela-estoque-body');
  if (!tbody) return;

  if (res.success) {
    if (!res.data || res.data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#9ca3af; padding:20px;">Nenhum produto encontrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.data.map(p => `
      <tr>
        <td>${p.codigo_barras || 'N/A'}</td>
        <td><strong>${p.nome}</strong></td>
        <td>${p.categoria || 'Maquiagem'}</td>
        <td>${formatarMoeda(p.preco_custo)}</td>
        <td>${formatarMoeda(p.preco_venda)}</td>
        <td><strong>${p.estoque_atual}</strong></td>
        <td style="text-align: center;">
          <button onclick="abrirModalEditar(${p.id}, '${encodeURIComponent(p.codigo_barras || '')}', '${encodeURIComponent(p.nome)}', ${p.preco_custo}, ${p.preco_venda}, ${p.estoque_atual})" style="background:#e0e7ff; color:#3730a3; border:none; padding:4px 8px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">
            ✏️ Editar
          </button>
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#c53929; padding:20px;">Erro ao carregar estoque: ${res.error}</td></tr>`;
  }
}

// Importação de Arquivo
const btnImportarArquivo = document.getElementById('btn-importar-arquivo');
if (btnImportarArquivo) {
  btnImportarArquivo.addEventListener('click', async () => {
    try {
      const res = await ipcRenderer.invoke('importar-arquivo-estoque');
      if (res.success) {
        window.mostrarNotificacao(`Sucesso! ${res.quantidade} produtos importados!`, 'success');
        carregarEstoque();
        carregarDashboard();
      } else if (res.error) {
        window.mostrarNotificacao('Erro ao importar: ' + res.error, 'error');
      }
    } catch (err) {
      window.mostrarNotificacao('Falha na importação: ' + err.message, 'error');
    } finally {
      window.desbloquearTela();
    }
  });
}

// Modal Cadastro de Produto
const btnAbrirCadastrar = document.getElementById('btn-abrir-modal-cadastrar');
const btnFecharCadastrar = document.getElementById('btn-fechar-modal-cadastrar');
const btnCancelarCadastrar = document.getElementById('btn-cancelar-cadastrar');
const formCadastrar = document.getElementById('form-cadastrar-produto');

if (btnAbrirCadastrar) {
  btnAbrirCadastrar.onclick = (e) => {
    e.preventDefault();
    if (formCadastrar) formCadastrar.reset();
    abrirModal('modal-cadastrar-produto');
    const inputNome = document.getElementById('cad-nome');
    if (inputNome) inputNome.focus();
  };
}

function fecharModalCadastrar() {
  fecharModal('modal-cadastrar-produto');
  if (formCadastrar) formCadastrar.reset();
}

if (btnFecharCadastrar) btnFecharCadastrar.onclick = fecharModalCadastrar;
if (btnCancelarCadastrar) btnCancelarCadastrar.onclick = fecharModalCadastrar;

if (formCadastrar) {
  formCadastrar.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const novoProduto = {
        codigo_barras: document.getElementById('cad-codigo').value,
        nome: document.getElementById('cad-nome').value,
        categoria: document.getElementById('cad-categoria').value,
        preco_custo: document.getElementById('cad-custo').value,
        preco_venda: document.getElementById('cad-venda').value,
        estoque_atual: document.getElementById('cad-estoque').value
      };

      const res = await ipcRenderer.invoke('cadastrar-produto', novoProduto);

      if (res.success) {
        window.mostrarNotificacao('Produto cadastrado com sucesso!', 'success');
        fecharModalCadastrar();
        carregarEstoque();
      } else {
        window.mostrarNotificacao('Erro ao cadastrar: ' + res.error, 'error');
      }
    } catch (err) {
      window.mostrarNotificacao('Erro inesperado: ' + err.message, 'error');
    } finally {
      window.desbloquearTela();
    }
  });
}

// Modal Editar Produto
window.abrirModalEditar = function(id, codEnc, nomeEnc, custo, venda, estoque) {
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-codigo').value = decodeURIComponent(codEnc);
  document.getElementById('modal-edit-nome-titulo').innerText = `Editar: ${decodeURIComponent(nomeEnc)}`;
  document.getElementById('edit-custo').value = custo;
  document.getElementById('edit-venda').value = venda;
  document.getElementById('edit-estoque').value = estoque;

  abrirModal('modal-editar-produto');
};

function fecharModalEditar() {
  fecharModal('modal-editar-produto');
}

const btnFecharEditar = document.getElementById('btn-fechar-modal-editar');
if (btnFecharEditar) btnFecharEditar.onclick = fecharModalEditar;

const btnCancelarEditar = document.getElementById('btn-cancelar-editar');
if (btnCancelarEditar) btnCancelarEditar.onclick = fecharModalEditar;

const formEditar = document.getElementById('form-editar-produto');
if (formEditar) {
  formEditar.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const produto = {
        id: parseInt(document.getElementById('edit-id').value, 10),
        codigo_barras: document.getElementById('edit-codigo').value.trim(),
        preco_custo: parseFloat(document.getElementById('edit-custo').value) || 0,
        preco_venda: parseFloat(document.getElementById('edit-venda').value) || 0,
        estoque_atual: parseInt(document.getElementById('edit-estoque').value, 10) || 0
      };

      const res = await ipcRenderer.invoke('atualizar-produto', produto);
      if (res.success) {
        window.mostrarNotificacao('Produto atualizado com sucesso!', 'success');
        fecharModalEditar();
        carregarEstoque();
        carregarDashboard();
      } else {
        window.mostrarNotificacao('Erro ao atualizar: ' + res.error, 'error');
      }
    } catch (err) {
      window.mostrarNotificacao('Erro ao editar: ' + err.message, 'error');
    } finally {
      window.desbloquearTela();
    }
  });
}

// Modal Curva ABC
const cardAbcA = document.getElementById('card-abc-a');
const cardAbcB = document.getElementById('card-abc-b');
const cardAbcC = document.getElementById('card-abc-c');

if (cardAbcA) cardAbcA.addEventListener('click', () => abrirModalCurvaABC('A'));
if (cardAbcB) cardAbcB.addEventListener('click', () => abrirModalCurvaABC('B'));
if (cardAbcC) cardAbcC.addEventListener('click', () => abrirModalCurvaABC('C'));

async function abrirModalCurvaABC(classeDesejada) {
  try {
    const response = await ipcRenderer.invoke('obter-detalhes-curva-abc');

    if (!response.success) {
      window.mostrarNotificacao('Erro ao carregar Curva ABC: ' + response.error, 'error');
      return;
    }

    const produtosFiltrados = response.produtos.filter(p => p.classe === classeDesejada);

    const tituloEl = document.getElementById('modal-abc-titulo');
    if (tituloEl) {
      tituloEl.innerText = `Produtos - Classe ${classeDesejada} (${produtosFiltrados.length} itens)`;
    }

    const tbody = document.getElementById('lista-produtos-abc');
    if (tbody) {
      tbody.innerHTML = '';

      if (produtosFiltrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: #888;">Nenhum produto registrado nesta classe.</td></tr>';
      } else {
        produtosFiltrados.forEach(p => {
          tbody.innerHTML += `
            <tr>
              <td><strong>${p.nome}</strong></td>
              <td style="text-align: center;">${p.total_qtd}</td>
              <td style="text-align: right;">${formatarMoeda(p.total_faturado)}</td>
              <td style="text-align: right; color: #666;">${p.percentual}%</td>
            </tr>
          `;
        });
      }
    }

    abrirModal('modal-curva-abc');
  } catch (err) {
    window.mostrarNotificacao('Erro ao abrir Curva ABC: ' + err.message, 'error');
  }
}

const btnFecharABC = document.getElementById('btn-fechar-modal-abc');
if (btnFecharABC) {
  btnFecharABC.onclick = () => fecharModal('modal-curva-abc');
}