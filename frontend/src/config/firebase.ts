import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, GithubAuthProvider, FacebookAuthProvider } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

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
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');

export const githubProvider = new GithubAuthProvider();
githubProvider.addScope('read:user');
githubProvider.addScope('user:email');

export const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope('email');
