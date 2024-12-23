const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const WebSocket = require('ws');

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'images', 'avatars'));
    },
    filename: (req, file, cb) => {
        const fileName = Date.now().toString() + path.extname(file.originalname);
        cb(null, fileName); // Запись уникального имени
    }
});

const postStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'images', 'posts'));
    },
    filename: (req, file, cb) => {
        const fileName = Date.now().toString() + path.extname(file.originalname);
        cb(null, fileName); // Запись уникального имени
    }
});

const uploadAvatar = multer({ storage: avatarStorage });
const uploadPost = multer({ storage: postStorage });

const app = express();
app.use(bodyParser.json());
app.use(cors());

const IMAGE_FOLDER = path.join(__dirname, 'images');

const pool = new Pool({
    user: 'MobileDatabase',
    host: '79.174.89.57',
    database: '2024_psql_dan',
    password: '3YEG6v*/CY6FdtT8bIdhD)ar',
    port: 16988,
});

const wss = new WebSocket.Server({ port: 8080 });
let clients = [];

wss.on('connection', (ws, req) => {
  const sender = new URLSearchParams(req.url.split('?')[1]).get('sender');
  const receiver = new URLSearchParams(req.url.split('?')[1]).get('receiver');
  console.log(`New connection: ${sender} -> ${receiver}`);

  clients.push(ws);

  ws.on('message', async (message) => {
    const msgData = JSON.parse(message);
    console.log('Received message:', msgData);

    // Сохранение сообщения
    try {
        await pool.query(
            `INSERT INTO messages (sender, receiver, message, timestamp) VALUES ($1, $2, $3, NOW())`,
            [msgData.sender, msgData.receiver, msgData.message]
        );

        broadcastMessage(msgData);
    } catch (error) {
        console.error('Ошибка при сохранении сообщения в базе данных:', error);
    }
  });

  ws.on('close', () => {
    clients = clients.filter(client => client !== ws);
  });
});

console.log("WebSocket запущен, путь://localhost:8080");

let lastSentMessages = new Set();

function broadcastMessage(data) {
    const messageId = `${data.timestamp}-${data.sender}-${data.receiver}-${data.message}`;

    if (lastSentMessages.has(messageId)) {
        console.log('Сообщение уже отправлено!:', messageId);
        return;
    }

    lastSentMessages.add(messageId);

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

app.post('/send-message', async (req, res) => {
    const { sender, receiver, message } = req.body;

    if (!sender || !receiver || !message) {
        return res.status(400).json({ error: 'Все поля обязательны!' });
    }

    try {
        await pool.query(
            `INSERT INTO messages (sender, receiver, message, timestamp) VALUES ($1, $2, $3, NOW())`,
            [sender, receiver, message]
        );
        
        broadcastMessage({ sender, receiver, message });

        res.status(201).json({ message: 'Сообщение отправлено!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при отправке сообщения!' });
    }
});

app.get('/get-messages', async (req, res) => {
    const { sender, receiver } = req.query;

    if (!sender || !receiver) {
        return res.status(400).json({ error: 'Отправитель и получатель обязательны!' });
    }

    try {
        const result = await pool.query(
            `SELECT sender, receiver, message, TO_CHAR(timestamp, 'YYYY-MM-DD HH24:MI:SS') AS timestamp 
            FROM messages WHERE (sender = $1 AND receiver = $2) OR (sender = $2 AND receiver = $1) 
            ORDER BY timestamp ASC`,
            [sender, receiver]
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при получении сообщений!' });
    }
});

app.post('/register', async (req, res) => {
    const { login, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM "user" WHERE login = $1`, [login]);
        if (result.rows.length > 0) {
            return res.status(400).json({ error: 'Такой логин уже существует!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const insertResult = await pool.query(
            `INSERT INTO "user" (login, password, is_profile_complete) VALUES ($1, $2, $3) RETURNING id`,
            [login, hashedPassword, false]
        );
        const userId = insertResult.rows[0].id;
        const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'your_jwt_secret');
        res.status(201).json({ token });  // Возвращаем токен
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка регистрации!' });
    }
});

app.post('/create-profile', uploadAvatar.single('avatar'), async (req, res) => {
    const { login, name, description } = req.body;
    const avatarUrl = req.file ? `${req.file.filename}` : null;

    try {
        const updateResult = await pool.query(
            `UPDATE "user" SET name = $1, description = $2, avatar_url = $3, is_profile_complete = $4 WHERE login = $5 RETURNING *`,
            [name, description, avatarUrl, true, login]
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден!' });
        }
        res.status(201).json({ message: 'Профиль успешно создан!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка создания профиля!' });
    }
});

app.post('/get-profile', async (req, res) => {
    const { login } = req.body;
    try {
      const result = await pool.query(`SELECT login, name, description, avatar_url FROM "user" WHERE login = $1`, [login]);
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
  
      const avatarUrl = result.rows[0].avatar_url ? `http://79.174.95.226:3000/images/avatars/${result.rows[0].avatar_url}` : null;
  
      res.json({
        login: result.rows[0].login,
        name: result.rows[0].name,
        description: result.rows[0].description,
        avatarUrl: avatarUrl,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Ошибка получения профиля!' });
    }
});  

app.post('/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const result =  await pool.query(`SELECT * FROM "user" WHERE login = $1`, 
            [login]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'f41c73428d98fd19c35858d295343a1da40ea0d6736b424b1e215333b3254b01');
            res.json({ token });
        }
        else {
            res.status(404).json({error: 'Ошибка!'});
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошщибка авторизации!'});
    }
});

app.post('/create-post', uploadPost.single('image'), async (req, res) => {
    const { description, login } = req.body;
    const imageUrl = req.file ? req.file.filename : null;

    if (!description || !login || !imageUrl) {
        return res.status(400).json({ error: 'Описание, логин и изображение обязательны!' });
    }

    try {
        const userResult = await pool.query(`SELECT id FROM "user" WHERE login = $1`, [login]);
        if (userResult.rowCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден!' });
        }
        const userId = userResult.rows[0].id;

        const postResult = await pool.query(
            `INSERT INTO post (date, description, image_url) VALUES (NOW(), $1, $2) RETURNING id_post`,
            [description, imageUrl]
        );
        const postId = postResult.rows[0].id_post;

        await pool.query(
            `INSERT INTO user_post (id_user, id_post) VALUES ($1, $2)`,
            [userId, postId]
        );

        res.status(201).json({ message: 'Пост успешно создан!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка создания поста!' });
    }
});

app.get('/get-posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id_post, TO_CHAR(p.date, 'YYYY-MM-DD HH24:MI:SS') AS date, p.description, 
                p.image_url, 
                u.login, 
                u.name, 
                u.avatar_url
            FROM post p
            JOIN user_post up ON up.id_post = p.id_post
            JOIN "user" u ON u.id = up.id_user
            ORDER BY p.id_post ASC
        `);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Нет постов для отображения!' });
        }

        const posts = result.rows.map(post => ({
            id_post: post.id_post,
            date: post.date,
            description: post.description,
            image_url: post.image_url ? `http://79.174.95.226:3000/images/posts/${post.image_url}` : null,
            username: post.name,
            avatar_url: post.avatar_url ? `http://79.174.95.226:3000/images/avatars/${post.avatar_url}` : null,
            user_login: post.login,
        }));

        res.json({ posts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка получения постов!' });
    }
});

