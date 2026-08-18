import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyC0EKnlmftRvsaaVIDMehMaU38thyhdb70",
  authDomain: "rahul-money-tracker.firebaseapp.com",
  projectId: "rahul-money-tracker",
  storageBucket: "rahul-money-tracker.firebasestorage.app",
  messagingSenderId: "373981147613",
  appId: "1:373981147613:web:ad2098d5fbf060fdb38634"
};

const app = initializeApp(firebaseConfig);

export { app, firebaseConfig };