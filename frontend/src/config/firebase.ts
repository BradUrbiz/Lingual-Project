import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDGLmiMun2eMunDsJMgoo7vRCqSgmHZ4LU",
  authDomain: "lingu-480600.firebaseapp.com",
  projectId: "lingu-480600",
  storageBucket: "lingu-480600.firebasestorage.app",
  messagingSenderId: "6288717566",
  appId: "1:6288717566:web:cff5a5c0b8b96d83e2d7af"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
