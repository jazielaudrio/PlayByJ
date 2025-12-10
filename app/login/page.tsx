"use client";
import React, { useState } from "react";
import { auth, db } from "@/utils/firebase"; 
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, updateDoc } from "firebase/firestore"; // Added updateDoc
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid"; // Added uuid import

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
      // 1. Generate a unique Session ID for this specific login instance
      const newSessionId = uuidv4();
      let uid = "";

      if (isSignUp) {
        console.log("Starting sign up...");
        
        // Create Authentication User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        uid = userCredential.user.uid;
        console.log("Auth successful for:", uid);
        
        // Create User Document with Session ID
        try {
            await setDoc(doc(db, "users", uid), {
              email: email,
              approved: false, // Access pending by default
              currentSessionId: newSessionId, // Save the session ID
              createdAt: new Date().toISOString()
            });
            console.log("Database document created!");
        } catch (dbError: any) {
            console.error("Database Save Error:", dbError);
            setError("Account created, but database failed: " + dbError.message);
            return; 
        }
        
      } else {
        // Log In
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        uid = userCredential.user.uid;

        // Update the existing user doc with the NEW Session ID
        // This effectively "invalidates" any other device logged in with the old ID
        await updateDoc(doc(db, "users", uid), {
            currentSessionId: newSessionId
        });
      }

      // 2. Save Session ID to Local Device
      localStorage.setItem("playmaker_session_id", newSessionId);

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
          {isSignUp ? "Request Access" : "Welcome Back"}
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
            {isSignUp ? "Submit Request" : "Log In"}
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