app.get('/get-posts-profile', async (req, res) => {
    try {
        const login = req.query.login;
        
        const result = await pool.query(`
            SELECT 
                p.id_post, TO_CHAR(p.date, 'YYYY-MM-DD HH24:MI:SS') AS date, p.description, p.image_url, u.login, u.name, u.avatar_url
            FROM post p
            JOIN user_post up ON up.id_post = p.id_post
            JOIN "user" u ON u.id = up.id_user
            WHERE u.login = $1
            ORDER BY p.date ASC
        `, [login]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Нет постов для отображения!' });
        }

        const posts = result.rows.map(post => ({
            id_post: post.id_post,
            date: post.date,
            description: post.description,
            image_url: post.image_url ? `http://79.174.95.226:3000/images/posts/${post.image_url}` : null,
            username: post.name,
            avatar_url: post.avatar_url ? `http://79.174.95.226:3000/images/avatars/${post.avatar_url}` : null
        }));

        res.json({ posts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка получения постов!' });
    }
});

app.post('/edit-profile', uploadAvatar.single('avatar'), async (req, res) => {
    const { login, name, description } = req.body;
    const avatarUrl = req.file ? `${req.file.filename}` : null;

    try {
        const updateResult = await pool.query(
            `UPDATE "user" SET name = $1, description = $2, avatar_url = COALESCE($3, avatar_url), is_profile_complete = $4 WHERE login = $5 RETURNING *`,
            [name, description, avatarUrl, true, login]
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден!' });
        }

        res.status(201).json({ message: 'Профиль успешно обновлён!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка изменения профиля!' });
    }
});

app.get('/images/posts/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(IMAGE_FOLDER, 'posts', filename);

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            console.error(`Файл ${filename} не найден.`);
            return res.status(404).json({ error: 'Файл не найден' });
        }

        res.sendFile(filePath);
    });
});

app.get('/images/avatars/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(IMAGE_FOLDER, 'avatars', filename);

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            console.error(`Файл ${filename} не найден.`);
            return res.status(404).json({ error: 'Файл не найден' });
        }

        res.sendFile(filePath);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Сервер запущен и работает на порту ${PORT}`);
})
