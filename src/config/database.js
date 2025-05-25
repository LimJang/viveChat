const { Pool } = require('pg');

// PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 데이터베이스 테이블 생성
async function initializeDatabase() {
  try {
    // Users 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        is_admin INTEGER DEFAULT 0,
        money_balance INTEGER DEFAULT 0,
        money_lost INTEGER DEFAULT 0,
        money_won INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_token VARCHAR(255)
      )
    `);

    // Messages 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        nickname VARCHAR(255),
        text TEXT,
        sender VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      )
    `);

    // Graph games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_games (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        crash_multiplier REAL,
        status VARCHAR(50)
      )
    `);

    // Graph bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS graph_bets (
        id SERIAL PRIMARY KEY,
        game_id INTEGER REFERENCES graph_games(id),
        user_id INTEGER REFERENCES users(id),
        bet_amount INTEGER,
        stop_multiplier REAL,
        result VARCHAR(50),
        win_amount INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Baccarat games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS baccarat_games (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        player_card1 VARCHAR(10),
        player_card2 VARCHAR(10),
        player_card3 VARCHAR(10),
        banker_card1 VARCHAR(10),
        banker_card2 VARCHAR(10),
        banker_card3 VARCHAR(10),
        result VARCHAR(50),
        player_point INTEGER,
        banker_point INTEGER
      )
    `);

    // Baccarat bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS baccarat_bets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        game_id INTEGER REFERENCES baccarat_games(id),
        bet_type VARCHAR(50),
        bet_amount INTEGER,
        win_amount INTEGER,
        result VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Slot games 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slot_games (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        bet_amount INTEGER,
        result TEXT,
        win_amount INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Horse race rounds 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS horse_race_rounds (
        id SERIAL PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        horses TEXT,
        result TEXT
      )
    `);

    // Horse race bets 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS horse_race_bets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        round_id INTEGER REFERENCES horse_race_rounds(id),
        horse_id INTEGER,
        amount INTEGER,
        odds REAL,
        paid_rank INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

module.exports = { pool, initializeDatabase };
