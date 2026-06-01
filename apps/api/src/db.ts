import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vivago_pass'
};

let pool: mysql.Pool | null = null;
let useFallback = false;

// Helper to convert DB buffer/binary fields to base64 strings
function toBase64(val: any): string | null {
  if (val === null || val === undefined) return null;
  if (Buffer.isBuffer(val)) {
    return val.toString('base64');
  }
  return String(val);
}

// Helper to convert base64 input strings to buffers for DB storage
function toBuffer(val: any): Buffer | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    return Buffer.from(val, 'base64');
  }
  return val;
}

// In-memory fallback database
const mockUsers: Record<string, { 
  id: string; 
  email: string; 
  name: string;
  plan: string;
  auth_key_hash: string; 
  is_verified?: number; 
  otp_code?: string | null; 
  otp_expires_at?: number | null; 
  encrypted_master_key?: string | null;
  master_key_iv?: string | null;
  master_key_auth_tag?: string | null;
  public_key?: string | null;
  encrypted_private_key?: string | null;
  private_key_iv?: string | null;
  private_key_auth_tag?: string | null;
}> = {};
const mockVaults: Record<string, any[]> = {};
const mockBackupCodes: Record<string, Array<{
  id: string;
  user_id: string;
  code_hash: string;
  encrypted_master_key: string;
  iv: string;
  auth_tag: string;
  is_used: number;
}>> = {};
const mockPasskeys: Record<string, Array<{
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  encrypted_master_key: string;
  iv: string;
  auth_tag: string;
}>> = {};
const mockSharedItems: any[] = [];
const mockAttachments: any[] = [];

