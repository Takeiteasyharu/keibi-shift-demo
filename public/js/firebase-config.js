import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  getFunctions,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVFlHLYDH6qVp14w4z9UvSPxc8Hq0ju5I",
  authDomain: "keibi-shift-kokubunji-de-fef98.firebaseapp.com",
  databaseURL: "https://keibi-shift-kokubunji-de-fef98-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "keibi-shift-kokubunji-de-fef98",
  storageBucket: "keibi-shift-kokubunji-de-fef98.firebasestorage.app",
  messagingSenderId: "1061419220107",
  appId: "1:1061419220107:web:729d748e6dca2d31c1a88e",
  measurementId: "G-GVLGEZL3T3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "asia-northeast1");

// 明示的に ?emulator=1 を付けた場合だけローカルEmulatorへ接続する。
if (new URLSearchParams(location.search).get("emulator") === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { app, auth, db, functions, firebaseConfig };
