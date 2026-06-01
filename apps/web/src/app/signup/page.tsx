"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Lock, Mail, Check, ArrowLeft, Command, Gem, Globe, ArrowRight, ShieldCheck, Download, Copy } from "lucide-react";
import { deriveKey, deriveKeyFromBackupCode, wrapMasterKey } from "@vivago-pass/ts-crypto";
import { setMasterKeyHex, CONFIG } from "@/lib/sessionStore";
import { useToast } from "../../context/toast-context";

type Plan = "starter" | "professional" | "genius";
type Billing = "monthly" | "annually";

export default function SignupPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [step, setStep] = useState(2); // Bypass plans, select Starter directly
  const [selectedPlan, setSelectedPlan] = useState<Plan>("starter");
  const [billing, setBilling] = useState<Billing>("monthly");
  
  // Credentials
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isLoading, setIsLoading] = useState(false);

  // Step 3: OTP State
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  // Master key refs for storing generated key across steps
  const masterKeyRef = useRef<CryptoKey | null>(null);
  const masterKeyHexRef = useRef<string | null>(null);

  // Step 4: Backup Codes State
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [hasDownloaded, setHasDownloaded] = useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const pendingEmail = sessionStorage.getItem("verify-pending-email") || localStorage.getItem("user-email");
      if (pendingEmail) {
        setEmail(pendingEmail);
        setStep(3);
      }
    }
  }, []);

  const prices = {
    starter: { monthly: 0, annually: 0 },
    professional: { monthly: 59, annually: 49 },
    genius: { monthly: 299, annually: 249 }
  };

  const handlePlanSelect = (plan: Plan) => {
    setSelectedPlan(plan);
    setStep(2);
  };

  const validate = () => {
    const tempErrors: { email?: string; password?: string } = {};
    if (!email) {
      tempErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      tempErrors.email = "Please enter a valid email address";
    }

    if (!password) {
      tempErrors.password = "Password is required";
    } else if (password.length < 6) {
      tempErrors.password = "Password must be at least 6 characters";
    }

    setErrors(tempErrors);
    return Object.keys(tempErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      // 1. Generate a random 256-bit Master Key client-side
      const masterKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      masterKeyRef.current = masterKey;

      const rawMasterKey = await window.crypto.subtle.exportKey("raw", masterKey);
      const masterKeyHex = Array.from(new Uint8Array(rawMasterKey))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      masterKeyHexRef.current = masterKeyHex;

      // 2. Derive Auth Key & Wrapping Key using PBKDF2-SHA256
      const { encryptionKey: wrappingKey, authKey } = await deriveKey(password, email);

      // 3. Wrap Master Key with password-derived wrapping key
      const wrapped = await wrapMasterKey(masterKey, wrappingKey);

      const res = await fetch(`${CONFIG.API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          authKey,
          encryptedMasterKey: wrapped.ciphertext,
          masterKeyIv: wrapped.iv,
          masterKeyAuthTag: wrapped.authTag
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setErrors({ email: data.error || "Registration failed" });
        setIsLoading(false);
        return;
      }

      // Save user ID to localStorage
      localStorage.setItem("x-user-id", data.userId);
      localStorage.setItem("user-email", data.email);

      setIsLoading(false);
      setStep(3); // Proceed to OTP verification code
    } catch (err) {
      console.warn("API server connection failed. Running in local sandbox demo mode:", err);
      try {
        const masterKey = await window.crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
        masterKeyRef.current = masterKey;

        const rawMasterKey = await window.crypto.subtle.exportKey("raw", masterKey);
        const masterKeyHex = Array.from(new Uint8Array(rawMasterKey))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");
        masterKeyHexRef.current = masterKeyHex;
      } catch (mockErr) {
        console.error("Mock key generation failed:", mockErr);
      }

      // Simulate successful registration locally for preview/dev mode
      const mockUserId = 'usr_mock_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem("x-user-id", mockUserId);
      localStorage.setItem("user-email", email);

      setIsLoading(false);
      setStep(3); // Proceed to OTP verification code
    }
  };

  // OTP Handlers
  const handleOtpChange = (index: number, value: string) => {
    if (isNaN(Number(value))) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Automatically focus next input
    if (value && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    // Trigger verification if all filled
    if (newOtp.every(val => val !== "")) {
      verifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").trim();
    if (/^\d{6}$/.test(pastedData)) {
      const newOtp = pastedData.split("");
      setOtp(newOtp);
      verifyOtp(pastedData);
    }
  };

  const verifyOtp = async (code: string) => {
    setIsVerifying(true);
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otpCode: code })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        toast.error(data.error || "Verification failed");
        setIsVerifying(false);
        setOtp(Array(6).fill(""));
        return;
      }
      
      try {
        if (masterKeyHexRef.current) {
          setMasterKeyHex(masterKeyHexRef.current);
        }
      } catch (keyErr) {
        console.error("Failed to store encryption key:", keyErr);
      }

      // Save verification session
      localStorage.setItem("x-user-id", data.userId);
      localStorage.setItem("user-email", data.email);
      localStorage.setItem("session-token", data.sessionToken);
      sessionStorage.removeItem("verify-pending-email");
      
      setIsVerifying(false);
      setIsVerified(true);
      setTimeout(() => {
        generateBackupCodes();
        setStep(4);
      }, 1500);
    } catch (err) {
      console.warn("API verify connection failed. Proceeding locally:", err);
      
      try {
        if (masterKeyHexRef.current) {
          setMasterKeyHex(masterKeyHexRef.current);
        }
      } catch (keyErr) {
        console.error("Failed to store mock key:", keyErr);
      }

      setIsVerifying(false);
      setIsVerified(true);
      setTimeout(() => {
        generateBackupCodes();
        setStep(4);
      }, 1500);
    }
  };

  const generateBackupCodes = async () => {
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const segment1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const segment2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      codes.push(`VVGP-${segment1}-${segment2}`);
    }
    setBackupCodes(codes);

    try {
      if (!masterKeyRef.current) {
        throw new Error("Master Key not generated");
      }
      const wrappedCodes = await Promise.all(
        codes.map(async (code) => {
          const wrappingKey = await deriveKeyFromBackupCode(code, email);
          const wrapped = await wrapMasterKey(masterKeyRef.current!, wrappingKey);
          return {
            hash: code,
            encryptedMasterKey: wrapped.ciphertext,
            iv: wrapped.iv,
            authTag: wrapped.authTag
          };
        })
      );

      const userId = localStorage.getItem("x-user-id");
      const sessionToken = localStorage.getItem("session-token");
      await fetch(`${CONFIG.API_URL}/api/user/backup-codes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId || "",
          "session-token": sessionToken || ""
        },
        body: JSON.stringify({ backupCodes: wrappedCodes })
      });
    } catch (err) {
      console.error("Failed to generate and save backup codes:", err);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center p-4 md:p-8 bg-[#fafbfe] overflow-hidden font-sans">
      {/* Background Gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 left-1/4 w-[50%] h-[50%] rounded-full bg-blue-100/30 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[50%] h-[50%] rounded-full bg-indigo-100/20 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[1200px] mx-auto flex flex-col items-center">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.jpg" alt="Vivago Pass Logo" className="w-8 h-8 rounded-lg object-cover shadow-sm" />
          <span className="font-bold text-base text-slate-800 tracking-tight">Vivago Pass</span>
        </div>

        {step === 1 && (
          /* Step 1: Package Plan Selection */
          <div className="w-full flex flex-col items-center transition-all duration-300">
            {/* Title Section */}
            <h1 className="text-3xl md:text-[42px] font-extrabold text-slate-900 tracking-tight text-center max-w-[700px] leading-tight mb-6">
              Choose <span className="text-slate-900 font-extrabold">The Plan</span> That's Right For Your Security Goals!
            </h1>

            {/* Toggle Switch */}
            <div className="flex items-center justify-center bg-white shadow-sm border border-slate-100 rounded-full px-5 py-2.5 mb-10 gap-4">
              <span className={`text-[13px] font-semibold transition-all ${billing === "monthly" ? "text-slate-900 font-bold" : "text-slate-400"}`}>Monthly</span>
              
              <button 
                onClick={() => setBilling(billing === "monthly" ? "annually" : "monthly")}
                className="relative w-12 h-6 rounded-full bg-slate-900 p-0.5 transition-colors focus:outline-none"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-300 ${billing === "annually" ? "translate-x-6" : ""}`} />
              </button>

              <span className={`text-[13px] font-semibold transition-all ${billing === "annually" ? "text-slate-900 font-bold" : "text-slate-400"}`}>Annually</span>
            </div>

            {/* Plan Grid */}
            <div className="w-full bg-[#f3f6fc] p-6 md:p-8 rounded-[36px] grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Starter Card */}
              <div className="bg-[#e9edf6] rounded-[28px] p-8 flex flex-col justify-between min-h-[520px] transition-all">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mb-6">
                    <Command className="w-5 h-5 text-slate-700" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Starter</h3>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-[32px] font-extrabold text-slate-950">${prices.starter[billing]}</span>
                    <span className="text-[12px] font-semibold text-slate-500">/Month</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-slate-500 mb-6 font-medium">
                    Ideal for new users or those with basic security needs. Offers essential features to get started.
                  </p>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Secure password storage</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Single-device access</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Autofill capabilities</span>
                    </li>
                  </ul>
                </div>
                <button 
                  onClick={() => handlePlanSelect("starter")}
                  className="w-full h-12 mt-8 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-semibold text-sm transition-all active:scale-[0.98]"
                >
                  Register For Free!
                </button>
              </div>

              {/* Professional Card */}
              <div className="bg-white rounded-[28px] p-8 flex flex-col justify-between min-h-[520px] transition-all shadow-sm">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mb-6">
                    <Gem className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Professional</h3>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-[32px] font-extrabold text-slate-950">${prices.professional[billing]}</span>
                    <span className="text-[12px] font-semibold text-slate-500">/Month</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-slate-500 mb-6 font-medium">
                    A comprehensive plan for power users seeking advanced protection and password tools.
                  </p>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">All features from Starter plan</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Unlimited devices & syncing</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Advanced sharing options</span>
                    </li>
                  </ul>
                </div>
                <button 
                  onClick={() => handlePlanSelect("professional")}
                  className="w-full h-12 mt-8 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm transition-all flex items-center justify-center gap-1 active:scale-[0.98]"
                >
                  Get Started <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Genius Card */}
              <div className="bg-white rounded-[28px] p-8 flex flex-col justify-between min-h-[520px] transition-all shadow-sm">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mb-6">
                    <Globe className="w-5 h-5 text-indigo-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Genius</h3>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-[32px] font-extrabold text-slate-950">${prices.genius[billing]}</span>
                    <span className="text-[12px] font-semibold text-slate-500">/Month</span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-slate-500 mb-6 font-medium">
                    Tailored for businesses, teams, and enterprises seeking zero-knowledge secure collaborative tools.
                  </p>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">All features from Professional plan</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-4 h-4 rounded-full border border-blue-300 flex items-center justify-center bg-blue-50/50 shrink-0 mt-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                      </div>
                      <span className="text-[13px] text-slate-600 font-medium">Shared team vaults</span>
                    </li>
                  </ul>
                </div>
                <button 
                  onClick={() => handlePlanSelect("genius")}
                  className="w-full h-12 mt-8 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-sm transition-all flex items-center justify-center gap-1 active:scale-[0.98]"
                >
                  Get Started <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

            </div>
          </div>
        )}

        {step === 2 && (
          /* Step 2: Email & Password Credentials Form */
          <div className="w-full max-w-[460px] bg-white rounded-3xl border border-slate-100 shadow-xl p-5 sm:p-12 transition-all duration-300 mt-4 animate-fade-in">
            <div className="mb-6">
              <button
                onClick={() => {
                  setStep(1);
                  setEmail("");
                  setPassword("");
                  setErrors({});
                  localStorage.removeItem("user-email");
                  localStorage.removeItem("x-user-id");
                  sessionStorage.removeItem("verify-pending-email");
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-900 mb-4 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to pricing plans
              </button>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Sign Up</h2>
              <p className="text-[13px] text-slate-500 font-normal">
                Setting up credentials for your <span className="font-bold text-blue-600 uppercase">{selectedPlan} plan</span> ({billing})
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold text-slate-700">
                  Email address
                </Label>
                <div className="relative flex items-center">
                  <Mail className="absolute left-3.5 w-4 h-4 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    className={`pl-10 h-11 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                      errors.email ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                    }`}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) setErrors({ ...errors, email: undefined });
                    }}
                    disabled={isLoading}
                  />
                </div>
                {errors.email && (
                  <p className="text-xs text-red-500 font-medium mt-1">{errors.email}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold text-slate-700">
                  Master Password
                </Label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className={`pl-10 pr-10 h-11 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                      errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                    }`}
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors({ ...errors, password: undefined });
                    }}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-red-500 font-medium mt-1">{errors.password}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                disabled={isLoading}
              >
                {isLoading ? "Creating account..." : "Sign Up"}
              </Button>

              <p className="text-center text-[13px] text-slate-500 font-normal mt-4">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-blue-600 hover:underline">
                  Sign In
                </Link>
              </p>
            </form>
          </div>
        )}

        {step === 3 && (
          /* Step 3: 6-Digit Verification Code OTP Screen */
          <div className="w-full max-w-[460px] bg-white rounded-3xl border border-slate-100 shadow-xl p-4 sm:p-12 transition-all duration-300 mt-4 text-center animate-fade-in">
            {isVerified ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-[80px] h-[80px] rounded-full bg-emerald-100 animate-ping opacity-75 duration-1000" />
                  <div className="relative w-20 h-20 rounded-full bg-emerald-500 text-white flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/25 z-10">
                    <Check className="w-10 h-10 stroke-[3]" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold text-emerald-600">Verified!</h3>
                  <p className="text-sm text-slate-500">Securing your cryptographic identity...</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-6">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Verify Your Email</h2>
                <p className="text-[13px] text-slate-500 mb-8 leading-relaxed">
                  We've sent a 6-digit verification code to <span className="font-semibold text-slate-800">{email || "your email"}</span>. Enter it to confirm your identity.
                </p>

                <div className="flex justify-center gap-1.5 sm:gap-2.5 mb-6">
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => { otpInputsRef.current[idx] = el; }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      disabled={isVerifying}
                      className="w-9 sm:w-12 h-12 sm:h-14 text-center text-lg sm:text-xl font-bold rounded-xl border border-slate-200 bg-slate-50/50 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                    />
                  ))}
                </div>

                {isVerifying ? (
                  <div className="flex flex-col items-center justify-center gap-2.5 py-2">
                    <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                    <span className="text-xs text-slate-400 font-medium">Verifying code...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <button
                      onClick={() => verifyOtp(otp.join(""))}
                      disabled={otp.some(d => !d)}
                      className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                    >
                      Verify
                    </button>
                    <button
                      onClick={() => {
                        setOtp(Array(6).fill(""));
                        otpInputsRef.current[0]?.focus();
                      }}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Resend Code
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          /* Step 4: Backup Codes Screen */
          <div className="w-full max-w-[500px] bg-white rounded-3xl border border-slate-100 shadow-xl p-5 sm:p-12 transition-all duration-300 mt-4 animate-fade-in">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-6">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Save Your Backup Codes</h2>
            <p className="text-[13px] text-slate-500 mb-6 leading-relaxed">
              If you lose your master password, these emergency backup codes are the only way to recover access. Keep them private and secure.
            </p>

            <div className="grid grid-cols-2 gap-2.5 bg-slate-50 border border-slate-100 rounded-2xl p-5 mb-6 font-mono text-[12px] font-semibold text-slate-700 tracking-wider">
              {backupCodes.map((code, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-300 select-none">0{idx + 1}</span>
                  <span>{code}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join("\n"));
                  setHasDownloaded(true);
                }}
                className="w-full sm:flex-1 h-11 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <Copy className="w-4 h-4 text-slate-500" /> Copy Codes
              </button>
              <button
                onClick={() => {
                  const element = document.createElement("a");
                  const file = new Blob([
                    `VIVAGO PASS SECURITY BACKUP CODES\n`,
                    `Account: ${email}\n`,
                    `Date: ${new Date().toLocaleDateString()}\n\n`,
                    `Keep these codes extremely secure. Do not share them with anyone.\n\n`,
                    backupCodes.join("\n")
                  ], {type: 'text/plain'});
                  element.href = URL.createObjectURL(file);
                  element.download = "vivago-pass-backup-codes.txt";
                  document.body.appendChild(element);
                  element.click();
                  document.body.removeChild(element);
                  setHasDownloaded(true);
                }}
                className="flex-1 h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm active:scale-[0.98]"
              >
                <Download className="w-4 h-4 text-slate-200" /> Download .txt
              </button>
            </div>

            <Button
              onClick={() => router.push("/dashboard")}
              disabled={!hasDownloaded}
              className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              Go to Dashboard <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
