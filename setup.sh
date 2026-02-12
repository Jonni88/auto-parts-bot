#!/bin/bash

echo "🤖 Установка бота для автозапчастей"
echo "===================================="

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен!"
    echo "Установите: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js найден"

# Установка зависимостей
echo "📦 Установка зависимостей..."
npm install

# Создание .env файла
echo ""
echo "📝 Настройка конфигурации..."

read -p "Введите токен бота (от @BotFather): " BOT_TOKEN
read -p "Введите ваш Telegram ID (от @userinfobot): " ADMIN_ID

# Сохранение в .env
echo "BOT_TOKEN=$BOT_TOKEN" > .env
echo "ADMIN_ID=$ADMIN_ID" >> .env

# Обновление bot.js с токеном
sed -i "s/ВАШ_ТОКЕН_ЗДЕСЬ/$BOT_TOKEN/g" bot.js
sed -i "s/ВАШ_TELEGRAM_ID/$ADMIN_ID/g" bot.js

# Создание структуры БД
echo ""
echo "🗄️ Создание базы данных..."
node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./parts.db');

db.serialize(() => {
  db.run(\`CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    price INTEGER,
    availability INTEGER DEFAULT 0,
    delivery_days INTEGER DEFAULT 3,
    order_price INTEGER,
    photo_url TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`);

  db.run(\`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    phone TEXT,
    part_id INTEGER,
    part_name TEXT,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`);

  db.run(\`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    icon TEXT
  )\`);
});

console.log('✅ База данных создана');
db.close();
"

# Добавление тестовых данных
echo ""
read -p "Добавить тестовые данные (запчасти)? (y/n): " ADD_TEST

if [ "$ADD_TEST" = "y" ]; then
    node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./parts.db');

const testParts = [
  ['04465-30320', 'Тормозные колодки передние Camry 50', 'Тормозная система', 'Toyota', 2800, 5, 3, 2500, 'Оригинальные колодки для Toyota Camry 50, 55'],
  ['04465-33471', 'Тормозные колодки передние Land Cruiser 200', 'Тормозная система', 'Toyota', 4500, 0, 5, 4200, 'Передние колодки для LC 200, Lexus LX 570'],
  ['90919-02252', 'Катушка зажигания Corolla/Camry', 'Двигатель', 'Toyota', 3200, 3, 7, 2900, 'Оригинальная катушка зажигания 1ZZ/2AZ'],
  ['17801-31090', 'Воздушный фильтр Camry 50/Highlander', 'Фильтры', 'Toyota', 1200, 10, 3, 1100, 'Оригинальный воздушный фильтр'],
  ['04152-31090', 'Масляный фильтр Toyota/Lexus', 'Фильтры', 'Toyota', 450, 20, 3, 400, 'Оригинальный масляный фильтр']
];

testParts.forEach(part => {
  db.run(\`INSERT OR IGNORE INTO parts (article, name, category, brand, price, availability, delivery_days, order_price, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`, part);
});

console.log('✅ Тестовые данные добавлены');
db.close();
"
fi

echo ""
echo "===================================="
echo "✅ Установка завершена!"
echo ""
echo "🚀 Для запуска бота:"
echo "   npm start"
echo ""
echo "📖 Документация: README.md"
echo ""
