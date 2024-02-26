// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_API_KEY,
  storageBucket: process.env.FIREBASE_API_KEY,
  messagingSenderId: process.env.FIREBASE_API_KEY,
  appId: process.env.FIREBASE_API_KEY,
  measurementId: process.env.FIREBASE_API_KEY
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);