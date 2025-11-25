// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDhzSsSXDd6fjORRVmJFsomhGuigZNR96g",
  authDomain: "airide-app.firebaseapp.com",
  projectId: "airide-app",
  storageBucket: "airide-app.firebasestorage.app",
  messagingSenderId: "415820909922",
  appId: "1:415820909922:web:040459ed6a7934f0be303b",
  measurementId: "G-444G4EV232"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);