-- MySQL schema for Vivago Pass Zero-Knowledge authentication & storage

CREATE DATABASE IF NOT EXISTS `vivago_pass`;
USE `vivago_pass`;

-- Table to store users info (Zero-Knowledge authentication details)
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) DEFAULT 'User',
  `plan` VARCHAR(50) DEFAULT 'starter',
  `auth_key_hash` VARCHAR(255) NOT NULL, -- bcrypt/argon2 hash of the client's derived auth key
  `is_verified` TINYINT(1) DEFAULT 0, -- OTP verification status
  `otp_code` VARCHAR(6) DEFAULT NULL, -- current active OTP code
  `otp_expires_at` BIGINT DEFAULT NULL, -- OTP expiration timestamp
  `encrypted_master_key` BLOB DEFAULT NULL, -- Wrapped master key
  `master_key_iv` BINARY(12) DEFAULT NULL,
  `master_key_auth_tag` BINARY(16) DEFAULT NULL,
  `public_key` TEXT DEFAULT NULL, -- Plaintext RSA-OAEP public key for sharing
  `encrypted_private_key` BLOB DEFAULT NULL, -- RSA-OAEP private key encrypted with master key
  `private_key_iv` BINARY(12) DEFAULT NULL,
  `private_key_auth_tag` BINARY(16) DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Table to store encrypted secrets/vault items
CREATE TABLE IF NOT EXISTS `vault_items` (
  `id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `type` VARCHAR(50) NOT NULL, -- e.g. login, card, note, identity, ssh_key
  `name` VARCHAR(255) NOT NULL,
  `notes` TEXT,
  `ciphertext` BLOB NOT NULL, -- Binary raw encrypted data
  `iv` BINARY(12) NOT NULL, -- Binary raw 12-byte initialization vector
  `auth_tag` BINARY(16) NOT NULL, -- Binary raw 16-byte authentication tag
  `last_modified` BIGINT NOT NULL, -- Epoch ms timestamp
  PRIMARY KEY (`id`),
  KEY `fk_vault_items_user` (`user_id`),
  CONSTRAINT `fk_vault_items_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to store encrypted backup/recovery keys
CREATE TABLE IF NOT EXISTS `user_backup_codes` (
  `id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `code_hash` VARCHAR(255) NOT NULL,
  `encrypted_master_key` BLOB NOT NULL,
  `iv` BINARY(12) NOT NULL,
  `auth_tag` BINARY(16) NOT NULL,
  `is_used` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_backup_codes_user` (`user_id`),
  CONSTRAINT `fk_backup_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to store shared items encrypted with receiver's public key
CREATE TABLE IF NOT EXISTS `shared_items` (
  `id` VARCHAR(255) NOT NULL,
  `sender_id` VARCHAR(255) NOT NULL,
  `receiver_id` VARCHAR(255) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `ciphertext` BLOB NOT NULL,
  `encrypted_key` BLOB NOT NULL,
  `iv` BINARY(12) NOT NULL,
  `auth_tag` BINARY(16) NOT NULL,
  `shared_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_shared_items_sender` (`sender_id`),
  KEY `fk_shared_items_receiver` (`receiver_id`),
  CONSTRAINT `fk_shared_items_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_shared_items_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Table to store metadata references to uploaded file attachments (Zero-Knowledge)
CREATE TABLE IF NOT EXISTS `attachments` (
  `id` VARCHAR(255) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `vault_item_id` VARCHAR(255) DEFAULT NULL, -- Linked vault item
  `encrypted_metadata` BLOB NOT NULL,       -- Encrypted JSON: { name, type, originalSize }
  `metadata_iv` BINARY(12) NOT NULL,
  `metadata_auth_tag` BINARY(16) NOT NULL,
  `file_path` VARCHAR(512) NOT NULL,         -- Path to the encrypted blind file on server disk
  `file_size` INT NOT NULL,                  -- Size of encrypted payload
  `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_attachments_user` (`user_id`),
  KEY `fk_attachments_vault_item` (`vault_item_id`),
  CONSTRAINT `fk_attachments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attachments_vault_item` FOREIGN KEY (`vault_item_id`) REFERENCES `vault_items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