try {
  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log(`Connecting to localhost MySQL database "${dbConfig.database}" as "${dbConfig.user}"`);

  // Test the connection immediately
  pool.getConnection()
    .then(async (conn) => {
      console.log(`Successfully connected to MySQL database "${dbConfig.database}"`);
      try {
        // Run database migration to add wrapped master key columns if they don't exist
        const [columns] = await conn.query('SHOW COLUMNS FROM `users` LIKE "encrypted_master_key"');
        if ((columns as any[]).length === 0) {
          try {
            await conn.query(`
              ALTER TABLE \`users\`
                ADD COLUMN \`encrypted_master_key\` BLOB DEFAULT NULL,
                ADD COLUMN \`master_key_iv\` BINARY(12) DEFAULT NULL,
                ADD COLUMN \`master_key_auth_tag\` BINARY(16) DEFAULT NULL
            `);
            console.log('Successfully added master key wrapping columns to `users` table.');
          } catch (err) {
            await conn.query('DELETE FROM `users`');
            await conn.query(`
              ALTER TABLE \`users\`
                ADD COLUMN \`encrypted_master_key\` BLOB DEFAULT NULL,
                ADD COLUMN \`master_key_iv\` BINARY(12) DEFAULT NULL,
                ADD COLUMN \`master_key_auth_tag\` BINARY(16) DEFAULT NULL
            `);
          }
        } else {
          // If the columns exist as VARCHAR/TEXT, migrate them to binary types
          const [ivCol] = await conn.query('SHOW COLUMNS FROM `users` LIKE "master_key_iv"');
          if (ivCol && (ivCol as any[])[0] && (ivCol as any[])[0].Type.includes('varchar')) {
            console.log('Migrating users table master_key columns to binary types...');
            try {
              await conn.query(`
                ALTER TABLE \`users\`
                  MODIFY COLUMN \`encrypted_master_key\` BLOB DEFAULT NULL,
                  MODIFY COLUMN \`master_key_iv\` BINARY(12) DEFAULT NULL,
                  MODIFY COLUMN \`master_key_auth_tag\` BINARY(16) DEFAULT NULL
              `);
            } catch (err) {
              console.warn('Migration failed due to truncation, truncating users table and retrying...');
              await conn.query('DELETE FROM `users`');
              await conn.query(`
                ALTER TABLE \`users\`
                  MODIFY COLUMN \`encrypted_master_key\` BLOB DEFAULT NULL,
                  MODIFY COLUMN \`master_key_iv\` BINARY(12) DEFAULT NULL,
                  MODIFY COLUMN \`master_key_auth_tag\` BINARY(16) DEFAULT NULL
              `);
            }
          }
        }

        // Vault items
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`vault_items\` (
            \`id\` VARCHAR(255) NOT NULL,
            \`user_id\` VARCHAR(255) NOT NULL,
            \`type\` VARCHAR(50) NOT NULL,
            \`name\` VARCHAR(255) NOT NULL,
            \`notes\` TEXT,
            \`ciphertext\` BLOB NOT NULL,
            \`iv\` BINARY(12) NOT NULL,
            \`auth_tag\` BINARY(16) NOT NULL,
            \`last_modified\` BIGINT NOT NULL,
            PRIMARY KEY (\`id\`),
            KEY \`fk_vault_items_user\` (\`user_id\`),
            CONSTRAINT \`fk_vault_items_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        const [viIvCol] = await conn.query('SHOW COLUMNS FROM `vault_items` LIKE "iv"');
        if (viIvCol && (viIvCol as any[])[0] && (viIvCol as any[])[0].Type.includes('varchar')) {
          console.log('Migrating vault_items table to binary types...');
          try {
            await conn.query(`
              ALTER TABLE \`vault_items\`
                MODIFY COLUMN \`ciphertext\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          } catch (err) {
            await conn.query('DELETE FROM `vault_items`');
            await conn.query(`
              ALTER TABLE \`vault_items\`
                MODIFY COLUMN \`ciphertext\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          }
        }

        // Backup codes
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`user_backup_codes\` (
            \`id\` VARCHAR(255) NOT NULL,
            \`user_id\` VARCHAR(255) NOT NULL,
            \`code_hash\` VARCHAR(255) NOT NULL,
            \`encrypted_master_key\` BLOB NOT NULL,
            \`iv\` BINARY(12) NOT NULL,
            \`auth_tag\` BINARY(16) NOT NULL,
            \`is_used\` TINYINT(1) DEFAULT 0,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            KEY \`fk_backup_codes_user\` (\`user_id\`),
            CONSTRAINT \`fk_backup_codes_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        const [bcIvCol] = await conn.query('SHOW COLUMNS FROM `user_backup_codes` LIKE "iv"');
        if (bcIvCol && (bcIvCol as any[])[0] && (bcIvCol as any[])[0].Type.includes('varchar')) {
          console.log('Migrating user_backup_codes table to binary types...');
          try {
            await conn.query(`
              ALTER TABLE \`user_backup_codes\`
                MODIFY COLUMN \`encrypted_master_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          } catch (err) {
            await conn.query('DELETE FROM `user_backup_codes`');
            await conn.query(`
              ALTER TABLE \`user_backup_codes\`
                MODIFY COLUMN \`encrypted_master_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          }
        }
        
        // Passkeys
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`user_passkeys\` (
            \`id\` VARCHAR(255) NOT NULL,
            \`user_id\` VARCHAR(255) NOT NULL,
            \`public_key\` TEXT NOT NULL,
            \`counter\` INT DEFAULT 0,
            \`encrypted_master_key\` BLOB NOT NULL,
            \`iv\` BINARY(12) NOT NULL,
            \`auth_tag\` BINARY(16) NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            KEY \`fk_passkeys_user\` (\`user_id\`),
            CONSTRAINT \`fk_passkeys_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        const [pkIvCol] = await conn.query('SHOW COLUMNS FROM `user_passkeys` LIKE "iv"');
        if (pkIvCol && (pkIvCol as any[])[0] && (pkIvCol as any[])[0].Type.includes('varchar')) {
          console.log('Migrating user_passkeys table to binary types...');
          try {
            await conn.query(`
              ALTER TABLE \`user_passkeys\`
                MODIFY COLUMN \`encrypted_master_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          } catch (err) {
            await conn.query('DELETE FROM `user_passkeys`');
            await conn.query(`
              ALTER TABLE \`user_passkeys\`
                MODIFY COLUMN \`encrypted_master_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          }
        }

        // Check for sharing columns
        const [sharingColumns] = await conn.query('SHOW COLUMNS FROM `users` LIKE "public_key"');
        if ((sharingColumns as any[]).length === 0) {
          try {
            await conn.query(`
              ALTER TABLE \`users\`
                ADD COLUMN \`public_key\` TEXT DEFAULT NULL,
                ADD COLUMN \`encrypted_private_key\` BLOB DEFAULT NULL,
                ADD COLUMN \`private_key_iv\` BINARY(12) DEFAULT NULL,
                ADD COLUMN \`private_key_auth_tag\` BINARY(16) DEFAULT NULL
            `);
            console.log('Successfully added sharing columns to `users` table.');
          } catch (err) {
            await conn.query('DELETE FROM `users`');
            await conn.query(`
              ALTER TABLE \`users\`
                ADD COLUMN \`public_key\` TEXT DEFAULT NULL,
                ADD COLUMN \`encrypted_private_key\` BLOB DEFAULT NULL,
                ADD COLUMN \`private_key_iv\` BINARY(12) DEFAULT NULL,
                ADD COLUMN \`private_key_auth_tag\` BINARY(16) DEFAULT NULL
            `);
          }
        } else {
          const [privKeyCol] = await conn.query('SHOW COLUMNS FROM `users` LIKE "private_key_iv"');
          if (privKeyCol && (privKeyCol as any[])[0] && (privKeyCol as any[])[0].Type.includes('varchar')) {
            console.log('Migrating users table private key columns to binary types...');
            try {
              await conn.query(`
                ALTER TABLE \`users\`
                  MODIFY COLUMN \`encrypted_private_key\` BLOB DEFAULT NULL,
                  MODIFY COLUMN \`private_key_iv\` BINARY(12) DEFAULT NULL,
                  MODIFY COLUMN \`private_key_auth_tag\` BINARY(16) DEFAULT NULL
              `);
            } catch (err) {
              await conn.query('DELETE FROM `users`');
              await conn.query(`
                ALTER TABLE \`users\`
                  MODIFY COLUMN \`encrypted_private_key\` BLOB DEFAULT NULL,
                  MODIFY COLUMN \`private_key_iv\` BINARY(12) DEFAULT NULL,
                  MODIFY COLUMN \`private_key_auth_tag\` BINARY(16) DEFAULT NULL
              `);
            }
          }
        }

        // Check for shared_items table
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`shared_items\` (
            \`id\` VARCHAR(255) NOT NULL,
            \`sender_id\` VARCHAR(255) NOT NULL,
            \`receiver_id\` VARCHAR(255) NOT NULL,
            \`type\` VARCHAR(50) NOT NULL,
            \`name\` VARCHAR(255) NOT NULL,
            \`ciphertext\` BLOB NOT NULL,
            \`encrypted_key\` BLOB NOT NULL,
            \`iv\` BINARY(12) NOT NULL,
            \`auth_tag\` BINARY(16) NOT NULL,
            \`shared_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            KEY \`fk_shared_items_sender\` (\`sender_id\`),
            KEY \`fk_shared_items_receiver\` (\`receiver_id\`),
            CONSTRAINT \`fk_shared_items_sender\` FOREIGN KEY (\`sender_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`fk_shared_items_receiver\` FOREIGN KEY (\`receiver_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        const [shIvCol] = await conn.query('SHOW COLUMNS FROM `shared_items` LIKE "iv"');
        if (shIvCol && (shIvCol as any[])[0] && (shIvCol as any[])[0].Type.includes('varchar')) {
          console.log('Migrating shared_items table to binary types...');
          try {
            await conn.query(`
              ALTER TABLE \`shared_items\`
                MODIFY COLUMN \`ciphertext\` BLOB NOT NULL,
                MODIFY COLUMN \`encrypted_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          } catch (err) {
            await conn.query('DELETE FROM `shared_items`');
            await conn.query(`
              ALTER TABLE \`shared_items\`
                MODIFY COLUMN \`ciphertext\` BLOB NOT NULL,
                MODIFY COLUMN \`encrypted_key\` BLOB NOT NULL,
                MODIFY COLUMN \`iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`auth_tag\` BINARY(16) NOT NULL
            `);
          }
        }

        // Attachments
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`attachments\` (
            \`id\` VARCHAR(255) NOT NULL,
            \`user_id\` VARCHAR(255) NOT NULL,
            \`vault_item_id\` VARCHAR(255) DEFAULT NULL,
            \`encrypted_metadata\` BLOB NOT NULL,
            \`metadata_iv\` BINARY(12) NOT NULL,
            \`metadata_auth_tag\` BINARY(16) NOT NULL,
            \`file_path\` VARCHAR(512) NOT NULL,
            \`file_size\` INT NOT NULL,
            \`uploaded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            KEY \`fk_attachments_user\` (\`user_id\`),
            KEY \`fk_attachments_vault_item\` (\`vault_item_id\`),
            CONSTRAINT \`fk_attachments_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
            CONSTRAINT \`fk_attachments_vault_item\` FOREIGN KEY (\`vault_item_id\`) REFERENCES \`vault_items\` (\`id\`) ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        const [attIvCol] = await conn.query('SHOW COLUMNS FROM `attachments` LIKE "metadata_iv"');
        if (attIvCol && (attIvCol as any[])[0] && (attIvCol as any[])[0].Type.includes('varchar')) {
          console.log('Migrating attachments table to binary types...');
          try {
            await conn.query(`
              ALTER TABLE \`attachments\`
                MODIFY COLUMN \`encrypted_metadata\` BLOB NOT NULL,
                MODIFY COLUMN \`metadata_iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`metadata_auth_tag\` BINARY(16) NOT NULL
            `);
          } catch (err) {
            await conn.query('DELETE FROM `attachments`');
            await conn.query(`
              ALTER TABLE \`attachments\`
                MODIFY COLUMN \`encrypted_metadata\` BLOB NOT NULL,
                MODIFY COLUMN \`metadata_iv\` BINARY(12) NOT NULL,
                MODIFY COLUMN \`metadata_auth_tag\` BINARY(16) NOT NULL
            `);
          }
        }
      } catch (err: any) {
        console.error('Failed to auto-create or migrate database tables:', err.message);
      }
      conn.release();
    })
    .catch((err) => {
      console.warn(`Could not connect to MySQL database "${dbConfig.database}". Falling back to in-memory store. Error:`, err.message);
      useFallback = true;
    });
} catch (err) {
  console.warn('MySQL pool initialization failed. Falling back to in-memory store:', err);
  useFallback = true;
}

