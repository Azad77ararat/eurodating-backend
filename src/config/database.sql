-- EuroDating Database Schema
CREATE DATABASE IF NOT EXISTS eurodating_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE eurodating_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  gender ENUM('male', 'female', 'other') NOT NULL,
  looking_for ENUM('male', 'female', 'both') DEFAULT 'both',
  country VARCHAR(100),
  city VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  bio TEXT,
  occupation VARCHAR(200),
  education ENUM('none','school','bachelor','master','phd') DEFAULT 'none',
  height INT,
  body_type ENUM('slim','athletic','average','curvy','heavy') DEFAULT 'average',
  relationship_goal ENUM('casual','serious','friendship','marriage') DEFAULT 'serious',
  language_preference VARCHAR(10) DEFAULT 'de',
  profile_photo VARCHAR(500),
  is_verified BOOLEAN DEFAULT FALSE,
  is_online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subscription_type ENUM('free','monthly','6months','yearly','lifetime') DEFAULT 'free',
  subscription_expires_at TIMESTAMP NULL,
  stripe_customer_id VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  is_banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- User photos
CREATE TABLE IF NOT EXISTS user_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  photo_url VARCHAR(500) NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User interests/hobbies
CREATE TABLE IF NOT EXISTS user_interests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  interest VARCHAR(100) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Swipes (likes/dislikes)
CREATE TABLE IF NOT EXISTS swipes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  swiper_id INT NOT NULL,
  swiped_id INT NOT NULL,
  action ENUM('like','dislike','superlike') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_swipe (swiper_id, swiped_id),
  FOREIGN KEY (swiper_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (swiped_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user1_id INT NOT NULL,
  user2_id INT NOT NULL,
  matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE KEY unique_match (user1_id, user2_id),
  FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  match_id INT NOT NULL,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  content TEXT,
  message_type ENUM('text','image','emoji','gif') DEFAULT 'text',
  media_url VARCHAR(500),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  stripe_subscription_id VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  plan_type ENUM('monthly','6months','yearly','lifetime') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'EUR',
  status ENUM('active','cancelled','expired','pending') DEFAULT 'pending',
  starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  reported_id INT NOT NULL,
  reason ENUM('spam','fake','inappropriate','harassment','other') NOT NULL,
  description TEXT,
  status ENUM('pending','reviewed','resolved') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blocker_id INT NOT NULL,
  blocked_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_block (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Profile views
CREATE TABLE IF NOT EXISTS profile_views (
  id INT AUTO_INCREMENT PRIMARY KEY,
  viewer_id INT NOT NULL,
  viewed_id INT NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (viewed_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('match','message','like','view','subscription') NOT NULL,
  title VARCHAR(255),
  body TEXT,
  data JSON,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_users_location ON users(latitude, longitude);
CREATE INDEX idx_users_gender ON users(gender, looking_for);
CREATE INDEX idx_swipes_swiper ON swipes(swiper_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- Daily swipe limits tracking
CREATE TABLE IF NOT EXISTS daily_swipes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  swipe_date DATE NOT NULL DEFAULT (CURDATE()),
  swipe_count INT DEFAULT 0,
  UNIQUE KEY unique_daily (user_id, swipe_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
