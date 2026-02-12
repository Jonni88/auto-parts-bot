const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const Fuse = require('fuse.js');

// ===== КОНФИГУРАЦИЯ =====
const TOKEN = process.env.BOT_TOKEN || '8452664777:AAEzgs_EVjUHBsBu4HdyDQMOcztV4QOdQfA';
const ADMIN_ID = '615528360'; // ID администратора для уведомлений

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

// Инициализация базы данных
const db = new sqlite3.Database('./parts.db');

// Создание таблиц
db.serialize(() => {
  // Таблица запчастей
  db.run(`CREATE TABLE IF NOT EXISTS parts (
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
  )`);

  // Таблица заказов
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    phone TEXT,
    part_id INTEGER,
    part_name TEXT,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Таблица категорий
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    icon TEXT
  )`);
});

// ===== СОСТОЯНИЯ ПОЛЬЗОВАТЕЛЕЙ =====
const userStates = new Map();

// ===== КЛАВИАТУРЫ =====
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔍 Поиск запчасти', '📋 Каталог'],
      ['🛒 Мои заказы', '📞 Контакты'],
      ['❓ Помощь']
    ],
    resize_keyboard: true
  }
};

const adminKeyboard = {
  reply_markup: {
    keyboard: [
      ['➕ Добавить запчасть'],
      ['📦 Все запчасти'],
      ['📊 Статистика'],
      ['🔔 Новые заказы']
    ],
    resize_keyboard: true
  }
};

// ===== ОБРАБОТЧИКИ КОМАНД =====

// Старт
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  const welcomeText = `👋 Добро пожаловать в магазин автозапчастей!

Я помогу вам:
✅ Найти нужную запчасть по названию или артикулу
✅ Узнать наличие и цену
✅ Оформить заказ, если нет в наличии

🔍 Отправьте мне:
• Артикул запчасти (например: 04465-30320)
• Название (например: тормозные колодки Camry)
• Фото детали

Чем могу помочь?`;

  bot.sendMessage(chatId, welcomeText, mainKeyboard);
});

// Админ панель
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() === ADMIN_ID) {
    bot.sendMessage(chatId, '🔐 Панель администратора', adminKeyboard);
  } else {
    bot.sendMessage(chatId, '⛔ У вас нет доступа');
  }
});

// Команда ответа клиенту (только для админа)
bot.onText(/\/reply (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_ID) {
    bot.sendMessage(chatId, '⛔ У вас нет доступа');
    return;
  }
  
  const args = match[1].split(' ');
  if (args.length < 2) {
    bot.sendMessage(chatId, 
      '❌ Неверный формат. Используй:\n' +
      '`/reply [ID клиента] [сообщение]`\n\n' +
      'Пример: `/reply 123456789 Здравствуйте! Ваша запчасть в наличии`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  const clientId = args[0];
  const message = args.slice(1).join(' ');
  
  bot.sendMessage(clientId, 
    `💬 *Сообщение от менеджера:*\n\n${message}`,
    { parse_mode: 'Markdown' }
  )
    .then(() => {
      bot.sendMessage(chatId, `✅ Сообщение отправлено клиенту ${clientId}`);
    })
    .catch(err => {
      bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
    });
});

// ===== ПОИСК ЗАПЧАСТЕЙ =====

// Обработка текстовых сообщений (поиск)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  // Игнорируем команды и кнопки меню
  if (!text || text.startsWith('/') || 
      ['🔍 Поиск запчасти', '📋 Каталог', '🛒 Мои заказы', 
       '📞 Контакты', '❓ Помощь', '➕ Добавить запчасть',
       '📦 Все запчасти', '📊 Статистика', '🔔 Новые заказы'].includes(text)) {
    return;
  }

  // Проверяем состояние пользователя
  const state = userStates.get(userId);
  if (state) {
    handleState(userId, chatId, text, state);
    return;
  }

  // Поиск по артикулу
  if (/^[\w\-]+$/i.test(text) && text.length > 3) {
    searchByArticle(chatId, text);
    return;
  }

  // Поиск по названию
  searchByName(chatId, text);
});

// Поиск по артикулу
function searchByArticle(chatId, article) {
  db.get(
    'SELECT * FROM parts WHERE article = ? COLLATE NOCASE',
    [article],
    (err, part) => {
      if (err) {
        console.error(err);
        bot.sendMessage(chatId, '❌ Ошибка поиска');
        return;
      }

      if (part) {
        showPartDetails(chatId, part);
      } else {
        // Не найдено по артикулу - предлагаем заказать
        const message = `❌ Запчасть с артикулом *${article}* не найдена в базе.

Но мы можем:
✅ Заказать у поставщика (3-7 дней)
✅ Подобрать аналог

📝 Нажмите кнопку ниже, чтобы оставить заявку на поиск:`;

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📝 Оставить заявку на поиск', callback_data: `search_request_${article}` }],
              [{ text: '🔍 Найти что-то ещё', callback_data: 'search_again' }]
            ]
          }
        };

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
      }
    }
  );
}

// Поиск по названию (нечёткий поиск)
function searchByName(chatId, query) {
  db.all('SELECT * FROM parts', [], (err, parts) => {
    if (err) {
      console.error(err);
      bot.sendMessage(chatId, '❌ Ошибка поиска');
      return;
    }

    if (parts.length === 0) {
      bot.sendMessage(chatId, '📭 База запчастей пуста');
      return;
    }

    // Настройка Fuse.js для нечёткого поиска
    const fuse = new Fuse(parts, {
      keys: ['name', 'article', 'brand', 'description'],
      threshold: 0.4,
      includeScore: true
    });

    const results = fuse.search(query);

    if (results.length === 0) {
      const message = `❌ По запросу "*${query}*" ничего не найдено.

Возможно:
• Проверьте правильность написания
• Попробуйте другие ключевые слова
• Отправьте фото детали

📝 Или оставьте заявку — мы найдём запчасть:`;

      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Оставить заявку', callback_data: `search_request_${query}` }],
            [{ text: '🔍 Найти что-то ещё', callback_data: 'search_again' }]
          ]
        }
      };

      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
      return;
    }

    // Показываем результаты (максимум 5)
    const topResults = results.slice(0, 5);
    
    let message = `🔍 Найдено ${results.length} запчастей:\n\n`;
    
    const inlineKeyboard = topResults.map(result => {
      const part = result.item;
      const status = part.availability > 0 ? '✅' : '⏳';
      return [{ 
        text: `${status} ${part.name} (${part.brand}) — ${part.price}₽`,
        callback_data: `part_${part.id}`
      }];
    });

    // Добавляем кнопку "Найти что-то ещё"
    inlineKeyboard.push([{ 
      text: '🔍 Найти что-то ещё', 
      callback_data: 'search_again' 
    }]);

    bot.sendMessage(chatId, message, {
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  });
}

// Показать детали запчасти
function showPartDetails(chatId, part) {
  const availabilityText = part.availability > 0 
    ? `✅ В наличии: ${part.availability} шт.`
    : `⏳ Нет в наличии. Доставка: ${part.delivery_days} дней`;

  const price = part.availability > 0 ? part.price : (part.order_price || part.price);
  
  const message = `📦 *${part.name}*

🏷 Артикул: \`${part.article}\`
🏭 Производитель: ${part.brand}
💰 Цена: *${price}₽*
${availabilityText}

📝 ${part.description || 'Описание отсутствует'}`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ 
          text: part.availability > 0 ? '🛒 Купить' : '📝 Заказать', 
          callback_data: `buy_${part.id}` 
        }],
        [{ 
          text: '📞 Связаться с менеджером', 
          url: 'https://t.me/manager_username' 
        }],
        [{
          text: '🔍 Найти что-то ещё',
          callback_data: 'search_again'
        }]
      ]
    }
  };

  if (part.photo_url) {
    bot.sendPhoto(chatId, part.photo_url, { 
      caption: message, 
      parse_mode: 'Markdown',
      ...keyboard 
    });
  } else {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown', 
      ...keyboard 
    });
  }
}