export async function getUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (useFallback || !pool) {
    const mockUser = Object.values(mockUsers).find(u => u.email === normalizedEmail);
    if (!mockUser) return null;
    return {
      ...mockUser,
      encrypted_master_key: mockUser.encrypted_master_key || null,
      master_key_iv: mockUser.master_key_iv || null,
      master_key_auth_tag: mockUser.master_key_auth_tag || null,
      public_key: mockUser.public_key || null,
      encrypted_private_key: mockUser.encrypted_private_key || null,
      private_key_iv: mockUser.private_key_iv || null,
      private_key_auth_tag: mockUser.private_key_auth_tag || null
    };
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const userRows = rows as any[];
    if (userRows.length === 0) return null;
    const row = userRows[0];
    return {
      ...row,
      encrypted_master_key: toBase64(row.encrypted_master_key),
      master_key_iv: toBase64(row.master_key_iv),
      master_key_auth_tag: toBase64(row.master_key_auth_tag),
      encrypted_private_key: toBase64(row.encrypted_private_key),
      private_key_iv: toBase64(row.private_key_iv),
      private_key_auth_tag: toBase64(row.private_key_auth_tag)
    };
  } catch (err) {
    console.error('Database query getUserByEmail failed:', err);
    throw err;
  }
}

export async function createUser(
  id: string,
  email: string,
  authKeyHash: string,
  encryptedMasterKey?: string,
  masterKeyIv?: string,
  masterKeyAuthTag?: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  const defaultName = normalizedEmail.split('@')[0];
  const name = defaultName.charAt(0).toUpperCase() + defaultName.slice(1);
  const plan = 'starter';

  if (useFallback || !pool) {
    mockUsers[id] = {
      id,
      email: normalizedEmail,
      name,
      plan,
      auth_key_hash: authKeyHash,
      is_verified: 0,
      otp_code: null,
      otp_expires_at: null,
      encrypted_master_key: encryptedMasterKey || null,
      master_key_iv: masterKeyIv || null,
      master_key_auth_tag: masterKeyAuthTag || null
    };
    return mockUsers[id];
  }
  try {
    await pool.query(
      'INSERT INTO users (id, email, name, plan, auth_key_hash, is_verified, encrypted_master_key, master_key_iv, master_key_auth_tag) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [
        id, 
        normalizedEmail, 
        name, 
        plan, 
        authKeyHash, 
        toBuffer(encryptedMasterKey), 
        toBuffer(masterKeyIv), 
        toBuffer(masterKeyAuthTag)
      ]
    );
    return { id, email: normalizedEmail, name, plan };
  } catch (err) {
    console.error('Database insert createUser failed:', err);
    throw err;
  }
}

