const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, initDb } = require('./database');

let mainWindow;

// Gerenciador de Log de Erros Local
function registrarErro(err, contexto = '') {
  try {
    const userDataPath = (app && app.getPath) ? app.getPath('userData') : path.join(__dirname, 'data');
    const logPath = path.join(userDataPath, 'erros.log');
    const timestamp = new Date().toLocaleString('pt-BR');
    const mensagem = `[${timestamp}] ${contexto ? `[${contexto}] ` : ''}${err.stack || err.message || err}\n----------------------------------------\n`;
    fs.appendFileSync(logPath, mensagem, 'utf8');
  } catch (e) {
    console.error('Falha ao registrar log de erro:', e);
  }
}

process.on('uncaughtException', (err) => registrarErro(err, 'Uncaught Exception'));
process.on('unhandledRejection', (reason) => registrarErro(reason, 'Unhandled Rejection'));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    title: 'Queridinha Makeup — Sistema de Caixa',
    icon: path.join(__dirname, 'logo.jpg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  initDb();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Função para carregar as informações da loja a partir do config.json
function obterConfigLoja() {
  const configPadrao = {
    nome: "NOME DA SUA LOJA",
    cnpj: "00.000.000/0001-00",
    endereco: "Rua Exemplo, nº 123",
    bairro: "Bairro / Cidade",
    telefone: "(00) 00000-0000",
    instagram: "@sualoja"
  };

  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const rawData = fs.readFileSync(configPath, 'utf8');
      return { ...configPadrao, ...JSON.parse(rawData) };
    }
  } catch (err) {
    console.error('Erro ao ler config.json:', err);
  }

  return configPadrao;
}

