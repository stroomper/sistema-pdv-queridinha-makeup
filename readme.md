# 💄 Queridinha Makeup — Sistema de Caixa & PDV Desktop

O **Queridinha Makeup PDV** é um sistema de caixa e gestão de estoque desktop desenvolvido sob medida para lojas de cosméticos e comércio varejista. A aplicação funciona de forma 100% local e offline, oferecendo controle de estoque, leitura de código de barras (EAN), fechamento de caixa, impressão de cupons térmicos (80mm) e painel analítico com indicadores de vendas.

---

## 📸 Funcionalidades Principais

* **🛒 Ponto de Venda (PDV / Caixa):**
  * Leitura e busca rápida por Código de Barras (EAN) ou nome do produto.
  * Suporte a inclusão de **Produtos Avulsos** (itens fora do estoque).
  * Aplicação de descontos no valor total da venda.
  * Cálculo automático de troco e suporte a múltiplas formas de pagamento (Dinheiro, PIX, Cartão de Crédito e Débito).
  * Atalho rápido para finalização de venda (`F9`).

* **🖨️ Impressão de Cupons e Relatórios:**
  * Emissão de comprovante de venda não fiscal otimizado para impressoras térmicas de **80mm**.
  * Relatório de **Fechamento de Caixa** impresso com consolidação de faturamento por método de pagamento.
  * Histórico de vendas com suporte a **reimpressão de cupons** e **cancelamento de vendas** (com estorno automático dos produtos para o estoque).

* **📊 Dashboard Analítico:**
  * **Faturamento Total** e **Lucro Bruto** estimado.
  * **Ticket Médio** e **UPT (Unidades por Transação / Itens por Nota)**.
  * **Análise de Curva ABC:** Classificação dos produtos em Classe A (80% do faturamento), Classe B (15%) e Classe C (5%).
  * Ranking dos **TOP 3 Produtos Mais Vendidos**.
  * Filtro por período (*Hoje*, *Últimos 7 dias*, *Este Mês* ou *Todo o Histórico*).

* **📦 Gestão de Estoque:**
  * Consulta e filtragem dinâmica por Nome, Categoria ou Código EAN.
  * **Importação Massiva via Excel / CSV:** Atualização rápida de cadastro e estoque através de planilhas.

* **💾 Segurança dos Dados:**
  * Função de **Backup Completo** do banco de dados SQLite (`caixa.db`).
  * Armazenamento nativo na pasta de dados do usuário (`AppData`), garantindo permissões de leitura/escrita no Windows.

---

## 🛠️ Tecnologias Utilizadas

* **[Electron.js](https://www.electronjs.org/)** — Framework para desenvolvimento de aplicações desktop cross-platform.
* **[Node.js](https://nodejs.org/)** — Ambiente de execução JavaScript.
* **[SQLite3](https://www.sqlite.org/)** — Banco de dados relacional leve e embutido.
* **[SheetJS (XLSX)](https://sheetjs.com/)** — Processamento e importação de arquivos de planilha (CSV/XLSX).
* **HTML5 / CSS3 / JavaScript (ES6+)** — Interface do usuário responsiva e customizada.
* **Electron Builder** — Empacotamento e compilação do executável instalador (`.exe`).

---

## 🚀 Como Executar o Projeto Localmente

### Pré-requisitos
* [Node.js](https://nodejs.org/) instalado (versão 18 ou superior).
* [Git](https://git-scm.com/) instalado.

### Passo a Passo

1. **Clonar o repositório:**
   ```bash
   git clone https://github.com/SEU_USUARIO/sistema-pdv-queridinha-makeup.git
   cd sistema-pdv-queridinha-makeup
   ```

2. **Instalar as dependências:**
   ```bash
   npm install
   ```

3. **Recompilar módulos nativos (SQLite3):**
   ```bash
   npx electron-builder install-app-deps
   ```

4. **Executar a aplicação em modo de desenvolvimento:**
   ```bash
   npm start
   ```

---

## 📦 Como Gerar o Executável (.exe)

Para compilar o instalador da aplicação para Windows:

```bash
npm run dist
```

O arquivo de instalação gerado estará disponível dentro do diretório `dist/` (ex: `dist/Queridinha Makeup PDV Setup 1.0.0.exe`).

---

## 📄 Licença

Este projeto é de uso privado para a loja **Queridinha Makeup** e está sob a licença ISC.