export async function updateUserOtp(id: string, otpCode: string, expiresAt: number) {
  if (useFallback || !pool) {
    if (mockUsers[id]) {
      mockUsers[id].otp_code = otpCode;
      mockUsers[id].otp_expires_at = expiresAt;
    }
    return;
  }
  try {
    await pool.query('UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?', [
      otpCode, expiresAt, id
    ]);
  } catch (err) {
    console.error('Database update OTP failed:', err);
    throw err;
  }
}

export async function verifyUserOtp(email: string, otpCode: string): Promise<{ success: boolean; userId?: string; error?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  
  if (useFallback || !pool) {
    const user = Object.values(mockUsers).find(u => u.email === normalizedEmail);
    if (!user) return { success: false, error: 'User not found' };
    
    if (user.otp_code === otpCode && user.otp_expires_at && user.otp_expires_at > Date.now()) {
      user.is_verified = 1;
      user.otp_code = null;
      user.otp_expires_at = null;
      return { success: true, userId: user.id };
    }
    return { success: false, error: 'Invalid or expired OTP code' };
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const userRows = rows as any[];
    if (userRows.length === 0) return { success: false, error: 'User not found' };
    
    const user = userRows[0];
    if (user.otp_code === otpCode && Number(user.otp_expires_at) > Date.now()) {
      await pool.query('UPDATE users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [user.id]);
      return { success: true, userId: user.id };
    }
    return { success: false, error: 'Invalid or expired OTP code' };
  } catch (err) {
    console.error('Database verify OTP failed:', err);
    throw err;
  }
}

export async function getVaultItems(userId: string) {
  if (useFallback || !pool) {
    return mockVaults[userId] || [];
  }
  try {
    const [rows] = await pool.query('SELECT * FROM vault_items WHERE user_id = ?', [userId]);
    return (rows as any[]).map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      notes: row.notes,
      ciphertext: toBase64(row.ciphertext),
      iv: toBase64(row.iv),
      authTag: toBase64(row.auth_tag),
      lastModified: Number(row.last_modified)
    }));
  } catch (err) {
    console.error('Database query getVaultItems failed:', err);
    throw err;
  }
}

export async function saveVaultItem(userId: string, item: any) {
  if (useFallback || !pool) {
    if (!mockVaults[userId]) {
      mockVaults[userId] = [];
    }
    const idx = mockVaults[userId].findIndex(i => i.id === item.id);
    if (idx >= 0) {
      mockVaults[userId][idx] = item;
    } else {
      mockVaults[userId].push(item);
    }
    return item;
  }
  
  try {
    await pool.query(
      `INSERT INTO vault_items (id, user_id, type, name, notes, ciphertext, iv, auth_tag, last_modified) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
         type = VALUES(type), 
         name = VALUES(name), 
         notes = VALUES(notes), 
         ciphertext = VALUES(ciphertext), 
         iv = VALUES(iv), 
         auth_tag = VALUES(auth_tag), 
         last_modified = VALUES(last_modified)`,
      [
        item.id,
        userId,
        item.type,
        item.name,
        item.notes || null,
        toBuffer(item.ciphertext),
        toBuffer(item.iv),
        toBuffer(item.authTag),
        item.lastModified || Date.now()
      ]
    );
    return item;
  } catch (err) {
    console.error('Database save vault item failed:', err);
    throw err;
  }
}