// Função para tratar preços e números do Excel/CSV
function normalizarNumeroExcel(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;

  let str = String(valor).replace(/R\$\s?/g, '').trim();

  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// Converte números normais, textos e preserva/corrige zeros à esquerda de EANs
function converterNotacaoCientificaEAN(valor) {
  if (valor === undefined || valor === null || valor === '') return '';

  let str = String(valor).trim();

  if (typeof valor === 'number') {
    str = BigInt(Math.round(valor)).toString();
  } else if (str.toUpperCase().includes('E+')) {
    let strNormalizada = str.replace(',', '.');
    let num = Number(strNormalizada);
    if (!isNaN(num)) {
      str = BigInt(Math.round(num)).toString();
    }
  }

  let apenasNumeros = str.replace(/\D/g, '');

  // Se o código tiver 12 dígitos (comum quando o Excel apaga o '0' inicial do EAN-13), adiciona o '0' de volta
  if (apenasNumeros.length === 12) {
    apenasNumeros = '0' + apenasNumeros;
  }

  return apenasNumeros;
}

// Canal Único de Backup
ipcMain.handle('fazer-backup', async () => {
  const dataHoje = new Date().toISOString().split('T')[0];
  const defaultPath = `backup_caixa_${dataHoje}.db`;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar Backup da Base de Dados',
    defaultPath: defaultPath,
    filters: [
      { name: 'Ficheiros de Base de Dados (*.db)', extensions: ['db'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  try {
    const userDataPath = (app && app.getPath) 
      ? app.getPath('userData') 
      : path.join(__dirname, 'data');
      
    const dbPath = path.join(userDataPath, 'caixa.db');
    fs.copyFileSync(dbPath, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    registrarErro(err, 'fazer-backup');
    return { success: false, error: err.message };
  }
});

// Buscar Produto no Caixa
ipcMain.handle('buscar-produto', (event, termo) => {
  return new Promise((resolve) => {
    const query = `
      SELECT * FROM produtos 
      WHERE (codigo_barras = ? OR nome LIKE ?) AND ativo = 1 
      LIMIT 10
    `;
    db.all(query, [termo, `%${termo}%`], (err, rows) => {
      if (err) {
        registrarErro(err, 'buscar-produto');
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, data: rows });
      }
    });
  });
});

// Finalizar Venda
ipcMain.handle('finalizar-venda', (event, dadosVenda) => {
  return new Promise((resolve) => {
    db.serialize(() => {
      const stmtVenda = db.prepare(`
        INSERT INTO vendas (numero_venda, subtotal, desconto, total, forma_pagamento, cliente, data_venda)
        VALUES (?, ?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
      `);

      stmtVenda.run(
        dadosVenda.numero_venda,
        dadosVenda.subtotal,
        dadosVenda.desconto || 0,
        dadosVenda.total,
        dadosVenda.forma_pagamento || 'Dinheiro',
        'Consumidor',
        function (err) {
          if (err) {
            registrarErro(err, 'finalizar-venda-insert');
            return resolve({ success: false, error: err.message });
          }

          const vendaId = this.lastID;

          const stmtItem = db.prepare(`
            INSERT INTO itens_venda (venda_id, produto_id, nome_produto, quantidade, preco_unitario, total_item)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          const stmtStock = db.prepare(`
            UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?
          `);

          for (const item of dadosVenda.itens) {
            stmtItem.run(vendaId, item.id, item.nome, item.quantidade, item.preco_venda, item.total);
            if (item.id) {
              stmtStock.run(item.quantidade, item.id);
            }
          }

          stmtItem.finalize();
          stmtStock.finalize();
          resolve({ success: true, vendaId });
        }
      );
    });
  });
});

// Importar Estoque via Excel / CSV
ipcMain.handle('importar-arquivo-estoque', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar arquivo de estoque (CSV ou Excel)',
    properties: ['openFile'],
    filters: [
      { name: 'Arquivos Suportados (*.csv, *.xlsx, *.xls, *.xlsm)', extensions: ['csv', 'xlsx', 'xls', 'xlsm'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result.filePaths[0];

  try {
    const workbook = XLSX.readFile(filePath, { raw: false, cellText: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const dados = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!dados || dados.length === 0) {
      return { success: false, error: 'O arquivo está vazio ou em formato inválido.' };
    }

    return new Promise((resolve) => {
      db.serialize(() => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO produtos (codigo_barras, nome, categoria, preco_custo, preco_venda, estoque_atual)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        let inseridos = 0;

        dados.forEach((linha) => {
          const linhaNormalizada = {};
          Object.keys(linha).forEach(key => {
            linhaNormalizada[key.trim().toLowerCase()] = linha[key];
          });

          const nome = linhaNormalizada['nome'] || 
                       linhaNormalizada['nome do item'] || 
                       linhaNormalizada['produto'] || 
                       linhaNormalizada['descricao'] || 
                       linha['PRODUTO'] || linha['DESCRICAO'] || '';

          if (nome && String(nome).trim().length > 0) {
            const rawEAN = linhaNormalizada['codigo_barras'] || 
                           linhaNormalizada['código de barras (ean)'] || 
                           linhaNormalizada['código de de'] || 
                           linhaNormalizada['código de'] || 
                           linhaNormalizada['codigo de'] || 
                           linhaNormalizada['codigo'] || 
                           linhaNormalizada['ean'] || '';
            
            let ean = converterNotacaoCientificaEAN(rawEAN);

            if (!ean || ean.length < 3) {
              ean = 'SEM_GTIN_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            }

            const categoria = linhaNormalizada['categoria'] || 'Maquiagem';

            const rawCusto = linhaNormalizada['preco_custo'] || 
                             linhaNormalizada['preço custo unit. (r$)'] || 
                             linhaNormalizada['preço custo'] || 
                             linhaNormalizada['preço cus'] || 
                             linhaNormalizada['custo'] || 0;
            const precoCusto = normalizarNumeroExcel(rawCusto);

            const rawVenda = linhaNormalizada['preco_venda'] || 
                             linhaNormalizada['valor de venda'] || 
                             linhaNormalizada['valor de'] || 
                             linhaNormalizada['valor venda'] || 
                             linhaNormalizada['preco'] || 
                             linhaNormalizada['venda'] || 0;
            const precoVenda = normalizarNumeroExcel(rawVenda);

            const rawEstoque = linhaNormalizada['estoque_atual'] || 
                               linhaNormalizada['total unidades (estoque)'] || 
                               linhaNormalizada['total unidades'] || 
                               linhaNormalizada['estoque'] || 0;
            const estoque = parseInt(normalizarNumeroExcel(rawEstoque), 10) || 0;

            stmt.run(ean, String(nome).trim(), String(categoria).trim(), precoCusto, precoVenda, estoque);
            inseridos++;
          }
        });

        stmt.finalize((err) => {
          if (err) {
            registrarErro(err, 'importar-arquivo-estoque-stmt');
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true, quantidade: inseridos });
          }
        });
      });
    });
  } catch (err) {
    registrarErro(err, 'importar-arquivo-estoque');
    return { success: false, error: err.message };
  }
});

// Impressão Cupom
ipcMain.handle('imprimir-cupom', (event, dadosVenda) => {
  return new Promise((resolve) => {
    const config = obterConfigLoja();

    let printWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const dataHora = dadosVenda.data_venda 
      ? new Date(dadosVenda.data_venda).toLocaleString('pt-BR')
      : new Date().toLocaleString('pt-BR');

    let itensHTML = dadosVenda.itens.map(item => `
      <tr>
        <td style="text-align: left;">${(item.nome || item.nome_produto || '').substring(0, 20)}</td>
        <td style="text-align: center;">${item.quantidade}</td>
        <td style="text-align: right;">R$ ${(item.preco_venda || item.preco_unitario || 0).toFixed(2)}</td>
        <td style="text-align: right;">R$ ${(item.total || item.total_item || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    const temDesconto = (dadosVenda.desconto && dadosVenda.desconto > 0);
    const temTroco = (dadosVenda.forma_pagamento === 'Dinheiro' && dadosVenda.valor_recebido > 0);

    const cupomHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; size: 80mm auto; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 72mm;
            margin: 0 auto;
            padding: 8px 0;
            font-size: 11px;
            color: #000;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .line { border-bottom: 1px dashed #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th { border-bottom: 1px solid #000; text-align: left; padding-bottom: 2px; }
          td { padding: 2px 0; }
          .total-box { font-size: 13px; font-weight: bold; margin-top: 6px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <strong style="font-size: 16px;">${config.nome}</strong><br>
          CNPJ: ${config.cnpj}<br>
          ${config.endereco}<br>
          ${config.bairro}<br>
          Tel: ${config.telefone}<br>
          Insta: ${config.instagram}<br>
          --------------------------------<br>
          <strong>Comprovante Não Fiscal</strong>
        </div>
        <div class="line"></div>
        <div>
          Data: ${dataHora}<br>
          Pedido: ${dadosVenda.numero_venda || ('#' + dadosVenda.id)}<br>
          Pagamento: ${dadosVenda.forma_pagamento || 'Dinheiro'}
        </div>
        <div class="line"></div>
        <table>
          <thead>
            <tr>
              <th style="text-align: left;">Item</th>
              <th style="text-align: center;">Qtd</th>
              <th style="text-align: right;">Un</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itensHTML}
          </tbody>
        </table>
        <div class="line"></div>
        ${temDesconto ? `
        <div class="text-right">
          SUBTOTAL: R$ ${(dadosVenda.subtotal || 0).toFixed(2)}<br>
          DESCONTO: - R$ ${(dadosVenda.desconto || 0).toFixed(2)}
        </div>
        ` : ''}
        <div class="text-right total-box">
          TOTAL: R$ ${(dadosVenda.total || 0).toFixed(2)}
        </div>
        ${temTroco ? `
        <div class="text-right" style="margin-top: 4px;">
          VALOR RECEBIDO: R$ ${dadosVenda.valor_recebido.toFixed(2)}<br>
          <strong>TROCO: R$ ${(dadosVenda.troco || 0).toFixed(2)}</strong>
        </div>
        ` : ''}
        <div class="line"></div>
        <div class="text-center" style="margin-top: 8px;">
          Obrigado pela preferência!<br>
          Volte Sempre!
        </div>
      </body>
      </html>
    `;

    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(cupomHTML));

    printWin.webContents.on('did-finish-load', () => {
      printWin.webContents.print({
        silent: false,
        printBackground: true
      }, (success, failureReason) => {
        printWin.close();
        resolve({ success, error: failureReason });
      });
    });
  });
});

// Salvar Cupom em PDF
ipcMain.handle('salvar-cupom-pdf', async (event, dadosVenda) => {
  try {
    const config = obterConfigLoja();
    let printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    const dataHora = dadosVenda.data_venda 
      ? new Date(dadosVenda.data_venda).toLocaleString('pt-BR')
      : new Date().toLocaleString('pt-BR');

    let itensHTML = dadosVenda.itens.map(item => `
      <tr>
        <td style="text-align: left;">${(item.nome || item.nome_produto || '').substring(0, 20)}</td>
        <td style="text-align: center;">${item.quantidade}</td>
        <td style="text-align: right;">R$ ${(item.preco_venda || item.preco_unitario || 0).toFixed(2)}</td>
        <td style="text-align: right;">R$ ${(item.total || item.total_item || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    const temDesconto = (dadosVenda.desconto && dadosVenda.desconto > 0);
    const temTroco = (dadosVenda.forma_pagamento === 'Dinheiro' && dadosVenda.valor_recebido > 0);

    const cupomHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Courier New', Courier, monospace; width: 72mm; margin: 0 auto; padding: 10px 0; font-size: 11px; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .line { border-bottom: 1px dashed #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th { border-bottom: 1px solid #000; text-align: left; }
          td { padding: 2px 0; }
          .total-box { font-size: 13px; font-weight: bold; margin-top: 6px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <strong style="font-size: 15px;">${config.nome}</strong><br>
          CNPJ: ${config.cnpj}<br>
          ${config.endereco}<br>
          Tel: ${config.telefone}<br>
          --------------------------------<br>
          <strong>Comprovante Não Fiscal</strong>
        </div>
        <div class="line"></div>
        <div>
          Data: ${dataHora}<br>
          Pedido: ${dadosVenda.numero_venda || ('#' + dadosVenda.id)}<br>
          Pagamento: ${dadosVenda.forma_pagamento || 'Dinheiro'}
        </div>
        <div class="line"></div>
        <table>
          <thead>
            <tr>
              <th style="text-align: left;">Item</th>
              <th style="text-align: center;">Qtd</th>
              <th style="text-align: right;">Un</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>${itensHTML}</tbody>
        </table>
        <div class="line"></div>
        ${temDesconto ? `<div class="text-right">SUBTOTAL: R$ ${(dadosVenda.subtotal || 0).toFixed(2)}<br>DESCONTO: - R$ ${(dadosVenda.desconto || 0).toFixed(2)}</div>` : ''}
        <div class="text-right total-box">TOTAL: R$ ${(dadosVenda.total || 0).toFixed(2)}</div>
        ${temTroco ? `<div class="text-right">VALOR RECEBIDO: R$ ${dadosVenda.valor_recebido.toFixed(2)}<br><strong>TROCO: R$ ${(dadosVenda.troco || 0).toFixed(2)}</strong></div>` : ''}
        <div class="line"></div>
        <div class="text-center" style="margin-top: 8px;">Obrigado pela preferência!<br>Volte Sempre!</div>
      </body>
      </html>
    `;

    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(cupomHTML));

    return new Promise((resolve) => {
      printWin.webContents.on('did-finish-load', async () => {
        try {
          const pdfBuffer = await printWin.webContents.printToPDF({
            marginsType: 1,
            pageSize: { width: 80000, height: 200000 },
            printBackground: true
          });
          printWin.close();

          const saveResult = await dialog.showSaveDialog(mainWindow, {
            title: 'Salvar Comprovante em PDF',
            defaultPath: `Cupom_${dadosVenda.numero_venda || dadosVenda.id}.pdf`,
            filters: [{ name: 'Arquivos PDF (*.pdf)', extensions: ['pdf'] }]
          });

          if (saveResult.canceled || !saveResult.filePath) {
            return resolve({ success: false, canceled: true });
          }

          fs.writeFileSync(saveResult.filePath, pdfBuffer);
          resolve({ success: true, filePath: saveResult.filePath });
        } catch (err) {
          registrarErro(err, 'salvar-cupom-pdf');
          if (!printWin.isDestroyed()) printWin.close();
          resolve({ success: false, error: err.message });
        }
      });
    });
  } catch (err) {
    registrarErro(err, 'salvar-cupom-pdf-outer');
    return { success: false, error: err.message };
  }
});

// Fechamento Impressão
ipcMain.handle('imprimir-fechamento', (event, dados) => {
  return new Promise((resolve) => {
    let printWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const config = obterConfigLoja();
    const dataHora = new Date().toLocaleString('pt-BR');

    let pagamentosHTML = (dados.vendas_pagamento || []).map(p => `
      <tr>
        <td style="text-align: left;">${p.forma_pagamento} (${p.qtd}x)</td>
        <td style="text-align: right;">R$ ${p.total.toFixed(2)}</td>
      </tr>
    `).join('');

    const fechamentoHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { margin: 0; size: 80mm auto; }
          body {
            font-family: 'Courier New', Courier, monospace;
            width: 72mm;
            margin: 0 auto;
            padding: 8px 0;
            font-size: 11px;
            color: #000;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .line { border-bottom: 1px dashed #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          td { padding: 3px 0; }
          .total-box { font-size: 14px; font-weight: bold; margin-top: 6px; }
        </style>
      </head>
      <body>
        <div class="text-center">
          <strong style="font-size: 16px;">${config.nome}</strong><br>
          --------------------------------<br>
          <strong>FECHAMENTO DE CAIXA</strong>
        </div>
        <div class="line"></div>
        <div>
          Data/Hora: ${dataHora}<br>
          Total de Vendas: ${dados.qtd_vendas}
        </div>
        <div class="line"></div>
        <strong style="font-size:12px;">VENDAS POR PAGAMENTO:</strong>
        <table>
          <tbody>
            ${pagamentosHTML.length > 0 ? pagamentosHTML : '<tr><td colspan="2">Nenhuma venda registrada</td></tr>'}
          </tbody>
        </table>
        <div class="line"></div>
        <div class="text-right total-box">
          FATURAMENTO: R$ ${dados.faturamento.toFixed(2)}
        </div>
        <div class="text-right">
          LUCRO ESTIMADO: R$ ${dados.lucro_bruto.toFixed(2)}
        </div>
        <div class="line"></div>
        <div class="text-center" style="margin-top: 10px;">
          Caixa encerrado com sucesso!
        </div>
      </body>
      </html>
    `;

    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fechamentoHTML));

    printWin.webContents.on('did-finish-load', () => {
      printWin.webContents.print({
        silent: false,
        printBackground: true
      }, (success, failureReason) => {
        printWin.close();
        resolve({ success, error: failureReason });
      });
    });
  });
});

ipcMain.handle('obter-detalhes-venda', (event, vendaId) => {
  return new Promise((resolve) => {
    db.get(`SELECT * FROM vendas WHERE id = ?`, [vendaId], (err, venda) => {
      if (err || !venda) {
        if (err) registrarErro(err, 'obter-detalhes-venda');
        return resolve({ success: false, error: 'Venda não encontrada' });
      }

      db.all(`SELECT * FROM itens_venda WHERE venda_id = ?`, [vendaId], (err, itens) => {
        if (err) {
          registrarErro(err, 'obter-detalhes-venda-itens');
          return resolve({ success: false, error: err.message });
        }
        venda.itens = itens || [];
        resolve({ success: true, data: venda });
      });
    });
  });
});

ipcMain.handle('cancelar-venda', (event, vendaId) => {
  return new Promise((resolve) => {
    db.serialize(() => {
      db.all(`SELECT produto_id, quantidade FROM itens_venda WHERE venda_id = ?`, [vendaId], (err, itens) => {
        if (err) {
          registrarErro(err, 'cancelar-venda-select');
          return resolve({ success: false, error: err.message });
        }

        const stmtStock = db.prepare(`UPDATE produtos SET estoque_atual = estoque_atual + ? WHERE id = ?`);
        if (itens) {
          for (const item of itens) {
            if (item.produto_id) {
              stmtStock.run(item.quantidade, item.produto_id);
            }
          }
        }
        stmtStock.finalize();

        db.run(`DELETE FROM itens_venda WHERE venda_id = ?`, [vendaId], (err) => {
          if (err) {
            registrarErro(err, 'cancelar-venda-delete-itens');
            return resolve({ success: false, error: err.message });
          }

          db.run(`DELETE FROM vendas WHERE id = ?`, [vendaId], (err) => {
            if (err) {
              registrarErro(err, 'cancelar-venda-delete-venda');
              return resolve({ success: false, error: err.message });
            }
            resolve({ success: true });
          });
        });
      });
    });
  });
});

// Dashboard
ipcMain.handle('obter-dados-dashboard', (event, filtroPeriodo) => {
  return new Promise((resolve) => {
    const res = {};
    let OndeDataVendas = '';
    let OndeDataItens = '';

    if (filtroPeriodo === 'hoje') {
      OndeDataVendas = " WHERE DATE(data_venda) = DATE('now', 'localtime')";
      OndeDataItens = " WHERE v.id IS NOT NULL AND DATE(v.data_venda) = DATE('now', 'localtime')";
    } else if (filtroPeriodo === '7dias') {
      OndeDataVendas = " WHERE data_venda >= DATE('now', '-7 days', 'localtime')";
      OndeDataItens = " WHERE v.id IS NOT NULL AND v.data_venda >= DATE('now', '-7 days', 'localtime')";
    } else if (filtroPeriodo === 'mes') {
      OndeDataVendas = " WHERE strftime('%Y-%m', data_venda) = strftime('%Y-%m', 'now', 'localtime')";
      OndeDataItens = " WHERE v.id IS NOT NULL AND strftime('%Y-%m', v.data_venda) = strftime('%Y-%m', 'now', 'localtime')";
    }

    db.get(`SELECT COALESCE(SUM(total), 0) AS faturamento, COUNT(id) AS qtd_vendas FROM vendas ${OndeDataVendas}`, [], (err, rowVendas) => {
      res.faturamento = rowVendas ? rowVendas.faturamento : 0;
      res.qtd_vendas = rowVendas ? rowVendas.qtd_vendas : 0;
      res.ticket_medio = res.qtd_vendas > 0 ? (res.faturamento / res.qtd_vendas) : 0;

      const queryUPT = `
        SELECT COALESCE(SUM(i.quantidade), 0) AS total_itens
        FROM itens_venda i
        LEFT JOIN vendas v ON i.venda_id = v.id
        ${OndeDataItens}
      `;

      db.get(queryUPT, [], (err, rowUPT) => {
        const totalItens = rowUPT ? rowUPT.total_itens : 0;
        res.upt = res.qtd_vendas > 0 ? (totalItens / res.qtd_vendas) : 0;

        const queryLucro = `
          SELECT COALESCE(SUM((i.preco_unitario - COALESCE(p.preco_custo, 0)) * i.quantidade), 0) AS lucro_bruto
          FROM itens_venda i
          LEFT JOIN vendas v ON i.venda_id = v.id
          LEFT JOIN produtos p ON i.produto_id = p.id
          ${OndeDataItens}
        `;
        db.get(queryLucro, [], (err, rowLucro) => {
          res.lucro_bruto = rowLucro ? rowLucro.lucro_bruto : 0;

          db.get(`
            SELECT COALESCE(SUM(estoque_atual * preco_custo), 0) AS valor_estoque, 
                   COALESCE(SUM(estoque_atual), 0) AS unidades_estoque
            FROM produtos WHERE ativo = 1
          `, [], (err, rowEstoque) => {
            res.valor_estoque = rowEstoque ? rowEstoque.valor_estoque : 0;
            res.unidades_estoque = rowEstoque ? rowEstoque.unidades_estoque : 0;

            db.all(`SELECT COALESCE(forma_pagamento, 'Dinheiro') as forma_pagamento, SUM(total) as total, COUNT(id) as qtd FROM vendas ${OndeDataVendas} GROUP BY forma_pagamento`, [], (err, rowsPag) => {
              res.vendas_pagamento = rowsPag || [];

              const queryTop = `
                SELECT i.nome_produto, SUM(i.quantidade) AS qtd_total, SUM(i.total_item) AS valor_total
                FROM itens_venda i
                LEFT JOIN vendas v ON i.venda_id = v.id
                ${OndeDataItens}
                GROUP BY i.nome_produto
                ORDER BY qtd_total DESC
                LIMIT 3
              `;
              db.all(queryTop, [], (err, rowsTop) => {
                res.top_vendidos = rowsTop || [];

                const queryABC = `
                  SELECT i.nome_produto, SUM(i.total_item) AS faturamento_produto
                  FROM itens_venda i
                  LEFT JOIN vendas v ON i.venda_id = v.id
                  ${OndeDataItens}
                  GROUP BY i.nome_produto
                  ORDER BY faturamento_produto DESC
                `;
                db.all(queryABC, [], (err, rowsABC) => {
                  let classeA = 0, classeB = 0, classeC = 0;
                  if (rowsABC && rowsABC.length > 0 && res.faturamento > 0) {
                    let acumulado = 0;
                    rowsABC.forEach(p => {
                      acumulado += p.faturamento_produto;
                      const percentual = (acumulado / res.faturamento) * 100;
                      if (percentual <= 80) classeA++;
                      else if (percentual <= 95) classeB++;
                      else classeC++;
                    });
                  }
                  res.curva_abc = { classeA, classeB, classeC };
                  resolve({ success: true, data: res });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Listar Vendas Registradas
ipcMain.handle('obter-lista-vendas', (event, filtroPeriodo) => {
  return new Promise((resolve) => {
    let OndeData = '';

    if (filtroPeriodo === 'hoje') {
      OndeData = " WHERE DATE(v.data_venda) = DATE('now', 'localtime')";
    } else if (filtroPeriodo === '7dias') {
      OndeData = " WHERE v.data_venda >= DATE('now', '-7 days', 'localtime')";
    } else if (filtroPeriodo === 'mes') {
      OndeData = " WHERE strftime('%Y-%m', v.data_venda) = strftime('%Y-%m', 'now', 'localtime')";
    }

    const queryVendas = `
      SELECT v.*, 
             COALESCE(SUM(i.quantidade), 0) AS total_unidades
      FROM vendas v
      LEFT JOIN itens_venda i ON v.id = i.venda_id
      ${OndeData}
      GROUP BY v.id
      ORDER BY v.id DESC
      LIMIT 100
    `;

    db.all(queryVendas, [], (err, vendas) => {
      if (err) {
        registrarErro(err, 'obter-lista-vendas');
        return resolve({ success: false, error: err.message });
      }
      if (!vendas || vendas.length === 0) return resolve({ success: true, data: [] });

      const idsVendas = vendas.map(v => v.id);
      const queryItens = `
        SELECT * FROM itens_venda 
        WHERE venda_id IN (${idsVendas.map(() => '?').join(',')})
      `;

      db.all(queryItens, idsVendas, (errItens, itens) => {
        if (errItens) {
          registrarErro(errItens, 'obter-lista-vendas-itens');
          return resolve({ success: false, error: errItens.message });
        }

        vendas.forEach(v => {
          v.itens = itens.filter(i => i.venda_id === v.id);
        });

        resolve({ success: true, data: vendas });
      });
    });
  });
});

// Listar Estoque
ipcMain.handle('obter-lista-estoque', (event, busca) => {
  return new Promise((resolve) => {
    let query = `SELECT * FROM produtos WHERE ativo = 1`;
    let params = [];

    if (busca && typeof busca === 'string' && busca.trim().length > 0) {
      const termo = busca.trim();
      query += ` AND (codigo_barras LIKE ? OR nome LIKE ? OR categoria LIKE ?)`;
      params = [`%${termo}%`, `%${termo}%`, `%${termo}%`];
    }

    query += ` ORDER BY nome ASC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        registrarErro(err, 'obter-lista-estoque');
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, data: rows });
      }
    });
  });
});

// Handler para retornar todos os produtos categorizados na Curva ABC
ipcMain.handle('obter-detalhes-curva-abc', async () => {
  return new Promise((resolve) => {
    const query = `
      SELECT 
        p.id,
        p.nome,
        COALESCE(SUM(iv.quantidade), 0) AS total_qtd,
        COALESCE(SUM(iv.total_item), 0) AS total_faturado
      FROM produtos p
      LEFT JOIN itens_venda iv ON p.id = iv.produto_id
      GROUP BY p.id
      HAVING total_faturado > 0
      ORDER BY total_faturado DESC
    `;

    db.all(query, [], (err, rows) => {
      if (err) {
        registrarErro(err, 'obter-detalhes-curva-abc');
        return resolve({ success: false, error: err.message });
      }

      const faturamentoTotalGeral = rows.reduce((acc, item) => acc + item.total_faturado, 0);

      let acumulado = 0;
      const produtosClassificados = rows.map(item => {
        const percentual = faturamentoTotalGeral > 0 ? (item.total_faturado / faturamentoTotalGeral) * 100 : 0;
        const acumuladoAnterior = acumulado;
        acumulado += percentual;

        let classe = 'C';
        if (acumuladoAnterior < 80) {
          classe = 'A';
        } else if (acumuladoAnterior < 95) {
          classe = 'B';
        }

        return {
          ...item,
          percentual: percentual.toFixed(2),
          classe
        };
      });

      resolve({ success: true, produtos: produtosClassificados });
    });
  });
});

// Cadastrar Produto Manualmente no Estoque
ipcMain.handle('cadastrar-produto', async (event, produto) => {
  return new Promise((resolve) => {
    let ean = (produto.codigo_barras || '').trim();

    if (!ean) {
      ean = 'SEM_GTIN_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    }

    const precoCusto = parseFloat(produto.preco_custo) || 0;
    const precoVenda = parseFloat(produto.preco_venda) || 0;
    const estoque = parseInt(produto.estoque_atual, 10) || 0;
    const categoria = (produto.categoria || 'Maquiagem').trim();
    const nome = (produto.nome || '').trim();

    if (!nome) {
      return resolve({ success: false, error: 'O nome do produto é obrigatório.' });
    }

    const stmt = db.prepare(`
      INSERT INTO produtos (codigo_barras, nome, categoria, preco_custo, preco_venda, estoque_atual)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(ean, nome, categoria, precoCusto, precoVenda, estoque, function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          resolve({ success: false, error: 'Já existe um produto cadastrado com este código de barras.' });
        } else {
          registrarErro(err, 'cadastrar-produto');
          resolve({ success: false, error: err.message });
        }
      } else {
        resolve({ success: true, id: this.lastID });
      }
    });

    stmt.finalize();
  });
});

// Atualizar Produto no Estoque (Edição Rápida com Código de Barras)
ipcMain.handle('atualizar-produto', (event, produto) => {
  return new Promise((resolve) => {
    const { id, codigo_barras, preco_venda, preco_custo, estoque_atual } = produto;
    const query = `
      UPDATE produtos 
      SET codigo_barras = ?, preco_venda = ?, preco_custo = ?, estoque_atual = ? 
      WHERE id = ?
    `;
    db.run(query, [codigo_barras, preco_venda, preco_custo, estoque_atual, id], function(err) {
      if (err) {
        registrarErro(err, 'atualizar-produto');
        return resolve({ success: false, error: err.message });
      }
      resolve({ success: true });
    });
  });
});