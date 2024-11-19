const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const multer = require('multer');

// Настройка multer для хранения изображений в папке 'images/avatars'
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, 'images', 'avatars')); // Папка для хранения
    },
    filename: (req, file, cb) => {
      const fileName = Date.now().toString() + path.extname(file.originalname);
      cb(null, fileName); // Генерация уникального имени файла
    }
});

const upload = multer({ storage });

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Папка с изображениями
const IMAGE_FOLDER = path.join(__dirname, 'images');

const pool = new Pool({
    user: '2024_psql_d_usr',
    host: '5.183.188.132',
    database: '2024_psql_dan',
    password: 'hq7L54hC9LEc7YzC',
    port: 5432,
});

app.post('/register', async (req, res) => {
    const { login, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM "user" WHERE login = $1', [login]);
        if (result.rows.length > 0) {
            return res.status(400).json({ error: 'Такой логин уже существует!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const insertResult = await pool.query(
            'INSERT INTO "user" (login, password, is_profile_complete) VALUES ($1, $2, $3) RETURNING id',
            [login, hashedPassword, false]
        );
        const userId = insertResult.rows[0].id;

        // Генерация токена при регистрации
        const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'your_jwt_secret');
        res.status(201).json({ token });  // Возвращаем токен
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка регистрации!' });
    }
});

// Обработчик маршрута /create-profile
app.post('/create-profile', upload.single('avatar'), async (req, res) => {
    const { login, name, description } = req.body;
    const avatarUrl = req.file ? `${req.file.filename}` : null;

    try {
        const updateResult = await pool.query(
            'UPDATE "user" SET name = $1, description = $2, avatar_url = $3, is_profile_complete = $4 WHERE login = $5 RETURNING *',
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
      const result = await pool.query('SELECT login, name, description, avatar_url FROM "user" WHERE login = $1', [login]);
  
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
  
      // Получаем полный URL для аватара
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
        const result =  await pool.query('SELECT * FROM "user" WHERE login = $1', 
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

app.post('/create-post', upload.single('image'), async (req, res) => {
    const { description, login } = req.body;
    const imageUrl = req.file ? req.file.filename : null;

    if (!description || !login || !imageUrl) {
        return res.status(400).json({ error: 'Описание, логин и изображение обязательны!' });
    }

    try {
        // Получение ID пользователя по логину
        const userResult = await pool.query('SELECT id FROM "user" WHERE login = $1', [login]);
        if (userResult.rowCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден!' });
        }
        const userId = userResult.rows[0].id;

        // Вставка поста в таблицу post
        const postResult = await pool.query(
            'INSERT INTO post (date, description, image_url) VALUES (NOW(), $1, $2) RETURNING id_post',
            [description, imageUrl]
        );
        const postId = postResult.rows[0].id_post;

        // Вставка данных в таблицу user_post
        await pool.query(
            'INSERT INTO user_post (id_user, id_post) VALUES ($1, $2)',
            [userId, postId]
        );

        res.status(201).json({ message: 'Пост успешно создан!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка создания поста!' });
    }
});

// Endpoint to fetch all posts
app.get('/get-posts', async (req, res) => {
    try {
        // Query to fetch all posts along with associated user information (if needed)
        const result = await pool.query(`
            SELECT p.id_post, p.date, p.description, p.image_url
            FROM post p
            ORDER BY p.date DESC
        `);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Нет постов для отображения!' });
        }

        // Map posts to include the image URL path correctly
        const posts = result.rows.map(post => ({
            id_post: post.id_post,
            date: post.date,
            description: post.description,
            image_url: post.image_url ? `http://79.174.95.226:3000/images/posts/${post.image_url}` : null
        }));

        res.json({ posts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка получения постов!' });
    }
});

// Эндпоинт для получения изображения поста
app.get('/images/posts/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(IMAGE_FOLDER, 'posts', filename);

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            console.error(`Файл ${filename} не найден.`);
            return res.status(404).json({ error: 'Файл не найден' });
        }

        res.sendFile(filePath); // Отправляем изображение
    });
});

// Эндпоинт для получения изображения аватара
app.get('/images/avatars/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(IMAGE_FOLDER, 'avatars', filename);

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            console.error(`Файл ${filename} не найден.`);
            return res.status(404).json({ error: 'Файл не найден' });
        }

        res.sendFile(filePath); // Отправляем изображение
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Сервер запущен и работает на порту ${PORT}`);
})