export async function getUserById(id: string) {
  if (useFallback || !pool) {
    const mockUser = mockUsers[id];
    if (!mockUser) return null;
    return {
      ...mockUser,
      encrypted_master_key: mockUser.encrypted_master_key || null,
      master_key_iv: mockUser.master_key_iv || null,
      master_key_auth_tag: mockUser.master_key_auth_tag || null,
      public_key: mockUser.public_key || null,
      encrypted_private_key: mockUser.encrypted_private_key || null,
      private_key_iv: mockUser.private_key_iv || null,
      private_key_auth_tag: mockUser.private_key_auth_tag || null
    };
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    const userRows = rows as any[];
    if (userRows.length === 0) return null;
    const row = userRows[0];
    return {
      ...row,
      encrypted_master_key: toBase64(row.encrypted_master_key),
      master_key_iv: toBase64(row.master_key_iv),
      master_key_auth_tag: toBase64(row.master_key_auth_tag),
      encrypted_private_key: toBase64(row.encrypted_private_key),
      private_key_iv: toBase64(row.private_key_iv),
      private_key_auth_tag: toBase64(row.private_key_auth_tag)
    };
  } catch (err) {
    console.error('Database query getUserById failed:', err);
    throw err;
  }
}

export async function updateUserProfileName(id: string, name: string) {
  if (useFallback || !pool) {
    if (mockUsers[id]) {
      mockUsers[id].name = name;
    }
    return;
  }
  try {
    await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, id]);
  } catch (err) {
    console.error('Database update profile name failed:', err);
    throw err;
  }
}

export async function deleteVaultItem(userId: string, itemId: string) {
  if (useFallback || !pool) {
    if (mockVaults[userId]) {
      mockVaults[userId] = mockVaults[userId].filter(item => item.id !== itemId);
    }
    return;
  }
  try {
    await pool.query('DELETE FROM vault_items WHERE id = ? AND user_id = ?', [itemId, userId]);
  } catch (err) {
    console.error('Database delete vault item failed:', err);
    throw err;
  }
}

export async function resetPassword(
  email: string,
  otpCode: string,
  newAuthKeyHash: string,
  encryptedMasterKey?: string | null,
  masterKeyIv?: string | null,
  masterKeyAuthTag?: string | null
) {
  const normalizedEmail = email.trim().toLowerCase();
  
  if (useFallback || !pool) {
    const user = Object.values(mockUsers).find(u => u.email === normalizedEmail);
    if (!user) return { success: false, error: 'User not found' };
    
    if (user.otp_code === otpCode && user.otp_expires_at && user.otp_expires_at > Date.now()) {
      user.auth_key_hash = newAuthKeyHash;
      user.otp_code = null;
      user.otp_expires_at = null;
      user.encrypted_master_key = encryptedMasterKey || null;
      user.master_key_iv = masterKeyIv || null;
      user.master_key_auth_tag = masterKeyAuthTag || null;
      delete mockVaults[user.id];
      return { success: true };
    }
    return { success: false, error: 'Invalid or expired OTP code' };
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const userRows = rows as any[];
    if (userRows.length === 0) return { success: false, error: 'User not found' };
    
    const user = userRows[0];
    if (user.otp_code === otpCode && Number(user.otp_expires_at) > Date.now()) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query('DELETE FROM vault_items WHERE user_id = ?', [user.id]);
        await connection.query(
          'UPDATE users SET auth_key_hash = ?, otp_code = NULL, otp_expires_at = NULL, encrypted_master_key = ?, master_key_iv = ?, master_key_auth_tag = ? WHERE id = ?',
          [
            newAuthKeyHash, 
            toBuffer(encryptedMasterKey), 
            toBuffer(masterKeyIv), 
            toBuffer(masterKeyAuthTag), 
            user.id
          ]
        );
        await connection.commit();
        return { success: true };
      } catch (transactionErr) {
        await connection.rollback();
        throw transactionErr;
      } finally {
        connection.release();
      }
    }
    return { success: false, error: 'Invalid or expired OTP code' };
  } catch (err) {
    console.error('Database reset password failed:', err);
    throw err;
  }
}

