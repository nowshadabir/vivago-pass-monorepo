"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Lock, Mail, Fingerprint } from "lucide-react";
import { deriveKey, deriveKeyFromPrf, base64ToArrayBuffer, decryptData } from "@vivago-pass/ts-crypto";
import { startAuthentication } from "@simplewebauthn/browser";
import { setMasterKeyHex, getStorage, CONFIG } from "@/lib/sessionStore";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const validate = () => {
    const tempErrors: { email?: string; password?: string } = {};
    if (!email) {
      tempErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      tempErrors.email = "Please enter a valid email address";
    }

    if (!password) {
      tempErrors.password = "Password is required";
    }

    setErrors(tempErrors);
    return Object.keys(tempErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    try {
      // Derive Auth Key & Wrapping Key using PBKDF2-SHA256
      const { encryptionKey: wrappingKey, authKey } = await deriveKey(password, email);

      const res = await fetch(`${CONFIG.API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, authKey })
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 && data.unverified) {
          sessionStorage.setItem("verify-pending-email", email);
          router.push("/signup");
          return;
        }
        setErrors({ email: data.error || "Invalid credentials" });
        setIsLoading(false);
        return;
      }

      let keyHex = "";
      if (data.encryptedMasterKey) {
        // Decrypt the random master key using the password-derived wrapping key
        keyHex = await decryptData(data.encryptedMasterKey, data.masterKeyIv, data.masterKeyAuthTag, wrappingKey);
      } else {
        // Fallback for legacy users
        const rawKey = await window.crypto.subtle.exportKey("raw", wrappingKey);
        keyHex = Array.from(new Uint8Array(rawKey))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");
      }
      // Save remember_me flag using the appropriate storage based on user preference
      getStorage().setItem("remember_me", rememberMe ? "true" : "false");
      setMasterKeyHex(keyHex);

      // Save user ID & token
      getStorage().setItem("x-user-id", data.userId);
      getStorage().setItem("user-email", data.email);
      getStorage().setItem("session-token", data.sessionToken);

      setIsLoading(false);
      setLoginSuccess(true);
      
      // Redirect to /dashboard after 800ms (0.8s)
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    } catch (err) {
      console.warn("API server connection failed. Running in local sandbox demo mode:", err);
      
      try {
        const { encryptionKey } = await deriveKey(password, email);
        const rawKey = await window.crypto.subtle.exportKey("raw", encryptionKey);
        const keyHex = Array.from(new Uint8Array(rawKey))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");
        setMasterKeyHex(keyHex);
      } catch (keyErr) {
        console.error("Failed to set mock key:", keyErr);
      }

      // Simulate successful login locally for preview/dev mode
      const mockUserId = 'usr_mock_alex';
      // Save remember_me flag using appropriate storage based on user preference
+      getStorage().setItem("remember_me", rememberMe ? "true" : "false");
      getStorage().setItem("x-user-id", mockUserId);
      getStorage().setItem("user-email", email);
      getStorage().setItem("session-token", "tok_mock_session");

      setIsLoading(false);
      setLoginSuccess(true);
      
      // Redirect to /dashboard after 800ms (0.8s)
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!email) {
      setErrors({ email: "Email is required to sign in with Passkey" });
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setErrors({ email: "Please enter a valid email address" });
      return;
    }

    setIsLoading(true);
    try {
      // 1. Fetch authentication options
      const optionsRes = await fetch(`${CONFIG.API_URL}/api/auth/passkey/login-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      if (!optionsRes.ok) {
        const errText = await optionsRes.json();
        throw new Error(errText.error || "Failed to fetch passkey login options");
      }

      const { options, userId } = await optionsRes.json();

      // 2. Start authentication via SimpleWebAuthn
      if (options.extensions?.prf?.eval?.first && typeof options.extensions.prf.eval.first === "string") {
        options.extensions.prf.eval.first = base64ToArrayBuffer(options.extensions.prf.eval.first);
      }
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Extract PRF result
      const firstPrf = (credential as any).response.extensions?.prf?.results?.first || (credential as any).clientExtensionResults?.prf?.results?.first;
      if (!firstPrf) {
        throw new Error("Your authenticator did not return a PRF value. Master key could not be derived.");
      }

      // 4. Verify assertion on backend
      const verifyRes = await fetch(`${CONFIG.API_URL}/api/auth/passkey/login-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, userId })
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json();
        throw new Error(errData.error || "Failed to verify passkey login");
      }

      const data = await verifyRes.json();

      // 5. Derive key and decrypt master key
      const rawPrfBuffer = base64ToArrayBuffer(firstPrf);
      const prfKey = await deriveKeyFromPrf(rawPrfBuffer);
      const decryptedMasterKeyHex = await decryptData(data.encryptedMasterKey, data.iv, data.authTag, prfKey);

      localStorage.setItem("remember_me", rememberMe ? "true" : "false");
      setMasterKeyHex(decryptedMasterKeyHex);

      // Save user ID & token
      getStorage().setItem("x-user-id", data.userId);
      getStorage().setItem("user-email", data.email);
      getStorage().setItem("session-token", data.sessionToken);

      setIsLoading(false);
      setLoginSuccess(true);
      
      // Redirect to /dashboard after 800ms
      setTimeout(() => {
        router.push("/dashboard");
      }, 800);

    } catch (err: any) {
      console.error("Passkey login failed:", err);
      setErrors({ email: err.message || "Passkey login failed." });
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center p-4 md:p-6 bg-slate-50 overflow-hidden font-sans">
      {/* Dynamic Background Mesh Gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/20 blur-[120px] md:blur-[160px]" />
        <div className="absolute -top-[10%] -right-[10%] w-[50%] h-[50%] rounded-full bg-indigo-300/30 blur-[120px] md:blur-[160px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-sky-200/20 blur-[120px] md:blur-[160px]" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-purple-200/20 blur-[120px] md:blur-[160px]" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-[1024px] grid grid-cols-1 md:grid-cols-2 bg-white/70 backdrop-blur-xl border border-white/60 shadow-2xl rounded-3xl overflow-hidden min-h-[580px]">
        
        {/* Info/Hero Section - Left Column (Hidden on mobile) */}
        <section className="hidden md:flex flex-col justify-between p-12 lg:p-16 border-r border-slate-100">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <img src="/logo.jpg" alt="Vivago Pass Logo" className="w-9 h-9 rounded-xl object-cover shadow-md" />
            <span className="font-bold text-lg text-slate-800 tracking-tight">Vivago Pass</span>
          </div>

          {/* Hero Content */}
          <div className="my-auto max-w-[380px]">
            <h1 className="text-3xl lg:text-4xl font-extrabold leading-tight text-slate-900 tracking-tight mb-4">
              Fast, Efficient and Productive
            </h1>
            <p className="text-[15px] leading-relaxed text-slate-500 font-normal">
              Zero-knowledge security, styled beautifully. Access, secure, and autofill your passwords anywhere at any time.
            </p>
          </div>

          {/* Footer */}
          <footer className="flex gap-6 text-[13px] text-slate-400 font-medium">
            <a href="#terms" className="hover:text-blue-600 transition-colors">Terms</a>
            <a href="#privacy" className="hover:text-blue-600 transition-colors">Privacy</a>
            <a href="#support" className="hover:text-blue-600 transition-colors">Contact Us</a>
          </footer>
        </section>

        {/* Login Form Section - Right Column */}
        <section className="flex flex-col justify-center p-5 sm:p-12 lg:p-16 bg-white">
          <div className="w-full max-w-[360px] mx-auto">
            
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Sign In</h2>
              <p className="text-[13px] text-slate-500 font-normal">Enter your credentials to access your vault</p>
            </div>

            {loginSuccess ? (
              <div className="flex flex-col items-center justify-center text-center py-8">
                <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-500 flex items-center justify-center text-2xl mb-4">
                  🔑
                </div>
                <h3 className="text-lg font-bold text-emerald-600 mb-1">Login Successful!</h3>
                <p className="text-sm text-slate-500">Decrypting your password vault...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Email Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold text-slate-700">
                    Email address
                  </Label>
                  <div className="relative flex items-center">
                    <Mail className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email" autoComplete="off"
                      className={`pl-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
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

                {/* Password Input */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="password" className="text-xs font-semibold text-slate-700">
                      Password
                    </Label>
                    <Link href="/forgot-password" className="text-xs font-semibold text-blue-600 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative flex items-center">
                    <Lock className="absolute left-3.5 w-4 h-4 text-slate-400" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      className={`pl-10 pr-10 h-10.5 rounded-xl border bg-slate-50/50 focus-visible:bg-white transition-all ${
                        errors.password ? "border-red-500 focus-visible:ring-red-500/20" : "border-slate-200"
                      }`}
                      placeholder="••••••••"
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

                {/* Remember Me Checkbox */}
                <div className="flex items-center gap-2.5 px-0.5 my-1 mb-2">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 accent-blue-600 cursor-pointer"
                  />
                  <Label htmlFor="rememberMe" className="text-xs font-bold text-slate-500 select-none cursor-pointer mb-2">
                    Remember me on this device
                  </Label>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-500/10 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>

                {/* Divider */}
                <div className="relative my-4 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-100" />
                  </div>
                  <span className="relative bg-white px-3 text-xs text-slate-400 font-normal uppercase">Or</span>
                </div>

                {/* Passkey Button */}
                <Button
                  type="button"
                  onClick={handlePasskeyLogin}
                  className="w-full h-10.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-800 font-semibold text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  disabled={isLoading}
                >
                  <Fingerprint className="w-4 h-4 text-blue-600" />
                  Sign in with Passkey
                </Button>

                {/* Sign Up Link */}
                <p className="text-center text-[13px] text-slate-500 font-normal mt-4">
                  New to Vivago Pass?{" "}
                  <Link href="/signup" className="font-semibold text-blue-600 hover:underline">
                    Create an account
                  </Link>
                </p>
              </form>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}
