"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const db_1 = require("./db");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const express_rate_limit_1 = require("express-rate-limit");
const server_1 = require("@simplewebauthn/server");
const challenges = new Map();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
const uploadsDir = path_1.default.join(__dirname, '..', 'uploads');
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
}
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
            const fileId = 'att_' + Math.random().toString(36).substr(2, 9);
            cb(null, `${fileId}.enc`);
        }
    }),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});
// Trust proxy if running behind reverse proxy (e.g. Nginx, Cloudflare)
app.set('trust proxy', 1);
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Strict input validation helpers to prevent injection and format errors
function validateEmail(email) {
    if (typeof email !== 'string')
        return false;
    if (email.length > 255)
        return false;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}
function validateAuthKey(authKey) {
    if (typeof authKey !== 'string')
        return false;
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    return hexRegex.test(authKey);
}
function validateOtpCode(otpCode) {
    if (typeof otpCode !== 'string')
        return false;
    const otpRegex = /^\d{6}$/;
    return otpRegex.test(otpCode);
}
// Rate limiting middleware to prevent brute-force attacks (disabled/increased during development)
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || process.env.NODE_ENV === 'test';
const authLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: isDev ? 1000 : 10,
    message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
const otpLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: isDev ? 500 : 5,
    message: { error: 'Too many verification attempts. Please try again after 10 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// General rate limiter for non-auth endpoints
const generalLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: isDev ? 10000 : 100, // 10000 requests per 15 minutes in dev
    message: { error: 'Too many requests. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(generalLimiter);
// In-memory session tracking (persisted to a local file to survive HMR/dev-server restarts)
const sessionsFile = path_1.default.join(__dirname, '..', 'sessions.json');
class FilePersistedSessions extends Map {
    constructor() {
        super();
        this.load();
    }
    load() {
        try {
            if (fs_1.default.existsSync(sessionsFile)) {
                const data = JSON.parse(fs_1.default.readFileSync(sessionsFile, 'utf8'));
                for (const [k, v] of Object.entries(data)) {
                    super.set(k, v);
                }
            }
        }
        catch (err) {
            console.error('Failed to load sessions:', err);
        }
        // Ensure mock session is always present
        super.set('tok_mock_session', 'usr_mock_alex');
    }
    save() {
        try {
            const obj = Object.fromEntries(this.entries());
            fs_1.default.writeFileSync(sessionsFile, JSON.stringify(obj, null, 2), 'utf8');
        }
        catch (err) {
            console.error('Failed to save sessions:', err);
        }
    }
    set(key, value) {
        super.set(key, value);
        this.save();
        return this;
    }
    delete(key) {
        const res = super.delete(key);
        this.save();
        return res;
    }
    clear() {
        super.clear();
        this.save();
    }
}
const activeSessions = new FilePersistedSessions();
activeSessions.set('tok_mock_session', 'usr_mock_alex'); // Preserve mock login session
// Authentication middleware
const requireAuth = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const token = req.headers['session-token'];
    if (!userId || !token) {
        return res.status(401).json({ error: 'Authentication required. Missing x-user-id or session-token headers.' });
    }
    const sessionUserId = activeSessions.get(token);
    if (!sessionUserId || sessionUserId !== userId) {
        return res.status(401).json({ error: 'Invalid or expired session token.' });
    }
    next();
};
// Setup nodemailer transporter
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
let transporter = null;
if (smtpHost && smtpUser && smtpPass) {
    transporter = nodemailer_1.default.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
    console.log(`SMTP Mail Server initialized: ${smtpHost}`);
}
else {
    console.log('SMTP credentials not provided. OTP emails will be simulated and printed in the backend console.');
}
// Helper to send verification OTP
async function sendOtpEmail(email, otpCode) {
    const mailOptions = {
        from: '"Vivago Pass Security" <no-reply@vivagopass.com>',
        to: email,
        subject: 'Your Vivago Pass Verification Code',
        text: `Your security verification code is: ${otpCode}. It will expire in 10 minutes.`,
        html: `
      <div style="font-family: sans-serif; padding: 24px; color: #334155; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; rounded-2xl;">
        <h2 style="color: #4f46e5; margin-bottom: 16px;">Vivago Pass Security</h2>
        <p>To verify your email address and secure your password vault, please enter the following 6-digit verification code:</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; font-size: 28px; font-weight: bold; text-align: center; padding: 16px; margin: 24px 0; border-radius: 12px; letter-spacing: 4px; color: #1e293b;">
          ${otpCode}
        </div>
        <p style="font-size: 12px; color: #64748b;">This code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.</p>
      </div>
    `
    };
    if (transporter) {
        await transporter.sendMail(mailOptions);
    }
    else {
        console.log('\n=======================================');
        console.log(`[SIMULATED MAIL SEND] to: ${email}`);
        console.log(`Verification OTP Code: ${otpCode}`);
        console.log('=======================================\n');
    }
}
// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', service: 'Vivago Pass API' });
});
// ZKA Registration
app.post('/api/auth/register', authLimiter, async (req, res) => {
    const { email, authKey, backupCodes, encryptedMasterKey, masterKeyIv, masterKeyAuthTag } = req.body;
    if (!email || !authKey) {
        return res.status(400).json({ error: 'Email and authKey are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format or length' });
    }
    if (!validateAuthKey(authKey)) {
        return res.status(400).json({ error: 'Invalid authentication key format' });
    }
    try {
        const existingUser = await (0, db_1.getUserByEmail)(email);
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const userId = 'usr_' + Math.random().toString(36).substr(2, 9);
        const authKeyHash = await bcryptjs_1.default.hash(authKey, 10);
        // Create unverified user
        const user = await (0, db_1.createUser)(userId, email, authKeyHash, encryptedMasterKey, masterKeyIv, masterKeyAuthTag);
        // Save backup codes
        if (backupCodes && Array.isArray(backupCodes)) {
            const hashedBackupCodes = await Promise.all(backupCodes.map(async (c) => {
                const hash = await bcryptjs_1.default.hash(c.hash.trim(), 10);
                return {
                    hash,
                    encryptedMasterKey: c.encryptedMasterKey,
                    iv: c.iv,
                    authTag: c.authTag
                };
            }));
            await (0, db_1.saveBackupCodes)(user.id, hashedBackupCodes);
        }
        // Generate 6-digit numeric OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
        await (0, db_1.updateUserOtp)(user.id, otpCode, otpExpiresAt);
        await sendOtpEmail(user.email, otpCode);
        res.status(201).json({ success: true, email: user.email, userId: user.id });
    }
    catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Verify OTP
app.post('/api/auth/verify-otp', otpLimiter, async (req, res) => {
    const { email, otpCode } = req.body;
    if (!email || !otpCode) {
        return res.status(400).json({ error: 'Email and otpCode are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!validateOtpCode(otpCode)) {
        return res.status(400).json({ error: 'Invalid OTP format. Must be 6 digits.' });
    }
    try {
        const result = await (0, db_1.verifyUserOtp)(email, otpCode);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Verification failed' });
        }
        const sessionToken = 'tok_' + Math.random().toString(36).substr(2, 18);
        activeSessions.set(sessionToken, result.userId);
        res.json({
            success: true,
            userId: result.userId,
            email,
            sessionToken
        });
    }
    catch (err) {
        console.error('OTP Verification error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Request Forgot Password OTP
app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    try {
        const user = await (0, db_1.getUserByEmail)(email);
        // Secure design against user enumeration: if user does not exist, return generic success
        if (!user) {
            return res.json({
                success: true,
                message: 'If the email is registered, a password reset code has been sent.'
            });
        }
        // Generate 6-digit numeric OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
        await (0, db_1.updateUserOtp)(user.id, otpCode, otpExpiresAt);
        // Customize email subject/text for Forgot Password
        const mailOptions = {
            from: '"Vivago Pass Security" <no-reply@vivagopass.com>',
            to: user.email,
            subject: 'Reset Your Vivago Pass Password',
            text: `Your security password reset code is: ${otpCode}. It will expire in 10 minutes. WARNING: Resetting your password will permanently delete your password vault items.`,
            html: `
        <div style="font-family: sans-serif; padding: 24px; color: #334155; max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px;">
          <h2 style="color: #4f46e5; margin-bottom: 16px;">Vivago Pass Password Reset</h2>
          <p>We received a request to reset the password for your Vivago Pass account. Enter the following 6-digit code to complete the verification:</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; font-size: 28px; font-weight: bold; text-align: center; padding: 16px; margin: 24px 0; border-radius: 12px; letter-spacing: 4px; color: #1e293b;">
            ${otpCode}
          </div>
          <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 8px; margin-bottom: 20px;">
            <p style="color: #991b1b; font-size: 13px; font-weight: bold; margin: 0 0 4px 0;">⚠️ Critical Security Warning</p>
            <p style="color: #7f1d1d; font-size: 12px; margin: 0; line-height: 1.5;">
              Resetting your password will permanently delete all your encrypted vault items. Since we do not store your master password or encryption key, we cannot decrypt or recover your data.
            </p>
          </div>
          <p style="font-size: 12px; color: #64748b;">This code is valid for 10 minutes. If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `
        };
        if (transporter) {
            await transporter.sendMail(mailOptions);
        }
        else {
            console.log('\n=======================================');
            console.log(`[SIMULATED MAIL SEND] to: ${user.email}`);
            console.log(`Password Reset OTP Code: ${otpCode}`);
            console.log('=======================================\n');
        }
        res.json({
            success: true,
            message: 'If the email is registered, a password reset code has been sent.'
        });
    }
    catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Reset Password endpoint
app.post('/api/auth/reset-password', otpLimiter, async (req, res) => {
    const { email, otpCode, newAuthKey, encryptedMasterKey, masterKeyIv, masterKeyAuthTag } = req.body;
    if (!email || !otpCode || !newAuthKey) {
        return res.status(400).json({ error: 'Email, otpCode and newAuthKey are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!validateOtpCode(otpCode)) {
        return res.status(400).json({ error: 'Invalid OTP format. Must be 6 digits.' });
    }
    if (!validateAuthKey(newAuthKey)) {
        return res.status(400).json({ error: 'Invalid authentication key format' });
    }
    try {
        const newAuthKeyHash = await bcryptjs_1.default.hash(newAuthKey, 10);
        const result = await (0, db_1.resetPassword)(email, otpCode, newAuthKeyHash, encryptedMasterKey, masterKeyIv, masterKeyAuthTag);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Password reset failed' });
        }
        res.json({ success: true, message: 'Password has been reset successfully.' });
    }
    catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ZKA Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, authKey } = req.body;
    if (!email || !authKey) {
        return res.status(400).json({ error: 'Email and authKey are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!validateAuthKey(authKey)) {
        return res.status(400).json({ error: 'Invalid credentials format' });
    }
    try {
        const user = await (0, db_1.getUserByEmail)(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Check if user is verified
        if (user.is_verified === 0) {
            // Trigger new OTP
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
            const otpExpiresAt = Date.now() + 10 * 60 * 1000;
            await (0, db_1.updateUserOtp)(user.id, otpCode, otpExpiresAt);
            await sendOtpEmail(user.email, otpCode);
            return res.status(403).json({
                error: 'Email not verified. A verification code has been sent to your email.',
                unverified: true
            });
        }
        // Compare Auth Key
        const isValid = await bcryptjs_1.default.compare(authKey, user.auth_key_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const sessionToken = 'tok_' + Math.random().toString(36).substr(2, 18);
        activeSessions.set(sessionToken, user.id);
        res.json({
            userId: user.id,
            email: user.email,
            sessionToken,
            encryptedMasterKey: user.encrypted_master_key,
            masterKeyIv: user.master_key_iv,
            masterKeyAuthTag: user.master_key_auth_tag,
            createdAt: Date.now()
        });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Login using Backup Code
app.post('/api/auth/login-backup', authLimiter, async (req, res) => {
    const { email, backupCode } = req.body;
    if (!email || !backupCode) {
        return res.status(400).json({ error: 'Email and backupCode are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    try {
        const result = await (0, db_1.verifyAndUseBackupCode)(email, backupCode, false);
        if (!result.success) {
            return res.status(401).json({ error: result.error || 'Authentication using backup code failed' });
        }
        const sessionToken = 'tok_bc_' + Math.random().toString(36).substr(2, 18);
        activeSessions.set(sessionToken, result.userId);
        res.json({
            success: true,
            userId: result.userId,
            email,
            sessionToken,
            encryptedMasterKey: result.encryptedMasterKey,
            iv: result.iv,
            authTag: result.authTag
        });
    }
    catch (err) {
        console.error('Backup code login error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Recover using Backup Code & Set New Password
app.post('/api/auth/recover-backup', authLimiter, async (req, res) => {
    const { email, backupCode, newAuthKey, encryptedMasterKey, masterKeyIv, masterKeyAuthTag } = req.body;
    if (!email || !backupCode || !newAuthKey) {
        return res.status(400).json({ error: 'Email, backupCode and newAuthKey are required' });
    }
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!validateAuthKey(newAuthKey)) {
        return res.status(400).json({ error: 'Invalid authentication key format' });
    }
    try {
        const result = await (0, db_1.verifyAndUseBackupCode)(email, backupCode);
        if (!result.success) {
            return res.status(401).json({ error: result.error || 'Invalid or used backup code' });
        }
        const newAuthKeyHash = await bcryptjs_1.default.hash(newAuthKey, 10);
        await (0, db_1.updateUserPassword)(result.userId, newAuthKeyHash, encryptedMasterKey, masterKeyIv, masterKeyAuthTag);
        const sessionToken = 'tok_bc_' + Math.random().toString(36).substr(2, 18);
        activeSessions.set(sessionToken, result.userId);
        res.json({
            success: true,
            userId: result.userId,
            email,
            sessionToken,
            encryptedMasterKey: result.encryptedMasterKey,
            iv: result.iv,
            authTag: result.authTag
        });
    }
    catch (err) {
        console.error('Backup code recovery error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Fetch backup codes status for user
app.get('/api/user/backup-codes', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    try {
        const status = await (0, db_1.getBackupCodesStatus)(userId);
        res.json({ codes: status });
    }
    catch (err) {
        console.error('Fetch backup codes status error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Update/regenerate backup codes for user
app.post('/api/user/backup-codes', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    const { backupCodes } = req.body;
    if (!backupCodes || !Array.isArray(backupCodes)) {
        return res.status(400).json({ error: 'backupCodes array is required' });
    }
    try {
        const hashedBackupCodes = await Promise.all(backupCodes.map(async (c) => {
            const hash = await bcryptjs_1.default.hash(c.hash.trim(), 10);
            return {
                hash,
                encryptedMasterKey: c.encryptedMasterKey,
                iv: c.iv,
                authTag: c.authTag
            };
        }));
        await (0, db_1.saveBackupCodes)(userId, hashedBackupCodes);
        res.json({ success: true, message: 'Backup codes updated successfully' });
    }
    catch (err) {
        console.error('Save backup codes error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Fetch Encrypted Vault
app.get('/api/vault', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    try {
        const items = await (0, db_1.getVaultItems)(userId);
        res.json({ items });
    }
    catch (err) {
        console.error('Fetch vault error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Save Encrypted Vault Item
app.post('/api/vault', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    const item = req.body;
    if (!item.id || !item.ciphertext || !item.iv || !item.authTag) {
        return res.status(400).json({ error: 'Invalid encrypted vault payload' });
    }
    try {
        const saved = await (0, db_1.saveVaultItem)(userId, item);
        res.status(201).json({ success: true, item: saved });
    }
    catch (err) {
        console.error('Save vault item error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Fetch User Profile
app.get('/api/user/profile', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    try {
        const user = await (0, db_1.getUserById)(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            name: user.name || 'User',
            email: user.email,
            plan: user.plan || 'starter',
            createdAt: user.created_at
        });
    }
    catch (err) {
        console.error('Fetch profile error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Update User Profile Name
app.put('/api/user/profile', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid name parameter' });
    }
    try {
        await (0, db_1.updateUserProfileName)(userId, name.trim());
        res.json({ success: true, name: name.trim() });
    }
    catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Delete Encrypted Vault Item
app.delete('/api/vault/:id', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(400).json({ error: 'x-user-id header is required' });
    }
    const itemId = req.params.id;
    try {
        await (0, db_1.deleteVaultItem)(userId, itemId);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Delete vault item error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Helper to resolve dynamic rpID and origin for WebAuthn/Passkeys in VM/Docker environments
function getWebAuthnConfig(req) {
    const host = req.headers.host || 'localhost';
    const rpID = host.split(':')[0]; // strip port
    const origin = req.headers.origin || `http://${host}`;
    return { rpID, origin };
}
// Passkey Registration - Step 1: Options
app.post('/api/auth/passkey/register-options', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    try {
        const user = await (0, db_1.getUserById)(userId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const userPasskeys = await (0, db_1.getUserPasskeys)(userId);
        const { rpID } = getWebAuthnConfig(req);
        const options = await (0, server_1.generateRegistrationOptions)({
            rpName: 'Vivago Pass',
            rpID,
            userID: Buffer.from(userId),
            userName: user.email,
            userDisplayName: user.name || 'User',
            supportedAlgorithmIDs: [-7, -257], // ES256, RS256
            attestationType: 'none',
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                residentKey: 'required',
                userVerification: 'required',
            },
        });
        options.extensions = {
            prf: {
                eval: {
                    first: Buffer.from(new Uint8Array(32)).toString('base64url'),
                }
            }
        };
        challenges.set(`reg_${userId}`, options.challenge);
        res.json(options);
    }
    catch (err) {
        console.error('Passkey register options error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Passkey Registration - Step 2: Verify
app.post('/api/auth/passkey/register-verify', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { credential, encryptedMasterKey, iv, authTag } = req.body;
    const expectedChallenge = challenges.get(`reg_${userId}`);
    if (!expectedChallenge) {
        return res.status(400).json({ error: 'Registration challenge not found or expired.' });
    }
    challenges.delete(`reg_${userId}`);
    try {
        const { rpID, origin } = getWebAuthnConfig(req);
        const verification = await (0, server_1.verifyRegistrationResponse)({
            response: credential,
            expectedChallenge,
            expectedOrigin: [origin, 'http://localhost:3000', 'http://127.0.0.1:3000'],
            expectedRPID: rpID,
        });
        if (verification.verified && verification.registrationInfo) {
            const regInfo = verification.registrationInfo;
            const cred = regInfo.credential || regInfo;
            const credentialID = cred.id || cred.credentialID;
            const credentialPublicKey = cred.publicKey || cred.credentialPublicKey;
            const counter = typeof cred.counter !== 'undefined' ? cred.counter : regInfo.counter;
            const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');
            await (0, db_1.savePasskey)({
                id: credentialID,
                userId,
                publicKey: publicKeyBase64,
                counter: Number(counter),
                encryptedMasterKey,
                iv,
                authTag
            });
            return res.json({ success: true });
        }
        res.status(400).json({ error: 'Registration verification failed.' });
    }
    catch (err) {
        console.error('Registration verification error:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});
// Passkey Authentication - Step 1: Options
app.post('/api/auth/passkey/login-options', async (req, res) => {
    const { email } = req.body;
    if (!email)
        return res.status(400).json({ error: 'Email is required' });
    try {
        const user = await (0, db_1.getUserByEmail)(email);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const userPasskeys = await (0, db_1.getUserPasskeys)(user.id);
        const { rpID } = getWebAuthnConfig(req);
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID,
            allowCredentials: userPasskeys.map(pk => ({
                id: pk.id,
                type: 'public-key',
            })),
            userVerification: 'required',
        });
        options.extensions = {
            prf: {
                eval: {
                    first: Buffer.from(new Uint8Array(32)).toString('base64url'),
                }
            }
        };
        challenges.set(`login_${user.id}`, options.challenge);
        res.json({
            options,
            userId: user.id
        });
    }
    catch (err) {
        console.error('Passkey login options error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Passkey Authentication - Step 2: Verify
app.post('/api/auth/passkey/login-verify', async (req, res) => {
    const { credential, userId } = req.body;
    if (!userId || !credential) {
        return res.status(400).json({ error: 'userId and credential are required' });
    }
    const expectedChallenge = challenges.get(`login_${userId}`);
    if (!expectedChallenge) {
        return res.status(400).json({ error: 'Login challenge not found or expired.' });
    }
    challenges.delete(`login_${userId}`);
    try {
        const passkey = await (0, db_1.getPasskeyById)(credential.id);
        if (!passkey) {
            return res.status(404).json({ error: 'Passkey not registered on this server.' });
        }
        const { rpID, origin } = getWebAuthnConfig(req);
        const verification = await (0, server_1.verifyAuthenticationResponse)({
            response: credential,
            expectedChallenge,
            expectedOrigin: [origin, 'http://localhost:3000', 'http://127.0.0.1:3000'],
            expectedRPID: rpID,
            authenticator: {
                credentialID: passkey.id,
                credentialPublicKey: Buffer.from(passkey.public_key, 'base64'),
                counter: passkey.counter,
            },
            credential: {
                id: passkey.id,
                publicKey: Buffer.from(passkey.public_key, 'base64'),
                counter: passkey.counter,
            }
        });
        if (verification.verified) {
            const authInfo = verification.authenticationInfo;
            const newCounter = authInfo?.newCounter || authInfo?.counter || 0;
            await (0, db_1.updatePasskeyCounter)(passkey.id, newCounter);
            const user = await (0, db_1.getUserById)(userId);
            const sessionToken = 'tok_pk_' + Math.random().toString(36).substr(2, 18);
            activeSessions.set(sessionToken, userId);
            return res.json({
                success: true,
                userId,
                email: user.email,
                sessionToken,
                encryptedMasterKey: passkey.encrypted_master_key,
                iv: passkey.iv,
                authTag: passkey.auth_tag
            });
        }
        res.status(400).json({ error: 'Passkey verification failed.' });
    }
    catch (err) {
        console.error('Login verification error:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});
// Get User Keys
app.get('/api/user/keys', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    try {
        const keys = await (0, db_1.getUserKeys)(userId);
        res.json({ keys });
    }
    catch (err) {
        console.error('Fetch user keys error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Save User Keys
app.post('/api/user/keys', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { publicKey, encryptedPrivateKey, iv, authTag } = req.body;
    if (!publicKey || !encryptedPrivateKey || !iv || !authTag) {
        return res.status(400).json({ error: 'publicKey, encryptedPrivateKey, iv, and authTag are required' });
    }
    try {
        await (0, db_1.saveUserKeys)(userId, publicKey, encryptedPrivateKey, iv, authTag);
        res.json({ success: true });
    }
    catch (err) {
        console.error('Save user keys error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get Recipient Public Key by Email
app.get('/api/user/public-key', requireAuth, async (req, res) => {
    const { email } = req.query;
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email parameter is required' });
    }
    try {
        const result = await (0, db_1.getUserPublicKey)(email);
        if (!result) {
            return res.status(404).json({ error: 'Recipient email not found or user is not registered' });
        }
        if (!result.publicKey) {
            return res.status(404).json({ error: 'Recipient has not generated sharing keys yet' });
        }
        res.json({ userId: result.userId, publicKey: result.publicKey });
    }
    catch (err) {
        console.error('Get user public key error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Share Item
app.post('/api/shares', requireAuth, async (req, res) => {
    const senderId = req.headers['x-user-id'];
    const { receiverId, type, name, ciphertext, encryptedKey, iv, authTag } = req.body;
    if (!receiverId || !type || !name || !ciphertext || !encryptedKey || !iv || !authTag) {
        return res.status(400).json({ error: 'Missing required sharing parameters' });
    }
    try {
        const id = 'sh_' + Math.random().toString(36).substr(2, 9);
        const sharedItem = await (0, db_1.saveSharedItem)({
            id,
            senderId,
            receiverId,
            type,
            name,
            ciphertext,
            encryptedKey,
            iv,
            authTag
        });
        res.status(201).json({ success: true, sharedItem });
    }
    catch (err) {
        console.error('Share item error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Fetch Sent Shared Items
app.get('/api/shares/sent', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    try {
        const items = await (0, db_1.getSentSharedItems)(userId);
        res.json({ items });
    }
    catch (err) {
        console.error('Fetch sent shares error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Fetch Received Shared Items
app.get('/api/shares/received', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    try {
        const items = await (0, db_1.getReceivedSharedItems)(userId);
        res.json({ items });
    }
    catch (err) {
        console.error('Fetch received shares error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.post('/api/attachments', requireAuth, upload.single('file'), async (req, res) => {
    const userId = req.headers['x-user-id'];
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: 'File is required' });
    }
    const { vaultItemId, encryptedMetadata, metadataIv, metadataAuthTag } = req.body;
    if (!encryptedMetadata || !metadataIv || !metadataAuthTag) {
        if (fs_1.default.existsSync(file.path)) {
            fs_1.default.unlinkSync(file.path);
        }
        return res.status(400).json({ error: 'encryptedMetadata, metadataIv, and metadataAuthTag are required' });
    }
    try {
        const attachmentId = path_1.default.basename(file.filename, '.enc');
        const attachment = await (0, db_1.saveAttachment)({
            id: attachmentId,
            userId,
            vaultItemId: vaultItemId || null,
            encryptedMetadata,
            metadataIv,
            metadataAuthTag,
            filePath: file.filename,
            fileSize: file.size
        });
        res.status(201).json(attachment);
    }
    catch (err) {
        console.error('Upload attachment error:', err);
        if (fs_1.default.existsSync(file.path)) {
            fs_1.default.unlinkSync(file.path);
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.get('/api/attachments', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    try {
        const attachments = await (0, db_1.getUserAttachments)(userId);
        res.json({ attachments });
    }
    catch (err) {
        console.error('List attachments error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.get('/api/attachments/:id', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    try {
        const attachment = await (0, db_1.getAttachmentById)(id);
        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        if (attachment.userId !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const fullPath = path_1.default.join(uploadsDir, attachment.filePath);
        if (!fs_1.default.existsSync(fullPath)) {
            return res.status(404).json({ error: 'Physical file not found' });
        }
        res.sendFile(fullPath);
    }
    catch (err) {
        console.error('Download attachment error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.delete('/api/attachments/:id', requireAuth, async (req, res) => {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    try {
        const attachment = await (0, db_1.getAttachmentById)(id);
        if (!attachment) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        if (attachment.userId !== userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const fullPath = path_1.default.join(uploadsDir, attachment.filePath);
        if (fs_1.default.existsSync(fullPath)) {
            fs_1.default.unlinkSync(fullPath);
        }
        await (0, db_1.deleteAttachment)(userId, id);
        res.json({ success: true, message: 'Attachment deleted successfully' });
    }
    catch (err) {
        console.error('Delete attachment error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
app.listen(port, () => {
    console.log(`Vivago Pass ZKA API server running on port ${port}`);
});