export async function saveBackupCodes(
  userId: string,
  codes: Array<{ hash: string; encryptedMasterKey: string; iv: string; authTag: string }>
) {
  if (useFallback || !pool) {
    mockBackupCodes[userId] = codes.map((c, i) => ({
      id: `bc_${userId}_${i}_${Math.random().toString(36).substr(2, 5)}`,
      user_id: userId,
      code_hash: c.hash,
      encrypted_master_key: c.encryptedMasterKey,
      iv: c.iv,
      auth_tag: c.authTag,
      is_used: 0
    }));
    return;
  }

  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM user_backup_codes WHERE user_id = ?', [userId]);

      for (const c of codes) {
        const id = `bc_${userId}_` + Math.random().toString(36).substr(2, 9);
        await connection.query(
          `INSERT INTO user_backup_codes (id, user_id, code_hash, encrypted_master_key, iv, auth_tag, is_used)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [
            id, 
            userId, 
            c.hash, 
            toBuffer(c.encryptedMasterKey), 
            toBuffer(c.iv), 
            toBuffer(c.authTag)
          ]
        );
      }
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Database saveBackupCodes failed:', err);
    throw err;
  }
}

export async function verifyAndUseBackupCode(
  email: string,
  backupCode: string,
  markAsUsed = true
): Promise<{ success: boolean; error?: string; encryptedMasterKey?: string; iv?: string; authTag?: string; userId?: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  if (useFallback || !pool) {
    const user = Object.values(mockUsers).find(u => u.email === normalizedEmail);
    if (!user) return { success: false, error: 'User not found' };

    const codes = mockBackupCodes[user.id] || [];
    for (const c of codes) {
      if (c.is_used === 0) {
        const matches = await bcrypt.compare(backupCode.trim(), c.code_hash);
        if (matches) {
          if (markAsUsed) {
            c.is_used = 1;
          }
          return {
            success: true,
            userId: user.id,
            encryptedMasterKey: c.encrypted_master_key,
            iv: c.iv,
            authTag: c.auth_tag
          };
        }
      }
    }
    return { success: false, error: 'Invalid or already used backup code' };
  }

  try {
    const [userRows] = await pool.query('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const users = userRows as any[];
    if (users.length === 0) return { success: false, error: 'User not found' };

    const user = users[0];
    const [codeRows] = await pool.query('SELECT * FROM user_backup_codes WHERE user_id = ? AND is_used = 0', [user.id]);
    const codes = codeRows as any[];

    for (const c of codes) {
      const matches = await bcrypt.compare(backupCode.trim(), c.code_hash);
      if (matches) {
        if (markAsUsed) {
          await pool.query('UPDATE user_backup_codes SET is_used = 1 WHERE id = ?', [c.id]);
        }
        return {
          success: true,
          userId: user.id,
          encryptedMasterKey: toBase64(c.encrypted_master_key) || undefined,
          iv: toBase64(c.iv) || undefined,
          authTag: toBase64(c.auth_tag) || undefined
        };
      }
    }

    return { success: false, error: 'Invalid or already used backup code' };
  } catch (err) {
    console.error('Database verifyAndUseBackupCode failed:', err);
    throw err;
  }
}

export async function getBackupCodesStatus(userId: string): Promise<Array<{ codeHash: string; isUsed: number }>> {
  if (useFallback || !pool) {
    const codes = mockBackupCodes[userId] || [];
    return codes.map(c => ({ codeHash: c.code_hash, isUsed: c.is_used }));
  }

  try {
    const [rows] = await pool.query('SELECT code_hash, is_used FROM user_backup_codes WHERE user_id = ?', [userId]);
    return (rows as any[]).map(row => ({
      codeHash: row.code_hash,
      isUsed: row.is_used
    }));
  } catch (err) {
    console.error('Database getBackupCodesStatus failed:', err);
    throw err;
  }
}

export async function updateUserPassword(
  userId: string,
  authKeyHash: string,
  encryptedMasterKey?: string | null,
  masterKeyIv?: string | null,
  masterKeyAuthTag?: string | null
) {
  if (useFallback || !pool) {
    const user = mockUsers[userId];
    if (user) {
      user.auth_key_hash = authKeyHash;
      user.encrypted_master_key = encryptedMasterKey || null;
      user.master_key_iv = masterKeyIv || null;
      user.master_key_auth_tag = masterKeyAuthTag || null;
    }
    return;
  }
  try {
    await pool.query(
      'UPDATE users SET auth_key_hash = ?, encrypted_master_key = ?, master_key_iv = ?, master_key_auth_tag = ? WHERE id = ?',
      [
        authKeyHash, 
        toBuffer(encryptedMasterKey), 
        toBuffer(masterKeyIv), 
        toBuffer(masterKeyAuthTag), 
        userId
      ]
    );
  } catch (err) {
    console.error('Database updateUserPassword failed:', err);
    throw err;
  }
}

export async function getUserPasskeys(userId: string): Promise<Array<{
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  encrypted_master_key: string;
  iv: string;
  auth_tag: string;
}>> {
  if (useFallback || !pool) {
    return mockPasskeys[userId] || [];
  }
  try {
    const [rows] = await pool.query('SELECT * FROM user_passkeys WHERE user_id = ?', [userId]);
    return (rows as any[]).map(row => ({
      id: row.id,
      user_id: row.user_id,
      public_key: row.public_key,
      counter: Number(row.counter),
      encrypted_master_key: toBase64(row.encrypted_master_key) || '',
      iv: toBase64(row.iv) || '',
      auth_tag: toBase64(row.auth_tag) || ''
    }));
  } catch (err) {
    console.error('Database getUserPasskeys failed:', err);
    throw err;
  }
}

export async function getPasskeyById(id: string): Promise<{
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  encrypted_master_key: string;
  iv: string;
  auth_tag: string;
} | null> {
  if (useFallback || !pool) {
    for (const userPasskeys of Object.values(mockPasskeys)) {
      const match = userPasskeys.find(p => p.id === id);
      if (match) return match;
    }
    return null;
  }
  try {
    const [rows] = await pool.query('SELECT * FROM user_passkeys WHERE id = ?', [id]);
    const passkeyRows = rows as any[];
    if (passkeyRows.length === 0) return null;
    const row = passkeyRows[0];
    return {
      id: row.id,
      user_id: row.user_id,
      public_key: row.public_key,
      counter: Number(row.counter),
      encrypted_master_key: toBase64(row.encrypted_master_key) || '',
      iv: toBase64(row.iv) || '',
      auth_tag: toBase64(row.auth_tag) || ''
    };
  } catch (err) {
    console.error('Database getPasskeyById failed:', err);
    throw err;
  }
}

export async function savePasskey(passkey: {
  id: string;
  userId: string;
  publicKey: string;
  counter: number;
  encryptedMasterKey: string;
  iv: string;
  authTag: string;
}) {
  if (useFallback || !pool) {
    if (!mockPasskeys[passkey.userId]) {
      mockPasskeys[passkey.userId] = [];
    }
    mockPasskeys[passkey.userId].push({
      id: passkey.id,
      user_id: passkey.userId,
      public_key: passkey.publicKey,
      counter: passkey.counter,
      encrypted_master_key: passkey.encryptedMasterKey,
      iv: passkey.iv,
      auth_tag: passkey.authTag
    });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO user_passkeys (id, user_id, public_key, counter, encrypted_master_key, iv, auth_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        passkey.id, 
        passkey.userId, 
        passkey.publicKey, 
        passkey.counter, 
        toBuffer(passkey.encryptedMasterKey), 
        toBuffer(passkey.iv), 
        toBuffer(passkey.authTag)
      ]
    );
  } catch (err) {
    console.error('Database savePasskey failed:', err);
    throw err;
  }
}

export async function updatePasskeyCounter(id: string, counter: number) {
  if (useFallback || !pool) {
    for (const userPasskeys of Object.values(mockPasskeys)) {
      const match = userPasskeys.find(p => p.id === id);
      if (match) {
        match.counter = counter;
        break;
      }
    }
    return;
  }
  try {
    await pool.query('UPDATE user_passkeys SET counter = ? WHERE id = ?', [counter, id]);
  } catch (err) {
    console.error('Database updatePasskeyCounter failed:', err);
    throw err;
  }
}

export async function getUserKeys(userId: string) {
  if (useFallback || !pool) {
    const user = mockUsers[userId];
    if (!user) return null;
    return {
      publicKey: user.public_key || null,
      encryptedPrivateKey: user.encrypted_private_key || null,
      privateKeyIv: user.private_key_iv || null,
      privateKeyAuthTag: user.private_key_auth_tag || null
    };
  }
  try {
    const [rows] = await pool.query(
      'SELECT public_key, encrypted_private_key, private_key_iv, private_key_auth_tag FROM users WHERE id = ?',
      [userId]
    );
    const userRows = rows as any[];
    if (userRows.length === 0) return null;
    const row = userRows[0];
    return {
      publicKey: row.public_key,
      encryptedPrivateKey: toBase64(row.encrypted_private_key),
      privateKeyIv: toBase64(row.private_key_iv),
      privateKeyAuthTag: toBase64(row.private_key_auth_tag)
    };
  } catch (err) {
    console.error('Database getUserKeys failed:', err);
    throw err;
  }
}

export async function saveUserKeys(
  userId: string,
  publicKey: string,
  encryptedPrivateKey: string,
  privateKeyIv: string,
  privateKeyAuthTag: string
) {
  if (useFallback || !pool) {
    const user = mockUsers[userId];
    if (user) {
      user.public_key = publicKey;
      user.encrypted_private_key = encryptedPrivateKey;
      user.private_key_iv = privateKeyIv;
      user.private_key_auth_tag = privateKeyAuthTag;
    }
    return;
  }
  try {
    await pool.query(
      'UPDATE users SET public_key = ?, encrypted_private_key = ?, private_key_iv = ?, private_key_auth_tag = ? WHERE id = ?',
      [
        publicKey, 
        toBuffer(encryptedPrivateKey), 
        toBuffer(privateKeyIv), 
        toBuffer(privateKeyAuthTag), 
        userId
      ]
    );
  } catch (err) {
    console.error('Database saveUserKeys failed:', err);
    throw err;
  }
}

export async function getUserPublicKey(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (useFallback || !pool) {
    const user = Object.values(mockUsers).find(u => u.email === normalizedEmail);
    if (!user) return null;
    return {
      userId: user.id,
      publicKey: user.public_key || null
    };
  }
  try {
    const [rows] = await pool.query('SELECT id, public_key FROM users WHERE email = ?', [normalizedEmail]);
    const userRows = rows as any[];
    if (userRows.length === 0) return null;
    return {
      userId: userRows[0].id,
      publicKey: userRows[0].public_key
    };
  } catch (err) {
    console.error('Database getUserPublicKey failed:', err);
    throw err;
  }
}

export async function saveSharedItem(item: any) {
  if (useFallback || !pool) {
    mockSharedItems.push(item);
    return item;
  }
  try {
    await pool.query(
      `INSERT INTO shared_items (id, sender_id, receiver_id, type, name, ciphertext, encrypted_key, iv, auth_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.senderId,
        item.receiverId,
        item.type,
        item.name,
        toBuffer(item.ciphertext),
        toBuffer(item.encryptedKey),
        toBuffer(item.iv),
        toBuffer(item.authTag)
      ]
    );
    return item;
  } catch (err) {
    console.error('Database saveSharedItem failed:', err);
    throw err;
  }
}

