// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCxPTTbS3BlIQfi4hAZbadwVUd3eOCvsXQ",
  authDomain: "stepup-ecommerce.firebaseapp.com",
  projectId: "stepup-ecommerce",
  storageBucket: "stepup-ecommerce.appspot.com",
  messagingSenderId: "743437742921",
  appId: "1:743437742921:web:6f64a6b1770aff5913e098",
  measurementId: "G-B45C0GHFSE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);