// ===== ОБРАБОТКА КНОПОК =====

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const userId = query.from.id;

  bot.answerCallbackQuery(query.id);

  // Показать детали запчасти
  if (data.startsWith('part_')) {
    const partId = data.split('_')[1];
    db.get('SELECT * FROM parts WHERE id = ?', [partId], (err, part) => {
      if (part) showPartDetails(chatId, part);
    });
  }

  // Купить/заказать
  if (data.startsWith('buy_')) {
    const partId = data.split('_')[1];
    startOrderProcess(userId, chatId, partId);
  }

  // Заявка на поиск
  if (data.startsWith('search_request_')) {
    const queryText = data.replace('search_request_', '');
    startSearchRequest(userId, chatId, queryText);
  }

  // Найти что-то ещё
  if (data === 'search_again') {
    bot.sendMessage(chatId, 
      '🔍 Введите артикул или название запчасти для нового поиска:'
    );
  }

  // Ответить клиенту (только для админа)
  if (data.startsWith('reply_') && chatId.toString() === ADMIN_ID) {
    const clientId = data.split('_')[1];
    userStates.set(userId, {
      state: 'admin_replying',
      clientId: clientId
    });
    bot.sendMessage(chatId, 
      `💬 Введите сообщение для клиента:\n\n` +
      `Клиент получит сообщение от имени бота.`
    );
  }
});

// ===== ПРОЦЕСС ЗАКАЗА =====