export async function getSentSharedItems(userId: string) {
  if (useFallback || !pool) {
    return mockSharedItems
      .filter(item => item.senderId === userId)
      .map(item => ({
        ...item,
        receiverEmail: Object.values(mockUsers).find(u => u.id === item.receiverId)?.email || 'Unknown'
      }));
  }
  try {
    const [rows] = await pool.query(
      `SELECT si.*, u.email as receiver_email 
       FROM shared_items si
       JOIN users u ON si.receiver_id = u.id
       WHERE si.sender_id = ?`,
      [userId]
    );
    return (rows as any[]).map(row => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      receiverEmail: row.receiver_email,
      type: row.type,
      name: row.name,
      ciphertext: toBase64(row.ciphertext),
      encryptedKey: toBase64(row.encrypted_key),
      iv: toBase64(row.iv),
      authTag: toBase64(row.auth_tag),
      sharedAt: row.shared_at
    }));
  } catch (err) {
    console.error('Database getSentSharedItems failed:', err);
    throw err;
  }
}

export async function getReceivedSharedItems(userId: string) {
  if (useFallback || !pool) {
    return mockSharedItems
      .filter(item => item.receiverId === userId)
      .map(item => ({
        ...item,
        senderEmail: Object.values(mockUsers).find(u => u.id === item.senderId)?.email || 'Unknown'
      }));
  }
  try {
    const [rows] = await pool.query(
      `SELECT si.*, u.email as sender_email 
       FROM shared_items si
       JOIN users u ON si.sender_id = u.id
       WHERE si.receiver_id = ?`,
      [userId]
    );
    return (rows as any[]).map(row => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      senderEmail: row.sender_email,
      type: row.type,
      name: row.name,
      ciphertext: toBase64(row.ciphertext),
      encryptedKey: toBase64(row.encrypted_key),
      iv: toBase64(row.iv),
      authTag: toBase64(row.auth_tag),
      sharedAt: row.shared_at
    }));
  } catch (err) {
    console.error('Database getReceivedSharedItems failed:', err);
    throw err;
  }
}

