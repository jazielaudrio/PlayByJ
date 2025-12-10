"use client";
import React, { useState } from "react";
import { auth, db } from "@/utils/firebase"; // Import db
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore"; // Import Firestore functions
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    try {
      if (isSignUp) {
        console.log("Starting sign up...");
        
        // 1. Create Authentication User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        console.log("Auth successful for:", userCredential.user.uid);
        
        // 2. Create User Document
        try {
            await setDoc(doc(db, "users", userCredential.user.uid), {
              email: email,
              approved: false,
              createdAt: new Date().toISOString()
            });
            console.log("Database document created!");
        } catch (dbError: any) {
            console.error("Database Save Error:", dbError);
            setError("Account created, but database failed: " + dbError.message);
            return; // Stop here so we see the error
        }
        
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push("/"); 
    } catch (err: any) {
      console.error("Auth Error:", err);
      setError(err.message.replace("Firebase: ", ""));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-xl shadow-md w-96">
        <h1 className="text-2xl font-bold text-center mb-6 text-slate-800">
          {isSignUp ? "Request Access" : "Welcome Back"} {/* Changed Title */}
        </h1>
        
        {error && <p className="text-red-500 text-sm mb-4 text-center bg-red-50 p-2 rounded">{error}</p>}

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
            <input 
              type="email" 
              required
              className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Password</label>
            <input 
              type="password" 
              required
              className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-slate-900"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          
          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition">
            {isSignUp ? "Submit Request" : "Log In"} {/* Changed Label */}
          </button>
        </form>

        <p className="text-center mt-4 text-sm text-gray-600">
          {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
          <button 
            onClick={() => setIsSignUp(!isSignUp)} 
            className="text-blue-600 font-bold hover:underline"
          >
            {isSignUp ? "Log In" : "Request Access"}
          </button>
        </p>
      </div>
    </div>
  );
}