function startOrderProcess(userId, chatId, partId) {
  db.get('SELECT * FROM parts WHERE id = ?', [partId], (err, part) => {
    if (!part) return;

    userStates.set(userId, {
      state: 'awaiting_phone',
      partId: partId,
      partName: part.name,
      quantity: 1
    });

    const message = part.availability > 0
      ? `🛒 Вы выбрали: *${part.name}*\n\n💰 Цена: ${part.price}₽\n📦 В наличии: ${part.availability} шт.\n\n📞 Укажите ваш номер телефона для связи:`
      : `📝 Заказ: *${part.name}*\n\n💰 Цена под заказ: ${part.order_price || part.price}₽\n⏳ Срок доставки: ${part.delivery_days} дней\n\n📞 Укажите ваш номер телефона для связи:`;

    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    });
  });
}

// Заявка на поиск запчасти
function startSearchRequest(userId, chatId, queryText) {
  userStates.set(userId, {
    state: 'search_request',
    query: queryText
  });

  bot.sendMessage(chatId, 
    `📝 Заявка на поиск запчасти\n\n` +
    `Вы ищете: *${queryText}*\n\n` +
    `📞 Укажите ваш номер телефона, и мы свяжемся с вами:`,
    { parse_mode: 'Markdown' }
  );
}

// Обработка состояний
function handleState(userId, chatId, text, state) {
  // Ожидание телефона для заказа
  if (state.state === 'awaiting_phone') {
    const phone = text.replace(/\D/g, '');
    
    if (phone.length < 10) {
      bot.sendMessage(chatId, '❌ Неверный номер телефона. Попробуйте ещё раз:');
      return;
    }

    // Сохраняем заказ
    db.run(
      `INSERT INTO orders (user_id, username, phone, part_id, part_name, quantity) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, state.username || '', phone, state.partId, state.partName, state.quantity],
      function(err) {
        if (err) {
          console.error(err);
          bot.sendMessage(chatId, '❌ Ошибка оформления заказа');
          return;
        }

        // Уведомление администратору
        const orderId = this.lastID;
        const adminMessage = `🔔 *Новый заказ!*\n\n` +
          `📦 Запчасть: ${state.partName}\n` +
          `📞 Телефон: +${phone}\n` +
          `👤 Клиент: @${state.username || 'нет username'}\n` +
          `🆔 ID заказа: ${orderId}`;

        // Уведомление администратору с кнопкой ответа
        const adminKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💬 Ответить клиенту', callback_data: `reply_${chatId}` }],
              [{ text: '📞 Позвонить', url: `tel:+${phone}` }]
            ]
          }
        };

        bot.sendMessage(ADMIN_ID, adminMessage, { 
          parse_mode: 'Markdown',
          ...adminKeyboard
        })
          .then(() => console.log(`✅ Уведомление админу отправлено. Заказ #${orderId}`))
          .catch(err => console.error(`❌ Ошибка отправки админу:`, err.message));

        // Подтверждение клиенту
        bot.sendMessage(chatId, 
          `✅ Заказ оформлен!\n\n` +
          `📦 ${state.partName}\n` +
          `📞 Мы свяжемся с вами по номеру +${phone}\n\n` +
          `🆔 Номер заказа: ${orderId}`,
          mainKeyboard
        );

        userStates.delete(userId);
      }
    );
  }

  // Заявка на поиск
  if (state.state === 'search_request') {
    const phone = text.replace(/\D/g, '');
    
    if (phone.length < 10) {
      bot.sendMessage(chatId, '❌ Неверный номер телефона. Попробуйте ещё раз:');
      return;
    }

    // Уведомление администратору
    const adminMessage = `🔍 *Заявка на поиск запчасти!*\n\n` +
      `🔎 Запрос: ${state.query}\n` +
      `📞 Телефон: +${phone}\n` +
      `👤 Клиент: @${state.username || 'нет username'}`;

    // Уведомление администратору с кнопкой ответа
    const adminKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 Ответить клиенту', callback_data: `reply_${userId}` }],
          [{ text: '📞 Позвонить', url: `tel:+${phone}` }]
        ]
      }
    };

    bot.sendMessage(ADMIN_ID, adminMessage, { 
      parse_mode: 'Markdown',
      ...adminKeyboard
    })
      .then(() => console.log(`✅ Уведомление админу отправлено (поиск)`))
      .catch(err => console.error(`❌ Ошибка отправки админу:`, err.message));

    bot.sendMessage(chatId, 
      `✅ Заявка принята!\n\n` +
      `🔎 Мы ищем: "${state.query}"\n` +
      `📞 Свяжемся с вами по номеру +${phone}\n\n` +
      `Обычно поиск занимает 10-30 минут в рабочее время.`,
      mainKeyboard
    );

    userStates.delete(userId);
  }

  // Админ отвечает клиенту
  if (state.state === 'admin_replying') {
    const clientId = state.clientId;
    const adminMessage = text;
    
    // Отправляем сообщение клиенту
    bot.sendMessage(clientId, 
      `💬 *Сообщение от менеджера:*\n\n${adminMessage}`,
      { parse_mode: 'Markdown' }
    )
      .then(() => {
        bot.sendMessage(chatId, '✅ Сообщение отправлено клиенту!');
        console.log(`✅ Админ ответил клиенту ${clientId}`);
      })
      .catch(err => {
        bot.sendMessage(chatId, `❌ Не удалось отправить: ${err.message}`);
        console.error(`❌ Ошибка отправки клиенту:`, err);
      });
    
    userStates.delete(userId);
  }
}

