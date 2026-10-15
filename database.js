const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

// Define a pasta do banco: AppData no Windows (.exe) ou pasta atual no desenvolvimento (npm start)
const userDataPath = (app && app.getPath) 
  ? app.getPath('userData') 
  : path.join(__dirname, 'data');

// Garante que o diretório exista antes de criar o arquivo .db
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

const dbPath = path.join(userDataPath, 'caixa.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao abrir o banco de dados SQLite:', err.message);
  } else {
    console.log('Banco de dados conectado com sucesso em:', dbPath);
  }
});

function initDb() {
  db.serialize(() => {
    // 1. Tabela de Produtos
    db.run(`
      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo_barras TEXT UNIQUE,
        nome TEXT NOT NULL,
        categoria TEXT DEFAULT 'Maquiagem',
        preco_custo REAL DEFAULT 0,
        preco_venda REAL DEFAULT 0,
        estoque_atual INTEGER DEFAULT 0,
        ativo INTEGER DEFAULT 1
      )
    `);

    // Garante que a coluna categoria exista
    db.run(`ALTER TABLE produtos ADD COLUMN categoria TEXT DEFAULT 'Maquiagem'`, (err) => {
      // Ignora o erro se a coluna já existir
    });

    // 2. Tabela de Vendas
    db.run(`
      CREATE TABLE IF NOT EXISTS vendas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_venda TEXT,
        subtotal REAL,
        desconto REAL DEFAULT 0,
        total REAL,
        forma_pagamento TEXT,
        cliente TEXT DEFAULT 'Consumidor',
        data_venda DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Tabela de Itens da Venda
    db.run(`
      CREATE TABLE IF NOT EXISTS itens_venda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        produto_id INTEGER,
        nome_produto TEXT,
        quantidade INTEGER,
        preco_unitario REAL,
        total_item REAL,
        FOREIGN KEY(venda_id) REFERENCES vendas(id)
      )
    `);
  });
}

module.exports = { db, initDb };