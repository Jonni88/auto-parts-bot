const fs = require('fs');
const csv = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();

// Скрипт для импорта запчастей из CSV файла
// Формат CSV: article,name,category,brand,price,availability,delivery_days,order_price,description

const db = new sqlite3.Database('./parts.db');

function importCSV(filename) {
  const results = [];
  
  fs.createReadStream(filename)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      console.log(`📊 Найдено ${results.length} записей в CSV`);
      
      let success = 0;
      let errors = 0;
      
      results.forEach((row, index) => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO parts 
          (article, name, category, brand, price, availability, delivery_days, order_price, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run([
          row.article,
          row.name,
          row.category,
          row.brand,
          parseInt(row.price) || 0,
          parseInt(row.availability) || 0,
          parseInt(row.delivery_days) || 3,
          parseInt(row.order_price) || parseInt(row.price) || 0,
          row.description || ''
        ], (err) => {
          if (err) {
            console.error(`❌ Ошибка в строке ${index + 1}:`, err.message);
            errors++;
          } else {
            success++;
          }
        });
        
        stmt.finalize();
      });
      
      setTimeout(() => {
        console.log(`\n✅ Импорт завершён!`);
        console.log(`   Успешно: ${success}`);
        console.log(`   Ошибок: ${errors}`);
        db.close();
      }, 1000);
    });
}

// Пример CSV файла:
const exampleCSV = `article,name,category,brand,price,availability,delivery_days,order_price,description
04465-30320,Тормозные колодки передние Camry 50,Тормозная система,Toyota,2800,5,3,2500,Оригинальные колодки
90919-02252,Катушка зажигания Corolla,Двигатель,Toyota,3200,3,7,2900,Катушка 1ZZ/2AZ
`;

if (process.argv.length < 3) {
  console.log('📋 Использование: node import-csv.js файл.csv');
  console.log('\nПример CSV:');
  console.log(exampleCSV);
  process.exit(1);
}

const filename = process.argv[2];

if (!fs.existsSync(filename)) {
  console.error(`❌ Файл ${filename} не найден!`);
  process.exit(1);
}

importCSV(filename);