// ===== ОБРАБОТКА КНОПОК МЕНЮ =====

bot.onText(/🔍 Поиск запчасти/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    '🔍 Введите название запчасти, артикул или отправьте фото:', 
    { reply_markup: { remove_keyboard: true } }
  );
});

bot.onText(/📋 Каталог/, (msg) => {
  const chatId = msg.chat.id;
  
  db.all('SELECT DISTINCT category FROM parts WHERE category IS NOT NULL', [], (err, categories) => {
    if (categories.length === 0) {
      bot.sendMessage(chatId, '📭 Каталог пуст');
      return;
    }

    const keyboard = categories.map(cat => ({
      text: cat.category,
      callback_data: `category_${cat.category}`
    }));

    // Разбиваем на строки по 2 кнопки
    const rows = [];
    for (let i = 0; i < keyboard.length; i += 2) {
      rows.push(keyboard.slice(i, i + 2));
    }

    bot.sendMessage(chatId, '📋 Выберите категорию:', {
      reply_markup: { inline_keyboard: rows }
    });
  });
});

bot.onText(/🛒 Мои заказы/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.all(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
    [userId],
    (err, orders) => {
      if (orders.length === 0) {
        bot.sendMessage(chatId, '📭 У вас пока нет заказов');
        return;
      }

      let message = '🛒 *Ваши заказы:*\n\n';
      orders.forEach((order, idx) => {
        const status = order.status === 'new' ? '🆕 Новый' : 
                      order.status === 'processing' ? '⏳ В обработке' :
                      order.status === 'ready' ? '✅ Готов к выдаче' : '📦 Выдан';
        
        message += `${idx + 1}. ${order.part_name}\n` +
                   `   Статус: ${status}\n` +
                   `   Дата: ${order.created_at}\n\n`;
      });

      bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
  );
});

bot.onText(/📞 Контакты/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📞 *Наши контакты:*\n\n` +
    `📱 Телефон: +7 (XXX) XXX-XX-XX\n` +
    `📍 Адрес: г. Якутск, ул. ...\n` +
    `🕐 Режим работы: Пн-Пт 9:00-18:00, Сб 10:00-15:00\n\n` +
    `🚗 Доставка по городу бесплатно!`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/❓ Помощь/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `❓ *Как пользоваться ботом:*\n\n` +
    `1️⃣ Отправьте артикул запчасти (например: 04465-30320)\n` +
    `2️⃣ Или опишите деталь словами (например: тормозные колодки Camry 50)\n` +
    `3️⃣ Или отправьте фото детали\n\n` +
    `🔍 Бот найдёт запчасть в базе и покажет:\n` +
    `• Наличие на складе\n` +
    `• Цену\n` +
    `• Срок доставки (если нет в наличии)\n\n` +
    `💡 Если запчасти нет — мы найдём и закажем!`,
    { parse_mode: 'Markdown' }
  );
});

// ===== АДМИНКА =====

bot.onText(/➕ Добавить запчасть/, (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  
  userStates.set(msg.from.id, { state: 'admin_add_article' });
  bot.sendMessage(msg.chat.id, 'Введите артикул запчасти:');
});

// ... (дополнительные админ-команды)

// ===== ОБРАБОТКА ФОТО =====

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  
  bot.sendMessage(chatId,
    '📸 Фото получено!\n\n' +
    'Мы передали его менеджеру для распознавания.\n' +
    'Обычно ответ приходит в течение 15-30 минут.\n\n' +
    'Или вы можете сразу позвонить: +7 (XXX) XXX-XX-XX',
    mainKeyboard
  );

  // Отправляем фото администратору
  if (msg.photo && msg.photo.length > 0) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const username = msg.from.username || 'нет username';
    
    bot.sendPhoto(ADMIN_ID, fileId, {
      caption: `🔍 Запрос по фото\n\nОт: @${username}\nID: ${msg.from.id}\n\nНужно распознать запчасть и ответить клиенту.`
    });
  }
});

console.log('🤖 Бот запущен!');
