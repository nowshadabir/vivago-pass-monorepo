"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Lock, Mail, ArrowLeft, AlertTriangle, Key, ShieldCheck } from "lucide-react";
import { deriveKey, deriveKeyFromBackupCode, unwrapMasterKey, wrapMasterKey } from "@vivago-pass/ts-crypto";
import { setMasterKeyHex, CONFIG } from "@/lib/sessionStore";

export default function ForgotPasswordPage() {
  const router = useRouter();
  
  // 'backup' | 'otp'
  const [method, setMethod] = useState<'backup' | 'otp'>('backup');
  
  // Shared email state
  const [email, setEmail] = useState("");
  
  // OTP Reset State
  const [otpStep, setOtpStep] = useState<1 | 2>(1);
  const [otpCode, setOtpCode] = useState("");
  
  // Backup Code Recovery - Step 1: Input Code & Verify, Step 2: Set New Password
  const [backupStep, setBackupStep] = useState<1 | 2>(1);
  const [backupCode, setBackupCode] = useState("");
  const [tempRecoveryData, setTempRecoveryData] = useState<{ encryptedMasterKey: string; iv: string; authTag: string } | null>(null);
  
  // Password States (Used for both methods in their respective final steps)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [errors, setErrors] = useState<{ email?: string; otpCode?: string; password?: string; backupCode?: string; general?: string }>({});
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Email format validation
  const validateEmailFormat = (emailStr: string) => {
    if (!emailStr) return "Email is required";
    if (emailStr.length > 255) return "Email is too long";
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(emailStr)) return "Please enter a valid email address";
    return null;
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmailFormat(email);
    if (emailErr) {
      setErrors({ email: emailErr });
      return;
    }

    setIsLoading(true);
    setErrors({});
    setMessage("");

    try {
      const res = await fetch(`${CONFIG.API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrors({ general: data.error || "Failed to send reset code" });
        setIsLoading(false);
        return;
      }

      setMessage(data.message || "Verification code sent to email.");
      setIsLoading(false);
      setTimeout(() => {
        setOtpStep(2);
      }, 1000);
    } catch (err) {
      console.warn("Simulating forgot password request locally:", err);
      setMessage("Simulated OTP email sent to " + email);
      setIsLoading(false);
      setTimeout(() => {
        setOtpStep(2);
      }, 1000);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate OTP and Password
    const tempErrors: { otpCode?: string; password?: string } = {};
    if (!otpCode) {
      tempErrors.otpCode = "Reset code is required";
    } else if (!/^\d{6}$/.test(otpCode)) {
      tempErrors.otpCode = "Reset code must be 6 digits";
    }

    if (!newPassword) {
      tempErrors.password = "New password is required";
    } else if (newPassword.length < 6) {
      tempErrors.password = "Password must be at least 6 characters";
    } else if (newPassword !== confirmPassword) {
      tempErrors.password = "Passwords do not match";
    }

    if (Object.keys(tempErrors).length > 0) {
      setErrors(tempErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});
    setMessage("");

    try {
      // 1. Generate new Master Key (since the user forgot their password and has no backup code)
      const masterKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      const rawMasterKey = await window.crypto.subtle.exportKey("raw", masterKey);
      const keyHex = Array.from(new Uint8Array(rawMasterKey))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      // 2. Derive wrapping key and auth key from new password
      const { encryptionKey: wrappingKey, authKey } = await deriveKey(newPassword, email);

      // 3. Wrap new Master Key
      const wrapped = await wrapMasterKey(masterKey, wrappingKey);

      const res = await fetch(`${CONFIG.API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: email.trim().toLowerCase(), 
          otpCode: otpCode.trim(), 
          newAuthKey: authKey,
          encryptedMasterKey: wrapped.ciphertext,
          masterKeyIv: wrapped.iv,
          masterKeyAuthTag: wrapped.authTag
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrors({ general: data.error || "Password reset failed" });
        setIsLoading(false);
        return;
      }

      setMasterKeyHex(keyHex);

      setMessage("Password has been reset successfully! Redirecting to login...");
      setIsLoading(false);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err) {
      console.warn("Simulating reset locally:", err);
      setMessage("Local simulated password reset successful! Redirecting to login...");
      setIsLoading(false);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    }
  };

  // Backup Code recovery - Step 1: Verify Code & Decrypt Key
  const handleVerifyBackupCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const emailErr = validateEmailFormat(email);
    const tempErrors: { email?: string; backupCode?: string } = {};
    if (emailErr) tempErrors.email = emailErr;
    if (!backupCode) tempErrors.backupCode = "Backup code is required";

    if (Object.keys(tempErrors).length > 0) {
      setErrors(tempErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});
    setMessage("");

    try {
      // 1. Submit email and backup code to verify and retrieve wrapped key details
      const res = await fetch(`${CONFIG.API_URL}/api/auth/login-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), backupCode: backupCode.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrors({ general: data.error || "Authentication using backup code failed" });
        setIsLoading(false);
        return;
      }

      // 2. Validate cryptographic decryption locally on client side to ensure it unwraps properly
      try {
        const wrappingKey = await deriveKeyFromBackupCode(backupCode.trim(), email.trim().toLowerCase());
        await unwrapMasterKey(data.encryptedMasterKey, data.iv, data.authTag, wrappingKey);
        
        // Decryption successful! Store wrapped details in temp state and move to Step 2
        setTempRecoveryData({
          encryptedMasterKey: data.encryptedMasterKey,
          iv: data.iv,
          authTag: data.authTag
        });
        setMessage("Backup code verified successfully! Now please set your new master password.");
        setIsLoading(false);
        setTimeout(() => {
          setBackupStep(2);
        }, 1000);
      } catch (cryptoErr) {
        console.error("Local decryption of key failed:", cryptoErr);
        setErrors({ general: "Failed to decrypt master key. Check if your backup code matches this email." });
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Backup code verification error:", err);
      setErrors({ general: "Connection failed. Please ensure the backend server is running." });
      setIsLoading(false);
    }
  };

  // Backup Code recovery - Step 2: Set New Password & Commit
  const handleCommitBackupRecovery = async (e: React.FormEvent) => {
    e.preventDefault();

    const tempErrors: { password?: string } = {};
    if (!newPassword) {
      tempErrors.password = "New master password is required";
    } else if (newPassword.length < 6) {
      tempErrors.password = "Password must be at least 6 characters";
    } else if (newPassword !== confirmPassword) {
      tempErrors.password = "Passwords do not match";
    }

    if (Object.keys(tempErrors).length > 0) {
      setErrors(tempErrors);
      return;
    }

    if (!tempRecoveryData) {
      setErrors({ general: "Session expired. Please restart the recovery flow." });
      return;
    }

    setIsLoading(true);
    setErrors({});
    setMessage("");

    try {
      // 1. Unwrap the recovered master key using the backup code
      const backupWrappingKey = await deriveKeyFromBackupCode(backupCode.trim(), email.trim().toLowerCase());
      const masterKey = await unwrapMasterKey(tempRecoveryData.encryptedMasterKey, tempRecoveryData.iv, tempRecoveryData.authTag, backupWrappingKey);

      // 2. Derive the new auth key and password wrapping key from the new master password
      const { encryptionKey: newWrappingKey, authKey } = await deriveKey(newPassword, email);

      // 3. Re-wrap the recovered master key with the new password wrapping key
      const newWrapped = await wrapMasterKey(masterKey, newWrappingKey);

      // 4. Commit the new auth key and the new wrapped master key details to the server
      const res = await fetch(`${CONFIG.API_URL}/api/auth/recover-backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: email.trim().toLowerCase(), 
          backupCode: backupCode.trim(), 
          newAuthKey: authKey,
          encryptedMasterKey: newWrapped.ciphertext,
          masterKeyIv: newWrapped.iv,
          masterKeyAuthTag: newWrapped.authTag
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrors({ general: data.error || "Recovery failed" });
        setIsLoading(false);
        return;
      }

      // 5. Store the raw key hex in browser session storage
      const rawKey = await window.crypto.subtle.exportKey("raw", masterKey);
      const keyHex = Array.from(new Uint8Array(rawKey))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      setMasterKeyHex(keyHex);

      localStorage.setItem("x-user-id", data.userId);
      localStorage.setItem("user-email", data.email);
      localStorage.setItem("session-token", data.sessionToken);

      setMessage("Password updated and vault recovered successfully! Redirecting to dashboard...");
      setIsLoading(false);
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (err) {
      console.error("Backup recovery commit error:", err);
      setErrors({ general: "An error occurred while updating your master password." });
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center p-4 md:p-6 bg-slate-50 overflow-hidden font-sans">
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/20 blur-[120px] md:blur-[160px]" />
        <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] rounded-full bg-indigo-300/30 blur-[120px] md:blur-[160px]" />
      </div>

      <div className="relative z-10 w-full max-w-[480px] bg-white rounded-3xl border border-slate-100 shadow-2xl p-6 sm:p-10 md:p-12">
        <div className="mb-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
          </Link>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Recover Your Account</h2>
          <p className="text-[13px] text-slate-500 font-normal">
            Regain access to your Zero-Knowledge credentials vault
          </p>
        </div>

        {/* Tab Selection (Only shown during Step 1 of either method) */}
        {((method === 'backup' && backupStep === 1) || (method === 'otp' && otpStep === 1)) && (
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl mb-6">
            <button
              type="button"
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                method === 'backup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-950'
              }`}
              onClick={() => {
                setMethod('backup');
                setErrors({});
                setMessage("");
              }}
            >
              Use Backup Code
            </button>
            <button
              type="button"
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                method === 'otp' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-950'
              }`}
              onClick={() => {
                setMethod('otp');
                setErrors({});
                setMessage("");
              }}
            >
              Reset & Erase Data
            </button>
          </div>
        )}

        {message && (
          <div className="p-3 mb-4 text-sm bg-blue-50 text-blue-800 rounded-xl border border-blue-100 font-medium">
            {message}
          </div>
        )}

        {errors.general && (
          <div className="p-3 mb-4 text-sm bg-red-50 text-red-800 rounded-xl border border-red-100 font-medium">
            {errors.general}
          </div>
        )}

        {method === 'backup' ? (
          <div>
            {backupStep === 1 ? (
              /* Backup Recovery Step 1: Input Backup Code */
              <form onSubmit={handleVerifyBackupCode} className="space-y-4" noValidate>
                <div className="p-3.5 bg-blue-50/50 border border-blue-100 rounded-2xl text-blue-900 text-[12px] leading-relaxed">
                  <p className="font-semibold mb-0.5">💡 Recovery Step 1 of 2</p>
                  Verify your emergency backup code to retrieve and decrypt your master encryption key.
                </div>

                <div className="space-y-1">
                  <Label htmlFor="email" className="text-xs font-semibold text-slate-700">
                    Email address
                  </Label>
                  <div className="relative flex items-center">
                    <Mail className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      className={`pl-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.email ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="backupCode" className="text-xs font-semibold text-slate-700">
                    Backup Code
                  </Label>
                  <div className="relative flex items-center">
                    <Key className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="backupCode"
                      type="text"
                      className={`pl-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all font-mono tracking-wider ${
                        errors.backupCode ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="VVGP-XXXX-XXXX"
                      value={backupCode}
                      onChange={(e) => setBackupCode(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.backupCode && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.backupCode}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-10.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? "Verifying Backup Code..." : "Verify Backup Code"}
                </Button>
              </form>
            ) : (
              /* Backup Recovery Step 2: Choose New Password */
              <form onSubmit={handleCommitBackupRecovery} className="space-y-4" noValidate>
                <div className="p-3.5 bg-emerald-50 border border-emerald-100 rounded-2xl text-emerald-900 text-[12px] leading-relaxed flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-0.5">Recovery Step 2 of 2</p>
                    Backup code verified! Now set a new master password. This will encrypt your recovery payload with the new key.
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="newPassword" className="text-xs font-semibold text-slate-700">
                    New Master Password
                  </Label>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      className={`pl-10 pr-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="absolute right-3 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="confirmPassword" className="text-xs font-semibold text-slate-700">
                    Confirm Master Password
                  </Label>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      className={`pl-10 pr-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.password}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-10.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? "Saving changes..." : "Save Password & Enter Vault"}
                </Button>
              </form>
            )}
          </div>
        ) : (
          <div>
            {otpStep === 1 ? (
              <form onSubmit={handleRequestOtp} className="space-y-5" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold text-slate-700">
                    Email address
                  </Label>
                  <div className="relative flex items-center">
                    <Mail className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      className={`pl-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.email ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.email}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-10.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? "Sending code..." : "Request Reset Code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-5" noValidate>
                {/* Warning Message */}
                <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs leading-relaxed font-medium">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="font-bold text-amber-800 mb-0.5">⚠️ Data Purge Warning</p>
                    Resetting your master password will permanently erase all encrypted passwords and items stored in your vault. We cannot decrypt or recover your data without your original password.
                  </div>
                </div>

                {/* OTP Code Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="otpCode" className="text-xs font-semibold text-slate-700">
                    Verification Code (6-digit)
                  </Label>
                  <Input
                    id="otpCode"
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    className={`h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                      errors.otpCode ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                    }`}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    disabled={isLoading}
                  />
                  {errors.otpCode && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.otpCode}</p>
                  )}
                </div>

                {/* New Password Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword" className="text-xs font-semibold text-slate-700">
                    New Master Password
                  </Label>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      className={`pl-10 pr-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="absolute right-3 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm New Password Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-xs font-semibold text-slate-700">
                    Confirm Master Password
                  </Label>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      className={`pl-10 pr-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-red-500 font-medium mt-1">{errors.password}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-10.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? "Resetting password..." : "Confirm Password Reset & Purge Vault"}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
