const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'caixa.db');
const db = new sqlite3.Database(dbPath);

const excelPath = path.join(__dirname, 'caixa (1).xlsm');

function importarExcel() {
  console.log('A ler a aba "Estoque" do ficheiro Excel...');
  
  let workbook;
  try {
    workbook = XLSX.readFile(excelPath);
  } catch (err) {
    console.error('Erro ao abrir o ficheiro Excel:', err.message);
    return;
  }

  const sheetName = 'Estoque';
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    console.error(`A aba "${sheetName}" não foi encontrada no ficheiro.`);
    return;
  }

  const dados = XLSX.utils.sheet_to_json(worksheet);

  console.log(`Encontradas ${dados.length} linhas na aba "${sheetName}". A importar para o SQLite...`);

  db.serialize(() => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO produtos (codigo_barras, nome, preco_custo, preco_venda, estoque_atual)
      VALUES (?, ?, ?, ?, ?)
    `);

    let inseridos = 0;

    dados.forEach((linha) => {
      const ean = linha['Código de Barras (EAN)'];
      const codigoProduto = linha['Código do Produto'];
      const codigo = ean ? String(ean) : (codigoProduto ? String(codigoProduto) : '');
      
      const nome = linha['Nome do Item'];
      const precoCusto = parseFloat(linha['Preço Custo Unit. (R$)'] || 0);
      const precoVenda = parseFloat(linha['VALOR DE VENDA'] || 0);
      const estoque = parseInt(linha['Total Unidades (Estoque)'] || 0, 10);

      if (nome) {
        stmt.run(codigo, String(nome), precoCusto, precoVenda, estoque);
        inseridos++;
      }
    });

    stmt.finalize();
    console.log(`Sucesso! ${inseridos} produtos foram importados para a base de dados SQLite.`);
  });
}

importarExcel();