export async function saveAttachment(attachment: {
  id: string;
  userId: string;
  vaultItemId: string | null;
  encryptedMetadata: string;
  metadataIv: string;
  metadataAuthTag: string;
  filePath: string;
  fileSize: number;
}) {
  if (useFallback || !pool) {
    mockAttachments.push(attachment);
    return attachment;
  }
  try {
    await pool.query(
      `INSERT INTO attachments (id, user_id, vault_item_id, encrypted_metadata, metadata_iv, metadata_auth_tag, file_path, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachment.id,
        attachment.userId,
        attachment.vaultItemId,
        toBuffer(attachment.encryptedMetadata),
        toBuffer(attachment.metadataIv),
        toBuffer(attachment.metadataAuthTag),
        attachment.filePath,
        attachment.fileSize
      ]
    );
    return attachment;
  } catch (err) {
    console.error('Database saveAttachment failed:', err);
    throw err;
  }
}

export async function getAttachmentById(id: string) {
  if (useFallback || !pool) {
    return mockAttachments.find(a => a.id === id) || null;
  }
  try {
    const [rows] = await pool.query('SELECT * FROM attachments WHERE id = ?', [id]);
    const attRows = rows as any[];
    if (attRows.length === 0) return null;
    const row = attRows[0];
    return {
      id: row.id,
      userId: row.user_id,
      vaultItemId: row.vault_item_id,
      encryptedMetadata: toBase64(row.encrypted_metadata)!,
      metadataIv: toBase64(row.metadata_iv)!,
      metadataAuthTag: toBase64(row.metadata_auth_tag)!,
      filePath: row.file_path,
      fileSize: row.file_size,
      uploadedAt: row.uploaded_at
    };
  } catch (err) {
    console.error('Database getAttachmentById failed:', err);
    throw err;
  }
}

export async function getUserAttachments(userId: string) {
  if (useFallback || !pool) {
    return mockAttachments.filter(a => a.userId === userId);
  }
  try {
    const [rows] = await pool.query('SELECT * FROM attachments WHERE user_id = ?', [userId]);
    return (rows as any[]).map(row => ({
      id: row.id,
      userId: row.user_id,
      vaultItemId: row.vault_item_id,
      encryptedMetadata: toBase64(row.encrypted_metadata)!,
      metadataIv: toBase64(row.metadata_iv)!,
      metadataAuthTag: toBase64(row.metadata_auth_tag)!,
      filePath: row.file_path,
      fileSize: row.file_size,
      uploadedAt: row.uploaded_at
    }));
  } catch (err) {
    console.error('Database getUserAttachments failed:', err);
    throw err;
  }
}

export async function deleteAttachment(userId: string, id: string) {
  if (useFallback || !pool) {
    const index = mockAttachments.findIndex(a => a.id === id && a.userId === userId);
    if (index >= 0) {
      mockAttachments.splice(index, 1);
    }
    return;
  }
  try {
    await pool.query('DELETE FROM attachments WHERE id = ? AND user_id = ?', [id, userId]);
  } catch (err) {
    console.error('Database deleteAttachment failed:', err);
    throw err;
  }
}

